// Member activity, the reading half (activity.ts records it): the page's beat, and for the
// admin console who is online now and how members use the app: when and for how long, which
// screens, tabs, symbols and features, by day and by hour of the week in WIB, overall and per
// member. Online means a beat in the last ONLINE_MINUTES; a session is a run of active minutes
// with no gap longer than SESSION_GAP_MINUTES. Periods end today and start at a WIB midnight,
// so a 30-day period has 30 whole days.
import { and, count, desc, eq, gt, gte, isNotNull, isNull, max, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ACTIVITY_SCREENS, ACTIVITY_TABS, KEEP_DAYS, recordMinute } from "./activity";
import { requireAdmin, type AppEnv } from "./auth";
import { db } from "./db";
import { activityEvents, activityMinutes, analyses, priceAlerts, signalEvents, users } from "./db/schema";
import { planOf } from "./plans";

const ONLINE_MINUTES = 3;
const SESSION_GAP_MINUTES = 15;
const PERIODS = [7, 30, 90];
const WIB_MS = 7 * 3_600_000;
/** A chart's symbol as TradingView spells it (IDX:BBCA, BINANCE:BTCUSDT, OANDA:XAUUSD). */
const TV_SYMBOL = /^[A-Za-z0-9:._!^&=-]{1,40}$/;

export const analyticsApi = new Hono<AppEnv>();

export const beatSchema = z.object({
  screen: z.enum(ACTIVITY_SCREENS),
  tab: z.enum(ACTIVITY_TABS).nullable().optional(),
  symbol: z.string().regex(TV_SYMBOL).nullable().optional(),
});

/** The page's beat (client lib/activity.ts): this member is using the app now, there. */
analyticsApi.post("/activity", async (c) => {
  const body = beatSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Data aktivitas tidak valid" }, 400);
  await recordMinute(c.get("user"), { ...body.data, symbol: body.data.symbol?.toUpperCase() });
  return c.body(null, 204);
});

/**
 * When the member's previous visit ended: walking back from now through their minutes, the
 * first gap longer than a session's. Null on a first visit, or for an account not recorded.
 */
export async function previousVisit(userId: string, now = Date.now()): Promise<Date | null> {
  const rows = await db
    .select({ minute: activityMinutes.minute })
    .from(activityMinutes)
    .where(and(eq(activityMinutes.userId, userId), gte(activityMinutes.minute, new Date(now - 30 * 86_400_000))))
    .orderBy(desc(activityMinutes.minute))
    .limit(3000);
  let after = now;
  for (const { minute } of rows) {
    const at = new Date(minute).getTime();
    if (after - at > SESSION_GAP_MINUTES * 60_000) return new Date(at + 60_000);
    after = at;
  }
  return null;
}

/** What happened while the member was away, for Beranda: new signal calls, price levels hit, analyses finished. */
analyticsApi.get("/activity/since", async (c) => {
  const user = c.get("user");
  const since = await previousVisit(user.id);
  if (!since) return c.json({ since: null, calls: [], hits: [], analyses: [] });
  const [calls, hits, finished] = await Promise.all([
    db
      .select({ id: signalEvents.id, tvSymbol: signalEvents.tvSymbol, indicator: signalEvents.indicator, timeframe: signalEvents.timeframe, label: signalEvents.label, status: signalEvents.status, at: signalEvents.createdAt })
      .from(signalEvents)
      // A live call, not the history a new notification records silently on its first scan.
      .where(and(eq(signalEvents.userId, user.id), gt(signalEvents.createdAt, since), or(isNotNull(signalEvents.notifiedAt), isNull(signalEvents.closeNotifiedAt))))
      .orderBy(desc(signalEvents.createdAt))
      .limit(20),
    db
      .select({ id: priceAlerts.id, tvSymbol: priceAlerts.tvSymbol, price: priceAlerts.price, direction: priceAlerts.direction, at: priceAlerts.triggeredAt })
      .from(priceAlerts)
      .where(and(eq(priceAlerts.userId, user.id), gt(priceAlerts.triggeredAt, since)))
      .orderBy(desc(priceAlerts.triggeredAt))
      .limit(20),
    db
      .select({ id: analyses.id, ticker: analyses.ticker, rating: analyses.rating, at: analyses.finishedAt })
      .from(analyses)
      .where(and(eq(analyses.userId, user.id), eq(analyses.kind, "analysis"), eq(analyses.status, "completed"), gt(analyses.finishedAt, since)))
      .orderBy(desc(analyses.finishedAt))
      .limit(20),
  ]);
  const stamp = <T extends { at: Date | string | null }>(rows: T[]) => rows.map((r) => ({ ...r, at: iso(r.at) }));
  return c.json({ since: since.toISOString(), calls: stamp(calls), hits: stamp(hits), analyses: stamp(finished) });
});

