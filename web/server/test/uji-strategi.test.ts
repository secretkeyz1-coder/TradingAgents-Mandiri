// Uji strategi reads two numbers off the server instead of working them out itself: how many Uji indikator
// runs are left today (/api/usage, the same 24-hour window POST /lab/run enforces), and each backtest's
// score in the list (/api/analyses?kind=backtest), counted the way the engine scores a call.
import { expect, test } from "bun:test";
import { PLANS } from "../../shared/plans";
import { db } from "../src/db";
import { analyses, labRuns, type BacktestRequest, type BacktestResult } from "../src/db/schema";
import { call, member } from "./helpers";

test("usage says how many lab runs the last 24 hours used, against the plan's", async () => {
  const m = await member();
  const run = (hoursAgo: number) => ({ userId: m.id, name: "Fib Golden Zone", config: {}, result: {}, createdAt: new Date(Date.now() - hoursAgo * 3_600_000) });
  await db.insert(labRuns).values([run(1), run(23), run(25)]);

  const usage = await call("/api/usage", { cookie: m.cookie });
  expect(usage.status).toBe(200);
  expect(usage.body.lab).toEqual({ used: 2, limit: PLANS.free.limits.labRuns });
});

test("a backtest in the list carries how many of its directional calls were right", async () => {
  const m = await member();
  const models = { analysts: ["market"], depth: 1, provider: "openai", quickModel: "m", deepModel: "m", language: "Indonesian" };
  const request: BacktestRequest = { ...models, tickers: ["BTC-USD"], start: "2026-09-01", end: "2026-09-29", everyNDays: 7 };
  const cell = (rating: string, alpha: number | null, pending = false) => ({ ticker: "BTC-USD", date: "2026-09-01", rating, pending, return: alpha, alpha, holding: "5 trading days" });
  const result: BacktestResult = {
    runId: "run-1",
    cells: [cell("Buy", 0.02), cell("Overweight", -0.01), cell("Sell", 0.01), cell("Underweight", -0.03), cell("Hold", 0.05), cell("Buy", null, true)],
    summary: null,
    failures: [],
    settlementFailures: [],
  };
  const row = { userId: m.id, kind: "backtest" as const, ticker: "BTC-USD", tradeDate: "2026-09-29", request };
  const [done] = await db.insert(analyses).values({ ...row, status: "completed", result }).returning({ id: analyses.id });
  const [queued] = await db.insert(analyses).values({ ...row, status: "queued" }).returning({ id: analyses.id });
  await db.insert(analyses).values({ userId: m.id, kind: "analysis", ticker: "BTC-USD", tradeDate: "2026-09-29", request: { ...models, ticker: "BTC-USD", date: "2026-09-29" }, status: "completed" });

  const list = await call("/api/analyses?kind=backtest", { cookie: m.cookie });
  expect(list.status).toBe(200);
  const byId = new Map<string, { score?: unknown }>(list.body.map((r: { id: string }) => [r.id, r]));
  // Buy and Underweight beat the benchmark their way, Overweight and Sell did not; Hold and the pending call are not scored.
  expect(byId.get(done.id)?.score).toEqual({ calls: 4, hits: 2 });
  expect(byId.get(queued.id)?.score).toBeNull();

  // An analysis has no score to carry.
  const plain = await call("/api/analyses", { cookie: m.cookie });
  expect(plain.status).toBe(200);
  expect(plain.body).toHaveLength(1);
  expect("score" in plain.body[0]).toBe(false);
});
