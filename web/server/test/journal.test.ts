// The trade journal (journal.ts). A trade settles at its stop or target from a high or low after the
// bar it was recorded on, or the newest price, the stop first when one bar reaches both; the routes
// check the levels and the price now, keep each member's trades their own, and hold the plan's cap
// on open trades; the price check settles a trade and messages once; its owner can close or drop it;
// and the Sunday recap goes once a week. Every price here is made up (useQuotes) and messages go to
// a list (useJournalSender), so nothing reaches a market or Telegram.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { journalTrades, users } from "../src/db/schema";
import { resultR, sendJournalRecaps, settleJournal, settles, useJournalSender } from "../src/journal";
import type { Candle } from "../src/market";
import { useQuotes } from "../src/price-alerts";
import { call, member } from "./helpers";

const bar = (time: string, close: number, high = close, low = close): Candle => ({ time: `2026-11-01T${time}:00`, open: close, high, low, close, volume: 0 });

describe("settles()", () => {
  const buy = { side: "BUY" as const, stopLoss: 95, takeProfit: 110, armedBar: "2026-11-01T09:00:00" };
  test("a high or low after the armed bar settles it, never one before", () => {
    expect(settles(buy, [bar("09:00", 100, 120), bar("09:15", 104, 111, 101)])).toEqual({ status: "win", price: 110 });
    expect(settles(buy, [bar("09:00", 100, 100, 90), bar("09:15", 99, 101, 94)])).toEqual({ status: "loss", price: 95 });
    expect(settles(buy, [bar("08:45", 100, 120, 80), bar("09:00", 100, 120, 80)])).toBeNull();
  });
  test("a bar reaching both counts as the stop; the newest close settles too", () => {
    expect(settles(buy, [bar("09:00", 100), bar("09:15", 100, 112, 94)])).toEqual({ status: "loss", price: 95 });
    expect(settles(buy, [bar("09:00", 110)])).toEqual({ status: "win", price: 110 });
  });
  test("a sell mirrors it, and a trade not armed yet never settles", () => {
    const sell = { side: "SELL" as const, stopLoss: 105, takeProfit: 90, armedBar: "2026-11-01T09:00:00" };
    expect(settles(sell, [bar("09:00", 100), bar("09:15", 95, 99, 89)])).toEqual({ status: "win", price: 90 });
    expect(settles(sell, [bar("09:00", 100), bar("09:15", 103, 106, 99)])).toEqual({ status: "loss", price: 105 });
    expect(settles({ ...buy, armedBar: null }, [bar("09:00", 120)])).toBeNull();
  });
  test("results are in R", () => {
    expect(resultR({ side: "BUY", entry: 100, stopLoss: 95 }, 110)).toBe(2);
    expect(resultR({ side: "BUY", entry: 100, stopLoss: 95 }, 95)).toBe(-1);
    expect(resultR({ side: "SELL", entry: 100, stopLoss: 105 }, 97)).toBeCloseTo(0.6);
  });
});

