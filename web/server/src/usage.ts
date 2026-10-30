// A daily cap on what spends the owner's LLM credits: analyses (a backtest
// counts each of its cells, since each cell is a full analysis) and chat turns
// with the chart agent. Counted from the rows already stored, per day in WIB,
// so it survives restarts. A limit of 0 turns that cap off.
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "./db";
import { agentMessages, analyses } from "./db/schema";

const DAY_MS = 86_400_000;
// Asia/Jakarta has no daylight saving: the day starts at 00:00 UTC+7.
const WIB_MS = 7 * 3_600_000;

export const limits = {
  analyses: Number(process.env.DAILY_ANALYSIS_LIMIT ?? 60),
  chat: Number(process.env.DAILY_CHAT_LIMIT ?? 300),
};

export type Usage = {
  analyses: { used: number; limit: number };
  chat: { used: number; limit: number };
  resetsAt: string;
};

function dayStart(now = Date.now()): Date {
  return new Date(Math.floor((now + WIB_MS) / DAY_MS) * DAY_MS - WIB_MS);
}

export async function usage(): Promise<Usage> {
  const since = dayStart();
  const rows = await db
    .select({ kind: analyses.kind, status: analyses.status, startedAt: analyses.startedAt, progress: analyses.progress })
    .from(analyses)
    .where(gte(analyses.createdAt, since));
  // Cancelled before it started: no model was called.
  const analysesUsed = rows
    .filter((r) => !(r.status === "cancelled" && !r.startedAt))
    .reduce((sum, r) => sum + (r.kind === "backtest" ? (r.progress?.total ?? 1) : 1), 0);
  const [chat] = await db
    .select({ n: count() })
    .from(agentMessages)
    .where(and(eq(agentMessages.role, "user"), gte(agentMessages.createdAt, since)));
  return {
    analyses: { used: analysesUsed, limit: limits.analyses },
    chat: { used: chat?.n ?? 0, limit: limits.chat },
    resetsAt: new Date(since.getTime() + DAY_MS).toISOString(),
  };
}

/** Why `add` more analyses (or chat turns) would go over today's cap, or null when they fit. */
export async function overLimit(kind: "analyses" | "chat", add = 1): Promise<string | null> {
  const { used, limit } = (await usage())[kind];
  if (!limit || used + add <= limit) return null;
  const what = kind === "analyses" ? "analisa (1 sel backtest = 1 analisa)" : "pesan chat agent";
  const left = Math.max(0, limit - used);
  return `Batas harian ${limit} ${what} tercapai: ${used} terpakai hari ini${add > 1 ? `, permintaan ini butuh ${add}, sisa ${left}` : ""}. Reset pukul 00.00 WIB.`;
}
