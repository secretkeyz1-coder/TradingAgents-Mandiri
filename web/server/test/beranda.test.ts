// What Beranda's morning summary reads: last prices for many symbols at once (routes.ts
// /quotes, on canned daily bars instead of the network), and what happened since the
// member's previous visit (analytics.ts /activity/since), found from the gap in their
// activity minutes.
import { afterAll, expect, test } from "bun:test";
import { recordMinute } from "../src/activity";
import { db } from "../src/db";
import { analyses, priceAlerts, signalEvents } from "../src/db/schema";
import { useDailyCandles } from "../src/routes";
import { call, member } from "./helpers";

useDailyCandles(async (symbol) => {
  if (symbol === "RUSAK.JK") throw new Error("tidak ada data");
  const closes = symbol === "BBCA.JK" ? [4900, 5000] : [100, 99];
  return { candles: closes.map((close, i) => ({ time: `2026-10-${30 + i}`, close })), currency: "IDR", source: "yahoo" };
});
afterAll(() => useDailyCandles());

test("quotes give each symbol's last price and change, null where the data fails", async () => {
  const m = await member();
  const r = await call("/api/quotes?symbols=bbca.jk,BTC-USD,RUSAK.JK,BBCA.JK", { cookie: m.cookie });
  expect(r.status).toBe(200);
  expect(Object.keys(r.body.quotes).sort()).toEqual(["BBCA.JK", "BTC-USD", "RUSAK.JK"]);
  expect(r.body.quotes["BBCA.JK"]).toMatchObject({ price: 5000, currency: "IDR", delayed: true, time: "2026-10-31" });
  expect(r.body.quotes["BBCA.JK"].change).toBeCloseTo(5000 / 4900 - 1, 6);
  expect(r.body.quotes["RUSAK.JK"]).toBeNull();

  expect((await call("/api/quotes?symbols=", { cookie: m.cookie })).status).toBe(400);
  expect((await call("/api/quotes?symbols=<b>", { cookie: m.cookie })).status).toBe(400);
  const many = Array.from({ length: 81 }, (_, i) => `S${i}.JK`).join(",");
  expect((await call(`/api/quotes?symbols=${many}`, { cookie: m.cookie })).status).toBe(400);
});

test("since the previous visit: new calls, price levels hit and analyses finished, not what came before", async () => {
  const m = await member();
  const who = { id: m.id, role: "member" as const };
  const now = Date.now();
  // The previous visit ended three hours ago (on a whole minute, as minutes are kept); this one is under way.
  const left = Math.floor((now - 3 * 3_600_000) / 60_000) * 60_000;
  for (const k of [10, 5, 0]) await recordMinute(who, { screen: "pasar" }, left - k * 60_000);
  await recordMinute(who, { screen: "beranda" }, now);
  const before = new Date(left - 3_600_000);
  const away = new Date(now - 3_600_000);

  const pair = { userId: m.id, symbol: "BBCA.JK", tvSymbol: "IDX:BBCA", indicator: "fib" as const, timeframe: "1h", venue: "" };
  const call1 = { ...pair, signalTime: "2026-11-01 10:00", side: "BUY", label: "BUY · Fib", entry: 5000, stopLoss: 4900, takeProfit: 5200, status: "open" as const };
  await db.insert(signalEvents).values([
    { ...call1, createdAt: away },
    // Seen before the visit ended, and recorded silently as history: neither is new.
    { ...call1, signalTime: "2026-10-31 10:00", createdAt: before },
    { ...call1, signalTime: "2026-11-01 11:00", createdAt: away, closeNotifiedAt: away },
  ]);
  await db.insert(priceAlerts).values({ userId: m.id, symbol: "BBCA.JK", tvSymbol: "IDX:BBCA", direction: "above", price: 5100, active: false, triggeredAt: away });
  await db.insert(analyses).values({ userId: m.id, ticker: "BBCA.JK", tradeDate: "2026-11-01", request: {} as never, status: "completed", rating: "Buy", finishedAt: away });

  const r = await call("/api/activity/since", { cookie: m.cookie });
  expect(r.status).toBe(200);
  expect(r.body.since).toBe(new Date(left + 60_000).toISOString());
  expect(r.body.calls.map((c: { at: string }) => c.at)).toEqual([away.toISOString()]);
  expect(r.body.hits).toMatchObject([{ tvSymbol: "IDX:BBCA", price: 5100, direction: "above" }]);
  expect(r.body.analyses).toMatchObject([{ ticker: "BBCA.JK", rating: "Buy" }]);

  // A first visit has nothing to compare with.
  const fresh = await member();
  expect((await call("/api/activity/since", { cookie: fresh.cookie })).body).toEqual({ since: null, calls: [], hits: [], analyses: [] });
});
