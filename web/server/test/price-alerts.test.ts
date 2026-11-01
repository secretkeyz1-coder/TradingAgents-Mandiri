// Price levels (price-alerts.ts). The routes pick a level's direction from the price
// now, refuse duplicates and the plan's cap, and share that cap with signal alerts;
// the checker fires a crossed level once, from the newest price or a high or low after
// the level was armed, never from older bars, and pauses levels past the allowance.
// Every price here is made up (useQuotes), so nothing reaches a market.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { priceAlerts, signalAlerts } from "../src/db/schema";
import type { Candle } from "../src/market";
import { checkPrices, crossed, useQuotes } from "../src/price-alerts";
import { call, member } from "./helpers";

const bar = (time: string, close: number, high = close, low = close): Candle => ({ time: `2026-11-01T${time}:00`, open: close, high, low, close, volume: 0 });

describe("crossed()", () => {
  const bars = [bar("09:00", 100, 110), bar("09:15", 101), bar("09:30", 101, 104, 99)];
  test("the newest close past the level fires, in either direction", () => {
    expect(crossed({ direction: "above", price: 100, armedBar: null }, bars)).toEqual({ now: 101, touched: false });
    expect(crossed({ direction: "below", price: 102, armedBar: null }, bars)).toEqual({ now: 101, touched: false });
  });
  test("a high or low touches only after the armed bar", () => {
    expect(crossed({ direction: "above", price: 103, armedBar: "2026-11-01T09:15:00" }, bars)).toEqual({ now: 101, touched: true });
    expect(crossed({ direction: "above", price: 105, armedBar: "2026-11-01T09:15:00" }, bars)).toBeNull();
    expect(crossed({ direction: "above", price: 105, armedBar: "2026-11-01T08:45:00" }, bars)?.touched).toBe(true);
    expect(crossed({ direction: "below", price: 99.5, armedBar: "2026-11-01T09:15:00" }, bars)?.touched).toBe(true);
  });
  test("no candles, no answer", () => {
    expect(crossed({ direction: "above", price: 1, armedBar: null }, [])).toBeNull();
  });
});

describe("the routes", () => {
  let m: Awaited<ReturnType<typeof member>>;
  const level = (price: number) => call("/api/price-alerts", { cookie: m.cookie, body: { symbol: "BTC-USD", tvSymbol: "BINANCE:BTCUSDT", price, label: "Bitcoin" } });

  beforeAll(async () => {
    useQuotes(async (symbol) => (symbol === "BTC-USD" ? { candles: [bar("09:00", 50_000)], source: "binance" } : null));
    m = await member();
  });
  afterAll(() => useQuotes());

  test("a new member has no levels and the plan's cap", async () => {
    const r = await call("/api/price-alerts", { cookie: m.cookie });
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    expect(r.body.used).toBe(0);
    expect(r.body.max).toBe(3);
  });

  test("the direction follows the price now; the same level again is the same alert", async () => {
    const up = await level(60_000);
    expect(up.status).toBe(201);
    expect(up.body.direction).toBe("above");
    expect(up.body.label).toBe("Bitcoin");
    const again = await level(60_000);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(up.body.id);
    const down = await level(40_000);
    expect(down.status).toBe(201);
    expect(down.body.direction).toBe("below");
  });

  test("a price that is not a price, or the price now, is refused; an unreadable symbol waits", async () => {
    expect((await level(-5)).status).toBe(400);
    expect((await level(50_000)).status).toBe(400);
    const unknown = await call("/api/price-alerts", { cookie: m.cookie, body: { symbol: "ZZNONE", tvSymbol: "ZZNONE", price: 1 } });
    expect(unknown.status).toBe(503);
  });

  test("the plan's notifications are the cap, shared with signal alerts", async () => {
    expect((await level(70_000)).status).toBe(201);
    expect((await level(80_000)).status).toBe(409);
    const signal = await call("/api/alerts", { cookie: m.cookie, body: { symbol: "BTC-USD", tvSymbol: "BINANCE:BTCUSDT", indicator: "pob", timeframe: "15m" } });
    expect(signal.status).toBe(409);
    expect((await call("/api/alerts", { cookie: m.cookie })).body.used).toBe(3);
  });

  test("only the owner deletes a level", async () => {
    const list = await call("/api/price-alerts?symbol=BTC-USD", { cookie: m.cookie });
    expect(list.body.items).toHaveLength(3);
    const id = list.body.items[0].id;
    const other = await member();
    await call(`/api/price-alerts/${id}`, { method: "DELETE", cookie: other.cookie });
    expect(await db.select().from(priceAlerts).where(eq(priceAlerts.id, id))).toHaveLength(1);
    expect((await call(`/api/price-alerts/${id}`, { method: "DELETE", cookie: m.cookie })).status).toBe(200);
    expect(await db.select().from(priceAlerts).where(eq(priceAlerts.id, id))).toHaveLength(0);
  });
});

