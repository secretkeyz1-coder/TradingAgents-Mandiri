// Riwayat call (GET /api/alerts/calls, alerts.ts, ADR 0021): every live call of the period, a page
// at a time and newest first, with a cursor that new calls on top do not shift; filtered on the
// server by result, asset, indicator and arrival, so a filter's count and its list agree; private
// to its member; a bad filter is refused. Beranda's own read (GET /api/alerts/history) keeps the
// newest few and every call still running. The signals are written straight to the table, as the
// scan would, so nothing reaches a market.
import { expect, test } from "bun:test";
import { db } from "../src/db";
import { signalAlerts, signalEvents } from "../src/db/schema";
import { call, member } from "./helpers";

type Call = { id: string; status: string; symbol: string; at: string; tracked: boolean };

test("the call history pages by cursor, filters on the server and stays private", async () => {
  const a = await member({ verified: true });
  const b = await member({ verified: true });
  const [btc, eth] = await db
    .insert(signalAlerts)
    .values([
      { userId: a.id, symbol: "BTC-USD", tvSymbol: "BINANCE:BTCUSDT", indicator: "scalper", timeframe: "15m", primed: true },
      { userId: a.id, symbol: "ETH-USD", tvSymbol: "BINANCE:ETHUSDT", indicator: "fib", timeframe: "1h", primed: true },
    ])
    .returning();
  const base = Date.now() - 2 * 3_600_000;
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  const of = (alert: typeof btc) => ({ alertId: alert.id, userId: a.id, symbol: alert.symbol, tvSymbol: alert.tvSymbol, indicator: alert.indicator, timeframe: alert.timeframe, venue: "", side: "BUY", label: "BUY · uji", entry: 100, stopLoss: 95, takeProfit: 110 });
  // Eight Bitcoin calls a minute apart, oldest first, after two Ethereum ones.
  const btcStatuses = ["win", "loss", "replaced", "loss", "win", "exit", "loss", "open"] as const;
  await db.insert(signalEvents).values([
    ...btcStatuses.map((status, i) => ({ ...of(btc), signalTime: `2026-11-02 0${i}:00`, status, notifiedAt: at(i), createdAt: at(i) })),
    { ...of(eth), signalTime: "2026-11-02 00:00", status: "win" as const, notifiedAt: at(-30), createdAt: at(-30) },
    { ...of(eth), signalTime: "2026-11-02 01:00", status: "loss" as const, notifiedAt: at(-20), createdAt: at(-20) },
    // A new alert's first scan, recorded closed and never announced: not a call.
    { ...of(btc), signalTime: "2026-11-01 23:00", status: "win" as const, closeNotifiedAt: at(-40), createdAt: at(-40) },
  ]);

  const first = await call("/api/alerts/calls?days=7&limit=3", { cookie: a.cookie });
  expect(first.status).toBe(200);
  expect(first.body.total).toBe(10);
  expect(first.body.counts).toEqual({ all: 10, open: 1, win: 3, loss: 4, other: 2 });
  expect(first.body.calls.map((c: Call) => c.status)).toEqual(["open", "loss", "exit"]);
  expect(first.body.calls[0]).toMatchObject({ symbol: "BTC-USD", tracked: true, at: at(7).toISOString() });
  expect(first.body.next).toEqual(expect.any(String));
  // Each WIB day's heading counts all its calls in the filter, whatever page they are on.
  expect(first.body.days.reduce((n: number, d: { total: number }) => n + d.total, 0)).toBe(10);

  // A call that comes in while the member reads does not shift the pages already read.
  await db.insert(signalEvents).values({ ...of(btc), signalTime: "2026-11-02 09:00", status: "open", notifiedAt: new Date(), createdAt: new Date() });
  const seen: Call[] = [...first.body.calls];
  let next: string | null = first.body.next;
  while (next) {
    const page = await call(`/api/alerts/calls?days=7&limit=3&before=${encodeURIComponent(next)}`, { cookie: a.cookie });
    expect(page.status).toBe(200);
    seen.push(...page.body.calls);
    next = page.body.next;
  }
  expect(seen).toHaveLength(10);
  expect(new Set(seen.map((c) => c.id)).size).toBe(10);
  expect(seen.map((c) => c.at)).toEqual([...seen.map((c) => c.at)].sort().reverse());

  // Filters run on the server: a result's count is its list's length.
  const losses = await call("/api/alerts/calls?days=7&status=loss", { cookie: a.cookie });
  expect(losses.body.total).toBe(4);
  expect(losses.body.calls.every((c: Call) => c.status === "loss")).toBe(true);
  const other = await call("/api/alerts/calls?days=7&status=other", { cookie: a.cookie });
  expect(other.body.calls.map((c: Call) => c.status).sort()).toEqual(["exit", "replaced"]);
  const ether = await call("/api/alerts/calls?days=7&symbol=ETH-USD", { cookie: a.cookie });
  expect(ether.body.counts).toEqual({ all: 2, open: 0, win: 1, loss: 1, other: 0 });
  expect((await call("/api/alerts/calls?days=7&indicator=fib&timeframe=1h", { cookie: a.cookie })).body.total).toBe(2);
  const recent = await call(`/api/alerts/calls?days=7&since=${encodeURIComponent(at(5.5).toISOString())}`, { cookie: a.cookie });
  expect(recent.body.calls.map((c: Call) => c.status)).toEqual(["open", "open", "loss"]);

  // A filter it cannot read is refused rather than ignored.
  for (const bad of ["status=menang", "limit=0", "limit=500", "days=5", "before=kemarin", "since=kemarin", "symbol=BTC%20USD"]) {
    const r = await call(`/api/alerts/calls?${bad}`, { cookie: a.cookie });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Saringan riwayat call tidak valid");
  }

  // Another member sees none of it.
  const theirs = await call("/api/alerts/calls?days=7", { cookie: b.cookie });
  expect(theirs.body).toMatchObject({ calls: [], next: null, total: 0 });

  // Beranda keeps the newest few, and every call still running however old.
  const history = await call("/api/alerts/history?days=7", { cookie: a.cookie });
  expect(history.body.calls).toHaveLength(8);
  expect(history.body.summary.total).toBe(11);
  expect(history.body.open.map((c: Call) => c.status)).toEqual(["open", "open"]);
  expect(history.body.open.every((c: Call) => c.tracked)).toBe(true);
});
