// The engines' live record for the chart menus (GET /api/ledger/record, ledger.ts): per engine
// and timeframe over 90 days, a win counted only when the signal paid after costs, overall and
// per tracked symbol; backfilled history, other venues and older signals stay out. The rows are
// written straight to the table, as the scan would, so nothing reaches a market.
import { expect, test } from "bun:test";
import { db } from "../src/db";
import { ledgerSignals } from "../src/db/schema";
import { call, member } from "./helpers";

test("the record counts live default-source signals after costs, per engine, timeframe and symbol", async () => {
  // No other test writes the ledger; start it empty all the same, so the counts are this test's.
  await db.delete(ledgerSignals);
  const now = Date.now();
  let n = 0;
  const row = (
    source: string,
    symbol: string,
    timeframe: string,
    status: "open" | "win" | "loss" | "exit",
    grossR: number | null,
    extra: { live?: boolean; venue?: string; daysAgo?: number } = {},
  ) => {
    const at = new Date(now - (extra.daysAgo ?? 1) * 86_400_000 - n++ * 60_000);
    return {
      source,
      symbol,
      timeframe,
      signalTime: at.toISOString().slice(0, 16).replace("T", " "),
      signalAt: at,
      session: "asia",
      side: "BUY",
      label: "BUY · uji",
      entry: 100,
      stopLoss: 95,
      takeProfit: 110,
      status,
      grossR,
      costR: 0.1,
      dataSource: "binance",
      live: extra.live ?? true,
      venue: extra.venue ?? "",
      closedAt: status === "open" ? null : at,
    };
  };
  await db.insert(ledgerSignals).values([
    row("pob", "BTC-USD", "15m", "win", 2), // +1.9 after costs
    row("pob", "BTC-USD", "15m", "loss", -1), // −1.1
    row("pob", "BTC-USD", "15m", "exit", 0.05), // −0.05: closed above entry, lost after costs
    row("pob", "BTC-USD", "15m", "open", null),
    row("pob", "GC=F", "15m", "win", 1.5), // +1.4
    row("scalper", "ETH-USD", "15m", "loss", -1), // −1.1
    // Not counted: backfilled history, another venue, older than 90 days.
    row("pob", "BTC-USD", "15m", "win", 2, { live: false }),
    row("pob", "BTC-USD", "15m", "win", 2, { venue: "bybit" }),
    row("pob", "BTC-USD", "15m", "win", 2, { daysAgo: 120 }),
  ]);

  expect((await call("/api/ledger/record")).status).toBe(401);
  const someone = await member();
  const res = await call("/api/ledger/record", { cookie: someone.cookie });
  expect(res.status).toBe(200);
  expect(res.body.days).toBe(90);
  expect(res.body.symbols).toEqual(["BTC-USD", "ETH-USD", "GC=F"]);
  type Item = { source: string; timeframe: string; name: string; all: Record<string, number | null>; bySymbol: Record<string, Record<string, number | null>> };
  const item = (source: string, timeframe: string) => (res.body.items as Item[]).find((i) => i.source === source && i.timeframe === timeframe)!;

  const pob = item("pob", "15m");
  expect(pob.name).toBe("PoB BYSTRA");
  expect(pob.all).toMatchObject({ closed: 4, open: 1, wins: 2, winRate: 0.5 });
  expect(pob.all.expectancy).toBeCloseTo((1.9 - 1.1 - 0.05 + 1.4) / 4);
  expect(pob.bySymbol["BTC-USD"]).toMatchObject({ closed: 3, open: 1, wins: 1 });
  expect(pob.bySymbol["GC=F"]).toMatchObject({ closed: 1, wins: 1, winRate: 1 });
  expect(pob.bySymbol["ETH-USD"]).toMatchObject({ closed: 0, winRate: null, expectancy: null });

  expect(item("scalper", "15m").all).toMatchObject({ closed: 1, wins: 0, winRate: 0 });
  expect(item("scalper", "15m").all.expectancy).toBeCloseTo(-1.1);
  // Every engine and timeframe the ledger follows is listed, with or without signals.
  expect(item("fib", "1d").all).toMatchObject({ closed: 0, open: 0, winRate: null });
  expect(item("donchian", "1d").name).toBe("Donchian breakout");
});
