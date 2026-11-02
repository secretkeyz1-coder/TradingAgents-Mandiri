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

// The first catalog read starts Python (web/worker), so the chat call can take a while.
test("an unverified member is told who opens the AI, not sent to a link that never came", async () => {
  const m = await member();
  const session = await call("/api/agent/sessions", { cookie: m.cookie, body: { symbol: "BBCA.JK" } });
  expect(session.status).toBe(201);
  const turn = await call(`/api/agent/sessions/${session.body.id}/messages`, {
    cookie: m.cookie,
    body: { message: "Bagaimana BBCA hari ini?", provider: "openai", quickModel: "m", deepModel: "m" },
  });
  expect(turn.status).toBe(429);
  // The test server sends no mail, so the admin verifies new accounts.
  expect(turn.body.error).toBe("Analisa AI dan Tanya AI terbuka setelah admin memverifikasi akunmu, biasanya di hari yang sama.");
}, 60_000);
