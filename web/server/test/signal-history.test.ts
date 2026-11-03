// A member's signal calls for Beranda (GET /api/alerts/history, alerts.ts): only signals that
// went out live count, not the history a new alert records silently; R comes from targets and
// stops; another member sees none of it; and removing the alert keeps the calls (migration 0025),
// its still-open one marked as no longer followed. The signals are written straight to the
// table, as the scan would, so nothing reaches a market.
import { expect, test } from "bun:test";
import { db } from "../src/db";
import { signalAlerts, signalEvents } from "../src/db/schema";
import { call, member } from "./helpers";

test("the history counts live calls, scores R, stays private, and outlives the alert", async () => {
  const a = await member({ verified: true });
  const b = await member({ verified: true });
  const [alert] = await db
    .insert(signalAlerts)
    .values({ userId: a.id, symbol: "BTC-USD", tvSymbol: "BINANCE:BTCUSDT", indicator: "scalper", timeframe: "15m", primed: true })
    .returning();
  const pair = { userId: a.id, symbol: alert.symbol, tvSymbol: alert.tvSymbol, indicator: alert.indicator, timeframe: alert.timeframe, venue: "" };
  const now = new Date();
  const signal = (time: string, status: "open" | "win" | "loss" | "expired", sent: boolean, closed: boolean) => ({
    alertId: alert.id,
    signalTime: `2026-11-01 ${time}`,
    side: "BUY",
    label: "BUY · uji",
    entry: 100,
    stopLoss: 95,
    takeProfit: 110,
    status,
    notifiedAt: sent ? now : null,
    closeNotifiedAt: closed ? now : null,
  });
  await db.insert(signalEvents).values([
    { ...pair, ...signal("09:00", "win", true, true) },
    { ...pair, ...signal("09:15", "loss", true, true) },
    { ...pair, ...signal("09:30", "open", true, false) },
    // Live but never delivered (no Telegram): still a call.
    { ...pair, ...signal("09:45", "expired", false, false) },
    // A new alert's first scan: recorded already closed and never announced.
    { ...pair, ...signal("08:00", "win", false, true) },
    // Recorded by the previous release before the owner columns existed.
    signal("10:00", "win", true, true),
  ]);

  const mine = await call("/api/alerts/history?days=7", { cookie: a.cookie });
  expect(mine.status).toBe(200);
  expect(mine.body.days).toBe(7);
  expect(mine.body.summary).toMatchObject({ total: 5, win: 2, loss: 1, open: 1, expired: 1, stopped: 0, r: 3, alerts: 1 });
  expect(mine.body.summary.winRate).toBeCloseTo(2 / 3);
  expect(mine.body.calls).toHaveLength(5);
  expect(mine.body.calls.map((c: { signalTime: string }) => c.signalTime)).not.toContain("2026-11-01 08:00");
  expect(mine.body.calls.find((c: { signalTime: string }) => c.signalTime === "2026-11-01 10:00")).toMatchObject({ symbol: "BTC-USD", indicator: "scalper", r: 2 });
  expect(mine.body.byIndicator).toEqual([expect.objectContaining({ indicator: "scalper", timeframe: "15m", total: 5, win: 2, loss: 1, r: 3 })]);

  const theirs = await call("/api/alerts/history", { cookie: b.cookie });
  expect(theirs.body.summary.total).toBe(0);
  expect(theirs.body.calls).toEqual([]);

  expect((await call(`/api/alerts/${alert.id}`, { method: "DELETE", cookie: a.cookie })).status).toBe(200);
  const after = await call("/api/alerts/history?days=7", { cookie: a.cookie });
  expect(after.body.summary).toMatchObject({ total: 5, win: 2, loss: 1, open: 0, stopped: 1, alerts: 0 });
  expect(after.body.calls.every((c: { tracked: boolean }) => !c.tracked)).toBe(true);
});

test("a script's call is scored at the R its run closed it with: two targets, the first only, or an order that never filled", async () => {
  const a = await member({ verified: true });
  const [alert] = await db
    .insert(signalAlerts)
    .values({ userId: a.id, symbol: "GC=F", tvSymbol: "COMEX:GC1!", indicator: "script:00000000-0000-0000-0000-000000000000", timeframe: "15m", primed: true })
    .returning();
  const pair = { userId: a.id, symbol: alert.symbol, tvSymbol: alert.tvSymbol, indicator: alert.indicator, timeframe: alert.timeframe, venue: "" };
  const now = new Date();
  const call_ = (time: string, status: "win" | "partial" | "unfilled", r: number | null) => ({
    ...pair,
    alertId: alert.id,
    signalTime: `2026-11-02 ${time}`,
    side: "BUY",
    label: "BUY · dua target",
    entry: 100,
    stopLoss: 95,
    // The last of two targets: 2R from its levels, though half the position closed at 1R.
    takeProfit: 110,
    status,
    r,
    notifiedAt: now,
    closeNotifiedAt: now,
  });
  await db.insert(signalEvents).values([call_("09:00", "win", 1.5), call_("09:15", "partial", 0.5), call_("09:30", "unfilled", null)]);

  const h = await call("/api/alerts/history?days=7", { cookie: a.cookie });
  expect(h.body.summary).toMatchObject({ total: 3, win: 1, loss: 0, partial: 1, unfilled: 1, r: 2 });
  // Finished with a result: the target and the first of two; the order that never filled is not one.
  expect(h.body.summary.winRate).toBeCloseTo(1 / 2);
  expect(h.body.calls.find((c: { status: string }) => c.status === "win")).toMatchObject({ r: 1.5 });
  expect(h.body.calls.find((c: { status: string }) => c.status === "unfilled")).toMatchObject({ r: null });
});