describe("the checker", () => {
  const T = "ZZUJI";
  let m: Awaited<ReturnType<typeof member>>;
  let bars: Candle[] = [];
  const quote = async (symbol: string) => (symbol === T ? { candles: bars, source: "yahoo" } : null);
  const state = async () => Object.fromEntries((await db.select().from(priceAlerts).where(eq(priceAlerts.userId, m.id))).map((r) => [r.label, r]));
  const base = () => ({ userId: m.id, symbol: T, tvSymbol: "IDX:ZZUJI", armedBar: "2026-11-01T09:15:00" });

  beforeAll(async () => {
    m = await member();
    bars = [bar("08:45", 100, 110), bar("09:00", 100), bar("09:15", 101)];
    await db.insert(priceAlerts).values([
      { ...base(), label: "naik", direction: "above", price: 105 },
      { ...base(), label: "sentuh", direction: "above", price: 103 },
      { ...base(), label: "turun", direction: "below", price: 95 },
    ]);
  });

  test("a high from before the level was set never fires it", async () => {
    await checkPrices(quote);
    const s = await state();
    expect([s.naik.active, s.sentuh.active, s.turun.active]).toEqual([true, true, true]);
  });

  test("a later bar's high that reaches the level fires it; one that does not, waits", async () => {
    bars = [...bars, bar("09:30", 101, 104)];
    await checkPrices(quote);
    const s = await state();
    expect(s.sentuh.active).toBe(false);
    expect(s.sentuh.triggeredPrice).toBe(101);
    expect(s.sentuh.notifiedAt).toBeNull(); // no Telegram, no SMTP under test
    expect(s.naik.active).toBe(true);
  });

  test("the close past the level fires it, once", async () => {
    bars = [...bars, bar("09:45", 106)];
    await checkPrices(quote);
    let s = await state();
    const firedAt = s.naik.triggeredAt?.getTime();
    expect(s.naik.active).toBe(false);
    expect(s.naik.triggeredPrice).toBe(106);
    expect(s.turun.active).toBe(true);
    await checkPrices(quote);
    s = await state();
    expect(s.naik.triggeredAt?.getTime()).toBe(firedAt);
  });

  test("a fall past a level below fires it", async () => {
    bars = [...bars, bar("10:00", 94)];
    await checkPrices(quote);
    const s = await state();
    expect(s.turun.active).toBe(false);
    expect(s.turun.triggeredPrice).toBe(94);
  });

  test("a level set without a price is armed on the first one, without firing on earlier bars", async () => {
    await db.insert(priceAlerts).values({ ...base(), armedBar: null, label: "tanpa bar", direction: "above", price: 200 });
    await checkPrices(quote);
    const s = await state();
    expect(s["tanpa bar"].active).toBe(true);
    expect(s["tanpa bar"].armedBar).toBe("2026-11-01T10:00:00");
  });

  test("past the plan's allowance (signal alerts count first) a crossed level waits, then fires", async () => {
    await db.delete(priceAlerts).where(eq(priceAlerts.label, "tanpa bar"));
    await db.insert(priceAlerts).values({ ...base(), armedBar: "2026-11-01T10:00:00", label: "jeda", direction: "below", price: 99 });
    await db.insert(signalAlerts).values((["pob", "scalper", "fib"] as const).map((indicator) => ({ userId: m.id, symbol: T, tvSymbol: "IDX:ZZUJI", indicator, timeframe: "15m" })));
    await checkPrices(quote);
    expect((await state()).jeda.active).toBe(true);
    await db.delete(signalAlerts).where(eq(signalAlerts.userId, m.id));
    await checkPrices(quote);
    const s = await state();
    expect(s.jeda.active).toBe(false);
    expect(s.jeda.triggeredPrice).toBe(94);
  });
});