analyticsApi.use("/admin/activity", requireAdmin);
analyticsApi.use("/admin/activity/*", requireAdmin);

/** The asked period in days, and its first moment: a WIB midnight. */
function period(asked: string | undefined) {
  const days = PERIODS.includes(Number(asked)) ? Number(asked) : 30;
  const today = Math.floor((Date.now() + WIB_MS) / 86_400_000) * 86_400_000 - WIB_MS;
  return { days, since: new Date(today - (days - 1) * 86_400_000), today: new Date(today) };
}

const day = sql<string>`to_char(${activityMinutes.minute} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;
const dow = sql<number>`extract(isodow from ${activityMinutes.minute} at time zone 'Asia/Jakarta')::int`;
const hour = sql<number>`extract(hour from ${activityMinutes.minute} at time zone 'Asia/Jakarta')::int`;
const minutes = sql<number>`count(*)::int`;
const people = sql<number>`count(distinct ${activityMinutes.userId})::int`;
const done = sql<number>`count(*)::int`;
const iso = (at: Date | string | null) => (at ? new Date(at).toISOString() : null);
const isOnline = (at: Date | string | null) => Boolean(at && new Date(at).getTime() >= Date.now() - ONLINE_MINUTES * 60_000);

/** Everyone: who is online, active members per day, the week's busy hours, screens, symbols, features, and each member. */
analyticsApi.get("/admin/activity", async (c) => {
  const { days, since, today } = period(c.req.query("days"));
  const inPeriod = gte(activityMinutes.minute, since);
  const [online, [totals], [todays], daily, heatmap, screens, symbols, features, perUser, lastSeen, eventsPerUser, members] = await Promise.all([
    db
      .selectDistinctOn([activityMinutes.userId], {
        id: activityMinutes.userId,
        username: users.username,
        at: activityMinutes.minute,
        screen: activityMinutes.screen,
        tab: activityMinutes.tab,
        symbol: activityMinutes.symbol,
      })
      .from(activityMinutes)
      .innerJoin(users, eq(users.id, activityMinutes.userId))
      .where(gte(activityMinutes.minute, new Date(Date.now() - ONLINE_MINUTES * 60_000)))
      .orderBy(activityMinutes.userId, desc(activityMinutes.minute)),
    db
      .select({ minutes, people, memberDays: sql<number>`count(distinct (${activityMinutes.userId}, ${day}))::int` })
      .from(activityMinutes)
      .where(inPeriod),
    db.select({ people }).from(activityMinutes).where(gte(activityMinutes.minute, today)),
    db.select({ day, people, minutes }).from(activityMinutes).where(inPeriod).groupBy(day).orderBy(day),
    db.select({ dow, hour, minutes }).from(activityMinutes).where(inPeriod).groupBy(dow, hour),
    db
      .select({ screen: activityMinutes.screen, tab: activityMinutes.tab, minutes, people })
      .from(activityMinutes)
      .where(inPeriod)
      .groupBy(activityMinutes.screen, activityMinutes.tab)
      .orderBy(desc(minutes)),
    db
      .select({ symbol: sql<string>`${activityMinutes.symbol}`, minutes, people })
      .from(activityMinutes)
      .where(and(inPeriod, isNotNull(activityMinutes.symbol)))
      .groupBy(activityMinutes.symbol)
      .orderBy(desc(minutes))
      .limit(15),
    db
      .select({ kind: activityEvents.kind, count: done, people: sql<number>`count(distinct ${activityEvents.userId})::int` })
      .from(activityEvents)
      .where(gte(activityEvents.at, since))
      .groupBy(activityEvents.kind)
      .orderBy(desc(done)),
    db
      .select({
        id: activityMinutes.userId,
        minutes,
        days: sql<number>`count(distinct ${day})::int`,
        topScreen: sql<string>`mode() within group (order by ${activityMinutes.screen})`,
      })
      .from(activityMinutes)
      .where(inPeriod)
      .groupBy(activityMinutes.userId),
    db.select({ id: activityMinutes.userId, at: max(activityMinutes.minute) }).from(activityMinutes).groupBy(activityMinutes.userId),
    db.select({ id: activityEvents.userId, count: count() }).from(activityEvents).where(gte(activityEvents.at, since)).groupBy(activityEvents.userId),
    db
      .select({ id: users.id, username: users.username, email: users.email, role: users.role, plan: users.plan, planUntil: users.planUntil, createdAt: users.createdAt })
      .from(users)
      .where(ne(users.role, "admin")),
  ]);
  const stats = new Map(perUser.map((u) => [u.id, u]));
  const seen = new Map(lastSeen.map((u) => [u.id, u.at]));
  const acts = new Map(eventsPerUser.map((u) => [u.id, u.count]));
  return c.json({
    days,
    keepDays: KEEP_DAYS,
    online: online.map((o) => ({ ...o, at: iso(o.at) })),
    summary: {
      members: members.length,
      active: totals.people,
      today: todays.people,
      minutes: totals.minutes,
      /** Average active minutes of a member on a day they used the app. */
      perDay: totals.memberDays ? Math.round(totals.minutes / totals.memberDays) : 0,
    },
    daily,
    heatmap,
    screens,
    symbols,
    features,
    users: members
      .map((u) => {
        const s = stats.get(u.id);
        const at = seen.get(u.id) ?? null;
        return {
          id: u.id,
          username: u.username,
          email: u.email,
          plan: planOf(u),
          createdAt: iso(u.createdAt),
          lastSeen: iso(at),
          online: isOnline(at),
          minutes: s?.minutes ?? 0,
          days: s?.days ?? 0,
          topScreen: s?.topScreen ?? null,
          events: acts.get(u.id) ?? 0,
        };
      })
      .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.username.localeCompare(b.username)),
  });
});

/** Runs of active minutes with no gap over SESSION_GAP_MINUTES, newest first: when the member was online and where. */
async function sessionsOf(userId: string, since: Date) {
  const rows = await db.execute<{ start: Date | string; end: Date | string; minutes: number; screens: string[] }>(sql`
    with marked as (
      select minute, screen,
        case when minute - lag(minute) over (order by minute) <= make_interval(mins => ${SESSION_GAP_MINUTES}::int) then 0 else 1 end as fresh
      from ${activityMinutes}
      where ${activityMinutes.userId} = ${userId} and ${activityMinutes.minute} >= ${since.toISOString()}::timestamptz
    ), numbered as (
      select minute, screen, sum(fresh) over (order by minute) as session from marked
    )
    select min(minute) as start, max(minute) as end, count(*)::int as minutes, array_agg(distinct screen) as screens
    from numbered group by session order by start desc limit 30`);
  return [...rows].map((r) => ({ start: iso(r.start), end: iso(r.end), minutes: r.minutes, screens: r.screens }));
}

/** One member: when they were online, how long a day, their hours of the week, screens, symbols, features, and what they did. */
analyticsApi.get("/admin/activity/users/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Pengguna tidak ditemukan" }, 404);
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return c.json({ error: "Pengguna tidak ditemukan" }, 404);
  const { days, since } = period(c.req.query("days"));
  const theirs = and(eq(activityMinutes.userId, id), gte(activityMinutes.minute, since));
  const theirEvents = and(eq(activityEvents.userId, id), gte(activityEvents.at, since));
  const [[seen], daily, heatmap, screens, symbols, features, sessions, events] = await Promise.all([
    db.select({ at: max(activityMinutes.minute) }).from(activityMinutes).where(eq(activityMinutes.userId, id)),
    db.select({ day, minutes }).from(activityMinutes).where(theirs).groupBy(day).orderBy(day),
    db.select({ dow, hour, minutes }).from(activityMinutes).where(theirs).groupBy(dow, hour),
    db
      .select({ screen: activityMinutes.screen, tab: activityMinutes.tab, minutes })
      .from(activityMinutes)
      .where(theirs)
      .groupBy(activityMinutes.screen, activityMinutes.tab)
      .orderBy(desc(minutes)),
    db
      .select({ symbol: sql<string>`${activityMinutes.symbol}`, minutes })
      .from(activityMinutes)
      .where(and(theirs, isNotNull(activityMinutes.symbol)))
      .groupBy(activityMinutes.symbol)
      .orderBy(desc(minutes))
      .limit(10),
    db.select({ kind: activityEvents.kind, count: done }).from(activityEvents).where(theirEvents).groupBy(activityEvents.kind).orderBy(desc(done)),
    sessionsOf(id, since),
    db
      .select({ at: activityEvents.at, kind: activityEvents.kind, symbol: activityEvents.symbol, detail: activityEvents.detail })
      .from(activityEvents)
      .where(theirEvents)
      .orderBy(desc(activityEvents.at))
      .limit(100),
  ]);
  return c.json({
    days,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      plan: planOf(user),
      createdAt: iso(user.createdAt),
      lastSeen: iso(seen?.at ?? null),
      online: isOnline(seen?.at ?? null),
    },
    daily,
    heatmap,
    screens,
    symbols,
    features,
    sessions,
    events: events.map((e) => ({ ...e, at: iso(e.at) })),
  });
});
