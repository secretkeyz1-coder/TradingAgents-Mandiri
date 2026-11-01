// Member activity (activity.ts records it, analytics.ts reads it): the page's beat makes one
// row per minute, admins are not recorded, the server records what members do where it
// happens, and the admin console reads who is online, the busy hours of the week in WIB, the
// sessions and each member's history. Rows older than 90 days go. Minutes at chosen moments
// are written with recordMinute, so no test waits for the clock.
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { pruneActivity, recordMinute } from "../src/activity";
import { db } from "../src/db";
import { activityEvents, activityMinutes } from "../src/db/schema";
import { admin, call, member } from "./helpers";

const beat = (cookie: string, body: unknown) => call("/api/activity", { cookie, body });
const as = (m: { id: string }) => ({ id: m.id, role: "member" as const });
/** The ISO weekday (Monday 1) and hour of a moment in WIB, as the heatmap counts them. */
const wib = (at: number) => {
  const d = new Date(at + 7 * 3_600_000);
  return { dow: d.getUTCDay() || 7, hour: d.getUTCHours() };
};

test("a beat records the minute with its place; a bad one is refused and an admin's is not kept", async () => {
  const m = await member();
  expect((await beat(m.cookie, { screen: "pasar", tab: "screener", symbol: "idx:bbca" })).status).toBe(204);
  const [row] = await db.select().from(activityMinutes).where(eq(activityMinutes.userId, m.id));
  expect(row).toMatchObject({ screen: "pasar", tab: "screener", symbol: "IDX:BBCA" });

  expect((await beat(m.cookie, { screen: "dapur" })).status).toBe(400);
  expect((await beat(m.cookie, { screen: "pasar", symbol: "<b>BBCA</b>" })).status).toBe(400);
  expect((await call("/api/activity", { body: { screen: "pasar" } })).status).toBe(401);

  const before = await db.$count(activityMinutes);
  expect((await beat(await admin(), { screen: "pasar" })).status).toBe(204);
  expect(await db.$count(activityMinutes)).toBe(before);
});

test("beats in the same minute make one row, and the latest place wins", async () => {
  const m = await member();
  const at = Math.floor(Date.now() / 60_000) * 60_000 - 3_600_000;
  await recordMinute(as(m), { screen: "beranda" }, at + 5_000);
  await recordMinute(as(m), { screen: "uji", tab: "lab" }, at + 50_000);
  const rows = await db.select().from(activityMinutes).where(eq(activityMinutes.userId, m.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ screen: "uji", tab: "lab", symbol: null });
});

test("the server records what a member does where it happens", async () => {
  const m = await member();
  expect((await call("/api/scripts", { cookie: m.cookie, body: { name: "Coba", code: "plot(close)" } })).status).toBe(201);
  const events = await db.select().from(activityEvents).where(eq(activityEvents.userId, m.id));
  expect(events.map((e) => e.kind).sort()).toEqual(["login", "script"]);
  expect(events.find((e) => e.kind === "script")?.detail).toEqual({ name: "Coba" });
});

test("the admin sees who is online, the busy hours in WIB, sessions and each member", async () => {
  const m = await member({ plan: "pro" });
  // Two days ago, five minutes past a WIB hour: a 3-minute session, then 30 minutes later a 2-minute one.
  const hourStart = Math.floor((Date.now() - 2 * 86_400_000) / 3_600_000) * 3_600_000;
  const start = hourStart + 5 * 60_000;
  for (const k of [0, 1, 2]) await recordMinute(as(m), { screen: "pasar", symbol: "IDX:BBCA" }, start + k * 60_000);
  for (const k of [30, 31]) await recordMinute(as(m), { screen: "riset", tab: "report", symbol: "BINANCE:BTCUSDT" }, start + k * 60_000);
  // And now.
  await recordMinute(as(m), { screen: "uji", tab: "lab" });

  const outsider = await member();
  expect((await call("/api/admin/activity", { cookie: outsider.cookie })).status).toBe(403);
  expect((await call(`/api/admin/activity/users/${m.id}`, { cookie: outsider.cookie })).status).toBe(403);

  const all = await call("/api/admin/activity?days=7", { cookie: await admin() });
  expect(all.status).toBe(200);
  expect(all.body.days).toBe(7);
  expect(all.body.online).toContainEqual(expect.objectContaining({ id: m.id, username: m.username, screen: "uji", tab: "lab" }));
  const mine = all.body.users.find((u: { id: string }) => u.id === m.id);
  expect(mine).toMatchObject({ plan: "pro", online: true, minutes: 6, topScreen: "pasar" });
  expect(mine.events).toBeGreaterThanOrEqual(1);
  expect(all.body.users.some((u: { username: string }) => u.username === process.env.APP_USER)).toBe(false);
  const { dow, hour } = wib(start);
  expect(all.body.heatmap.find((h: { dow: number; hour: number }) => h.dow === dow && h.hour === hour)?.minutes).toBeGreaterThanOrEqual(5);
  expect(all.body.symbols.find((s: { symbol: string }) => s.symbol === "IDX:BBCA")?.minutes).toBeGreaterThanOrEqual(3);
  expect(all.body.summary.active).toBeGreaterThanOrEqual(1);

  const one = await call(`/api/admin/activity/users/${m.id}?days=7`, { cookie: await admin() });
  expect(one.status).toBe(200);
  expect(one.body.user).toMatchObject({ username: m.username, plan: "pro", online: true });
  // Newest first: now, then the 2-minute run, then the 3-minute one (a 28-minute gap splits them).
  expect(one.body.sessions.map((s: { minutes: number }) => s.minutes)).toEqual([1, 2, 3]);
  expect(one.body.sessions[2].start).toBe(new Date(start).toISOString());
  expect(one.body.sessions[1].screens).toEqual(["riset"]);
  expect(one.body.daily.reduce((n: number, d: { minutes: number }) => n + d.minutes, 0)).toBe(6);
  expect(one.body.screens).toContainEqual({ screen: "riset", tab: "report", minutes: 2 });
  expect(one.body.events.map((e: { kind: string }) => e.kind)).toContain("login");

  expect((await call(`/api/admin/activity/users/${crypto.randomUUID()}`, { cookie: await admin() })).status).toBe(404);
});

test("rows older than 90 days go", async () => {
  const m = await member();
  const old = Date.now() - 91 * 86_400_000;
  await recordMinute(as(m), { screen: "beranda" }, old);
  await recordMinute(as(m), { screen: "beranda" });
  await db.insert(activityEvents).values({ userId: m.id, kind: "chat", at: new Date(old) });
  await pruneActivity();
  expect(await db.$count(activityMinutes, eq(activityMinutes.userId, m.id))).toBe(1);
  expect((await db.select().from(activityEvents).where(eq(activityEvents.userId, m.id))).map((e) => e.kind)).toEqual(["login"]);
});