describe("the journal", () => {
  let m: Awaited<ReturnType<typeof member>>;
  let candles: Candle[] = [bar("09:00", 100)];
  const sent: { chat: string | null; text: string }[] = [];
  const trade = (body: Record<string, unknown>) =>
    call("/api/journal", { cookie: m.cookie, body: { symbol: "BTC-USD", tvSymbol: "BINANCE:BTCUSDT", side: "BUY", entry: 100, stopLoss: 95, takeProfit: 110, ...body } });

  beforeAll(async () => {
    useQuotes(async (symbol) => (symbol === "BTC-USD" ? { candles, source: "binance" } : null));
    useJournalSender(async (chat, text) => {
      sent.push({ chat, text });
      return { ok: true };
    });
    m = await member();
    await db.update(users).set({ telegramChatId: "4242" }).where(eq(users.id, m.id));
  });
  afterAll(() => {
    useQuotes();
    useJournalSender();
  });

  let first = "";
  test("a trade needs its levels the right way round, and a price that has not passed them", async () => {
    const wrong = await trade({ stopLoss: 105 });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toContain("SL di bawah entry");
    expect((await trade({ entry: 102, stopLoss: 101 })).body.error).toContain("sudah melewati SL");
    expect((await trade({ side: "SELL", entry: 101, stopLoss: 104, takeProfit: 100 })).body.error).toContain("sudah melewati TP");

    const ok = await trade({ source: "scalper", label: "Scalper Pro+ 15m", mood: "fomo", note: "masuk telat", riskIdr: 100_000 });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ symbol: "BTC-USD", side: "BUY", status: "open", mood: "fomo", label: "Scalper Pro+ 15m", r: null });
    first = ok.body.id;
    const [row] = await db.select().from(journalTrades).where(eq(journalTrades.id, first));
    expect(row.armedBar).toBe("2026-11-01T09:00:00");
  });

  test("each member sees and changes only their own trades", async () => {
    const other = await member();
    expect((await call("/api/journal", { cookie: other.cookie })).body.items).toEqual([]);
    expect((await call(`/api/journal/${first}`, { method: "PATCH", cookie: other.cookie, body: { cancel: true } })).status).toBe(404);
    await call(`/api/journal/${first}`, { method: "DELETE", cookie: other.cookie });
    const mine = await call("/api/journal", { cookie: m.cookie });
    expect(mine.body.items.map((t: { id: string }) => t.id)).toEqual([first]);
    expect(mine.body).toMatchObject({ open: 1, max: 10 });
  });

  test("the plan caps open trades", async () => {
    const busy = await member();
    const [mine] = await db.select().from(journalTrades).where(eq(journalTrades.id, first));
    await db.insert(journalTrades).values(Array.from({ length: 10 }, () => ({ ...mine, id: undefined, userId: busy.id })));
    const over = await call("/api/journal", {
      cookie: busy.cookie,
      body: { symbol: "BTC-USD", tvSymbol: "BINANCE:BTCUSDT", side: "BUY", entry: 100, stopLoss: 95, takeProfit: 110 },
    });
    expect(over.status).toBe(409);
    expect(over.body.error).toContain("maksimal 10 trade terbuka");
    await db.delete(journalTrades).where(eq(journalTrades.userId, busy.id));
  });

  test("the price check settles a trade at its target and messages once", async () => {
    candles = [bar("09:00", 100), bar("09:15", 104, 111, 101)];
    await settleJournal();
    await settleJournal();
    const [row] = await db.select().from(journalTrades).where(eq(journalTrades.id, first));
    expect(row).toMatchObject({ status: "win", exitPrice: 110, r: 2 });
    expect(row.notifiedAt).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].chat).toBe("4242");
    expect(sent[0].text).toContain("BINANCE:BTCUSDT Beli kena TP di 110");
    expect(sent[0].text).toContain("+2,0R (≈ +Rp 200.000)");
  });

  test("its owner closes or drops a trade once, and a dropped one stays out of the results", async () => {
    const sell = await trade({ side: "SELL", entry: 105, stopLoss: 110, takeProfit: 95, mood: "calm" });
    expect(sell.status).toBe(201);
    const closed = await call(`/api/journal/${sell.body.id}`, { method: "PATCH", cookie: m.cookie, body: { close: { price: 102 } } });
    expect(closed.body).toMatchObject({ status: "closed", exitPrice: 102 });
    expect(closed.body.r).toBeCloseTo(0.6);
    expect((await call(`/api/journal/${sell.body.id}`, { method: "PATCH", cookie: m.cookie, body: { close: { price: 100 } } })).status).toBe(409);

    const dropped = await trade({});
    expect((await call(`/api/journal/${dropped.body.id}`, { method: "PATCH", cookie: m.cookie, body: { cancel: true, note: "batal masuk" } })).body).toMatchObject({
      status: "cancelled",
      note: "batal masuk",
      r: null,
    });

    const journal = await call("/api/journal", { cookie: m.cookie });
    expect(journal.body.open).toBe(0);
    expect(journal.body.summary).toMatchObject({ closed: 2, wins: 2, winRate: 1 });
    expect(journal.body.summary.totalR).toBeCloseTo(2.6);
    expect(journal.body.summary.byMood.map((g: { key: string }) => g.key).sort()).toEqual(["calm", "fomo"]);
  });

  test("the recap goes from Sunday 19.00 WIB, once a week, to members with Telegram", async () => {
    const wib = new Date(Date.now() + 7 * 3_600_000);
    const sunday = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + ((7 - wib.getUTCDay()) % 7), 19, 5) - 7 * 3_600_000);
    const before = sent.length;
    await sendJournalRecaps(new Date(+sunday - 86_400_000));
    await sendJournalRecaps(new Date(+sunday - 10 * 60_000));
    expect(sent).toHaveLength(before);

    await sendJournalRecaps(sunday);
    await sendJournalRecaps(new Date(+sunday + 10 * 60_000));
    const recaps = sent.slice(before);
    expect(recaps).toHaveLength(1);
    expect(recaps[0].chat).toBe("4242");
    expect(recaps[0].text).toContain("Rekap jurnal pekan ini");
    expect(recaps[0].text).toContain("Selesai: 2 trade · untung 2 (100%) · total +2,6R");
    expect(recaps[0].text).toContain("Per perasaan: FOMO +2,0R (1) · Tenang +0,6R (1)");
  });
});
