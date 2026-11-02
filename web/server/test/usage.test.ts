// The daily analysis cap (usage.ts) charges what a member got: a run a restart or deploy cut off
// is given back, a backtest that stopped early counts the cells it ran, and the rest count as before.
import { expect, test } from "bun:test";
import { db } from "../src/db";
import { analyses, type AnalysisRequest } from "../src/db/schema";
import { SERVER_STOPPED, WORKER_STOPPED } from "../src/jobs";
import { call, member } from "./helpers";

const request: AnalysisRequest = { ticker: "BTC-USD", date: "2026-11-01", analysts: ["market"], depth: 1, provider: "openai", quickModel: "m", deepModel: "m", language: "Indonesian" };

test("a run the server lost does not use up the day's analyses", async () => {
  const m = await member({ verified: true });
  const row = (status: "completed" | "failed" | "cancelled" | "running", extra: Partial<typeof analyses.$inferInsert> = {}) => ({
    userId: m.id,
    ticker: "BTC-USD",
    tradeDate: "2026-11-01",
    request,
    status,
    startedAt: new Date(),
    ...extra,
  });
  const cells = (done: number, total: number) => ({ done, total, ticker: null, date: null });
  await db.insert(analyses).values([
    row("failed", { error: WORKER_STOPPED }),
    row("failed", { error: SERVER_STOPPED }),
    row("failed", { error: "Worker berhenti tanpa hasil (exit 1)." }),
    row("completed"),
    row("cancelled", { startedAt: null }),
    row("failed", { kind: "backtest", error: SERVER_STOPPED, progress: cells(2, 7) }),
    row("running", { kind: "backtest", progress: cells(1, 5) }),
  ]);

  const usage = await call("/api/usage", { cookie: m.cookie });
  expect(usage.status).toBe(200);
  // The crashed run and the finished one, the two cells the stopped backtest ran, the five the running one holds.
  expect(usage.body.analyses.used).toBe(1 + 1 + 2 + 5);
});
