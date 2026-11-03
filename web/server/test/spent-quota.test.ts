// Clearing history gives no quota back (usage.ts keepSpent). The caps count stored rows, so a deleted
// Uji indikator run, analysis or chat leaves its share in spent_quota until its window has passed;
// one already outside the window is not kept, and nothing kept outlives two days.
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { PLANS } from "../../shared/plans";
import { db } from "../src/db";
import { agentMessages, agentSessions, analyses, labRuns, spentQuota, type AnalysisRequest } from "../src/db/schema";
import { MAX_RUNS_KEPT, trimRuns } from "../src/lab";
import { pruneSpent } from "../src/usage";
import { call, member } from "./helpers";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const labRun = (userId: string, h: number) => ({ userId, name: "Fib Golden Zone", config: {}, result: {}, createdAt: hoursAgo(h) });
const kept = (userId: string) =>
  db.select({ kind: spentQuota.kind, amount: spentQuota.amount }).from(spentQuota).where(eq(spentQuota.userId, userId)).orderBy(spentQuota.id);

test("deleted lab runs still count, so a full day stays full", async () => {
  const m = await member();
  const limit = PLANS.free.limits.labRuns;
  const runs = await db
    .insert(labRuns)
    .values([...Array.from({ length: limit }, () => labRun(m.id, 1)), labRun(m.id, 25)])
    .returning({ id: labRuns.id });
  // Two of today's, and yesterday's, which had stopped counting already.
  for (const run of [runs[0], runs[1], runs[limit]]) {
    expect((await call(`/api/lab/runs/${run.id}`, { method: "DELETE", cookie: m.cookie })).status).toBe(200);
  }

  expect((await call("/api/usage", { cookie: m.cookie })).body.lab).toEqual({ used: limit, limit });
  const again = await call("/api/lab/run", { cookie: m.cookie, body: { strategy: { kind: "engine", name: "fib" }, symbols: ["BTC-USD"], timeframe: "1d", days: 30 } });
  expect(again.status).toBe(429);
  expect(again.body.error).toContain("uji indikator per 24 jam");
  expect(await kept(m.id)).toEqual([
    { kind: "lab", amount: 1 },
    { kind: "lab", amount: 1 },
  ]);
});

test("a run trimmed from the kept list still counts toward a bigger plan's day", async () => {
  const m = await member({ plan: "pro" });
  await db.insert(labRuns).values(Array.from({ length: MAX_RUNS_KEPT + 1 }, (_, i) => labRun(m.id, 1 + i / 60)));
  await trimRuns(m.id);

  expect(await db.select({ id: labRuns.id }).from(labRuns).where(eq(labRuns.userId, m.id))).toHaveLength(MAX_RUNS_KEPT);
  expect((await call("/api/usage", { cookie: m.cookie })).body.lab).toEqual({ used: MAX_RUNS_KEPT + 1, limit: PLANS.pro.limits.labRuns });
});

test("a deleted analysis or backtest keeps what it took from the day", async () => {
  const m = await member({ verified: true });
  const request: AnalysisRequest = { ticker: "BTC-USD", date: "2026-11-01", analysts: ["market"], depth: 1, provider: "openai", quickModel: "m", deepModel: "m", language: "Indonesian" };
  const row = (extra: Partial<typeof analyses.$inferInsert> = {}) => ({
    userId: m.id,
    ticker: "BTC-USD",
    tradeDate: "2026-11-01",
    request,
    status: "completed" as const,
    startedAt: new Date(),
    ...extra,
  });
  const rows = await db
    .insert(analyses)
    .values([
      row(),
      // Stopped after two of its seven cells: it took two.
      row({ kind: "backtest", status: "failed", progress: { done: 2, total: 7, ticker: null, date: null } }),
      row({ createdAt: hoursAgo(72) }),
    ])
    .returning({ id: analyses.id });
  const before = (await call("/api/usage", { cookie: m.cookie })).body.analyses;
  expect(before.used).toBe(1 + 2);

  for (const r of rows) expect((await call(`/api/analyses/${r.id}`, { method: "DELETE", cookie: m.cookie })).status).toBe(200);
  expect((await call("/api/usage", { cookie: m.cookie })).body.analyses).toEqual(before);
  expect(await kept(m.id)).toEqual([
    { kind: "analyses", amount: 1 },
    { kind: "analyses", amount: 2 },
  ]);
});

test("a deleted chat keeps today's turns counted, not earlier days'", async () => {
  const m = await member({ verified: true });
  const [session] = await db.insert(agentSessions).values({ userId: m.id, symbol: "BBCA.JK" }).returning({ id: agentSessions.id });
  const turn = (role: "user" | "assistant", h: number) => ({ sessionId: session.id, role, content: "Bagaimana BBCA hari ini?", createdAt: hoursAgo(h) });
  await db.insert(agentMessages).values([turn("user", 0), turn("assistant", 0), turn("user", 0), turn("user", 30)]);
  expect((await call("/api/usage", { cookie: m.cookie })).body.chat.used).toBe(2);

  expect((await call(`/api/agent/sessions/${session.id}`, { method: "DELETE", cookie: m.cookie })).status).toBe(200);
  expect((await call("/api/usage", { cookie: m.cookie })).body.chat.used).toBe(2);
  expect(await kept(m.id)).toEqual([{ kind: "chat", amount: 2 }]);
});

test("kept shares go once no window reaches them", async () => {
  const m = await member();
  await db.insert(spentQuota).values([
    { userId: m.id, kind: "lab", amount: 1, at: hoursAgo(1) },
    { userId: m.id, kind: "lab", amount: 3, at: hoursAgo(49) },
  ]);
  await pruneSpent();
  expect(await kept(m.id)).toEqual([{ kind: "lab", amount: 1 }]);
});
