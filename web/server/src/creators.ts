// Public track records for Creators. /c/<username> shows every live signal of
// the alerts a Creator published, frozen when it fired and scored after the
// simulated costs, as the signal ledger does (ledger.ts). The alert scan
// records them (alerts.ts), and they are only ever added and scored: a deleted
// or private alert keeps its past on the page, and a published alert with a
// signal still open cannot be deleted. A page is up while its owner is on
// Creator (or is an admin) and has turned it on.
import { and, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { publicUser, type AppEnv } from "./auth";
import { db } from "./db";
import { creatorSignals, signalAlerts, signalEvents, users } from "./db/schema";
import { tradeCost } from "./ledger";
import { planOf } from "./plans";

type Alert = typeof signalAlerts.$inferSelect;
type Event = typeof signalEvents.$inferSelect;
type Row = typeof creatorSignals.$inferSelect;
/** A scanned signal as alerts.ts holds it: its state now and, once closed, its result in R before costs. */
type Fired = { outcome: Row["status"]; exit_time: string | null; r?: number | null };

/** Put a published alert's live signal on its owner's record, as it fired. */
export async function recordCreatorSignal(alert: Alert, event: Event, fired: Fired, strategy: string) {
  const risk = Math.abs(event.entry - event.stopLoss);
  if (!(risk > 0) || !alert.userId) return;
  const closed = fired.outcome !== "open";
  await db
    .insert(creatorSignals)
    .values({
      userId: alert.userId,
      eventId: event.id,
      alertId: alert.id,
      symbol: alert.symbol,
      tvSymbol: alert.tvSymbol,
      venue: alert.venue,
      strategy,
      timeframe: alert.timeframe,
      signalTime: event.signalTime,
      side: event.side,
      label: event.label,
      entry: event.entry,
      stopLoss: event.stopLoss,
      takeProfit: event.takeProfit,
      status: fired.outcome,
      exitTime: fired.exit_time,
      grossR: closed ? (fired.r ?? null) : null,
      costR: tradeCost(alert.symbol, event.entry, false, alert.venue) / risk,
      closedAt: closed ? new Date() : null,
    })
    .onConflictDoNothing();
  pages.clear();
}

/** A recorded signal's outcome, when its alert event closes. */
export async function scoreCreatorSignal(eventId: string, fired: Fired) {
  const scored = await db
    .update(creatorSignals)
    .set({ status: fired.outcome, exitTime: fired.exit_time, grossR: fired.r ?? null, closedAt: new Date() })
    .where(and(eq(creatorSignals.eventId, eventId), eq(creatorSignals.status, "open")))
    .returning({ id: creatorSignals.id });
  if (scored.length) pages.clear();
}

/** Signals still open on an alert's public record; while there are any, the alert stays so its scan can score them. */
export async function openCreatorSignals(alertId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(creatorSignals)
    .where(and(eq(creatorSignals.alertId, alertId), eq(creatorSignals.status, "open")));
  return row.n;
}

const netR = (r: Row) => (r.grossR == null ? null : r.grossR - r.costR);

/** Closed signals with their win rate and average after costs, and how many are still open. */
function tally(rows: Row[]) {
  const results = rows.map(netR).filter((x): x is number => x !== null);
  const total = results.reduce((sum, x) => sum + x, 0);
  return {
    closed: results.length,
    open: rows.filter((r) => r.status === "open").length,
    winRate: results.length ? results.filter((x) => x > 0).length / results.length : null,
    avgR: results.length ? total / results.length : null,
    totalR: total,
  };
}

const live = (u: typeof users.$inferSelect) => u.publicProfile && !u.disabled && planOf(u) === "creator";

/** Rendered pages for a minute; any new or scored signal, or a settings change, clears them. */
const pages = new Map<string, { at: number; body: unknown }>();

async function page(username: string) {
  const [u] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
  if (!u || !live(u)) return null;
  const rows = await db.select().from(creatorSignals).where(eq(creatorSignals.userId, u.id)).orderBy(desc(creatorSignals.createdAt));
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.strategy}\u0000${r.timeframe}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return {
    username: u.username,
    name: u.displayName || u.username,
    bio: u.bio ?? "",
    since: rows.length ? rows[rows.length - 1].createdAt : null,
    record: tally(rows),
    strategies: [...groups.values()]
      .map((list) => ({ strategy: list[0].strategy, timeframe: list[0].timeframe, ...tally(list) }))
      .sort((a, b) => b.closed + b.open - (a.closed + a.open)),
    signals: rows.slice(0, 100).map((r) => ({
      at: r.createdAt,
      symbol: r.tvSymbol,
      strategy: r.strategy,
      timeframe: r.timeframe,
      side: r.side,
      entry: r.entry,
      stopLoss: r.stopLoss,
      takeProfit: r.takeProfit,
      status: r.status,
      netR: netR(r),
    })),
  };
}

/** Before the sign-in guard: the page's data, for anyone. */
export const creatorsPublicApi = new Hono();

creatorsPublicApi.get("/public/creators/:username", async (c) => {
  const name = c.req.param("username").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) return c.json({ error: "Halaman ini tidak ada" }, 404);
  let hit = pages.get(name);
  if (!hit || Date.now() - hit.at > 60_000) {
    const body = await page(name);
    if (!body) return c.json({ error: "Halaman ini tidak ada atau sedang tidak aktif" }, 404);
    if (pages.size > 500) pages.clear();
    hit = { at: Date.now(), body };
    pages.set(name, hit);
  }
  c.header("Cache-Control", "public, max-age=60");
  return c.json(hit.body);
});

/** Behind the guard: the owner's settings for the page and for each alert. */
export const creatorsApi = new Hono<AppEnv>();

const profileSchema = z.object({
  publicProfile: z.boolean().optional(),
  displayName: z.string().trim().max(60).nullable().optional(),
  bio: z.string().trim().max(400).nullable().optional(),
});

creatorsApi.patch("/me/profile", async (c) => {
  const body = profileSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const me = c.get("user");
  if (body.data.publicProfile && planOf(me) !== "creator") return c.json({ error: "Halaman rekam jejak publik khusus paket Creator" }, 403);
  const { publicProfile, displayName, bio } = body.data;
  const [updated] = await db
    .update(users)
    .set({
      ...(publicProfile !== undefined ? { publicProfile } : {}),
      ...(displayName !== undefined ? { displayName: displayName || null } : {}),
      ...(bio !== undefined ? { bio: bio || null } : {}),
    })
    .where(eq(users.id, me.id))
    .returning();
  pages.delete(me.username);
  return c.json(publicUser(updated));
});

creatorsApi.patch("/alerts/:id/public", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = z.object({ public: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Isi public: true atau false" }, 400);
  const me = c.get("user");
  if (body.data.public && planOf(me) !== "creator") return c.json({ error: "Halaman rekam jejak publik khusus paket Creator" }, 403);
  const [row] = await db
    .update(signalAlerts)
    .set({ public: body.data.public })
    .where(and(eq(signalAlerts.id, id), eq(signalAlerts.userId, me.id)))
    .returning();
  if (!row) return c.json({ error: "Not found" }, 404);
  pages.delete(me.username);
  return c.json({ id: row.id, public: row.public });
});
