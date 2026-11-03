// Uji strategi reads two numbers off the server instead of working them out itself: how many Uji indikator
// runs are left today (/api/usage, the same 24-hour window POST /lab/run enforces), and each backtest's
// score in the list (/api/analyses?kind=backtest), counted the way the engine scores a call. A backtest gets
// its run id when it is made, so one a restart cut off continues, by its own account only and for the cells left.
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { PLANS } from "../../shared/plans";
import { db } from "../src/db";
import { analyses, labRuns, type BacktestRequest, type BacktestResult } from "../src/db/schema";
import { SERVER_STOPPED } from "../src/jobs";
import { admin, call, member } from "./helpers";

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA");

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

const runOf = async (id: string) => (await db.select().from(analyses).where(eq(analyses.id, id)))[0];

// The first catalog read starts Python (web/worker), so making a backtest can take a while.
test("a backtest gets its run id when made, and only its own account continues it, paying for the cells left", async () => {
  const d = (await call("/api/options", { cookie: await admin() })).body.defaults;
  const m = await member({ plan: "pro", verified: true });
  const other = await member({ plan: "pro", verified: true });
  // Three dates a week apart, the last one today.
  const body = { tickers: ["BTC-USD"], start: day(14), end: day(0), everyNDays: 7, analysts: ["market"], depth: 1, language: "Indonesian", provider: d.provider, quickModel: d.quickModel, deepModel: d.deepModel };
  const made = await call("/api/backtests", { cookie: m.cookie, body });
  expect(made.status).toBe(201);
  expect(made.body.cells).toBe(3);
  const runId = ((await runOf(made.body.id)).request as BacktestRequest).runId!;
  expect(runId).toMatch(/^\d{8}_\d{6}_\d{6}$/);

  // While it waits in the queue, a second attempt would analyse the same cells.
  expect((await call("/api/backtests", { cookie: m.cookie, body: { ...body, runId } })).status).toBe(409);

  // A restart stops it after the first of its three dates.
  await db
    .update(analyses)
    .set({ status: "failed", error: SERVER_STOPPED, startedAt: new Date(), progress: { done: 1, total: 3, skipped: 0, ticker: null, date: null } })
    .where(eq(analyses.id, made.body.id));

  // Another account's run id names cells it must not read.
  expect((await call("/api/backtests", { cookie: other.cookie, body: { ...body, runId } })).status).toBe(404);

  const used = async () => (await call("/api/usage", { cookie: m.cookie })).body.analyses.used;
  const before = await used();
  const again = await call("/api/backtests", { cookie: m.cookie, body: { ...body, runId } });
  expect(again.status).toBe(201);
  const next = await runOf(again.body.id);
  expect((next.request as BacktestRequest).runId).toBe(runId);
  expect(next.progress).toMatchObject({ done: 0, total: 3, skipped: 1 });
  // The stopped attempt keeps its one date; the continuation holds only the two it still has to run.
  expect(await used()).toBe(before + 2);
}, 60_000);

test("a sweep finished before run ids came at the start continues under the id in its result, at no cost", async () => {
  const d = (await call("/api/options", { cookie: await admin() })).body.defaults;
  const m = await member({ plan: "pro", verified: true });
  const models = { analysts: ["market"], depth: 1, provider: d.provider, quickModel: d.quickModel, deepModel: d.deepModel, language: "Indonesian" };
  const request: BacktestRequest = { ...models, tickers: ["BTC-USD"], start: day(14), end: day(0), everyNDays: 7 };
  const cell = (date: string) => ({ ticker: "BTC-USD", date, rating: "Buy", pending: true, return: null, alpha: null, holding: null });
  const result: BacktestResult = { runId: "20261030_060412", cells: [cell(day(14)), cell(day(7)), cell(day(0))], summary: null, failures: [], settlementFailures: [] };
  await db.insert(analyses).values({
    userId: m.id,
    kind: "backtest",
    ticker: "BTC-USD",
    tradeDate: request.start,
    request,
    status: "completed",
    result,
    startedAt: new Date(),
    progress: { done: 3, total: 3, ticker: null, date: null },
  });

  const used = async () => (await call("/api/usage", { cookie: m.cookie })).body.analyses.used;
  const before = await used();
  // All three dates are in the run: settling the pending ones runs no new analysis.
  const again = await call("/api/backtests", { cookie: m.cookie, body: { ...request, runId: result.runId } });
  expect(again.status).toBe(201);
  expect((await runOf(again.body.id)).progress).toMatchObject({ total: 3, skipped: 3 });
  expect(await used()).toBe(before);
}, 60_000);
