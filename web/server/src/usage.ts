// Daily caps on what spends the owner's LLM credits: analyses (a backtest
// counts each of its cells, since each cell is a full analysis) and chat turns
// with the chart agent. Each user has a cap (their own, or the server default),
// and the server has a total cap across users. Counted from the rows already
// stored, per day in WIB, so it survives restarts. A limit of 0 turns that cap off.
import { and, count, eq, gte, type SQL } from "drizzle-orm";
import type { User } from "./auth";
import { db } from "./db";
import { limitsOf, needsVerification, planOf } from "./plans";
import { agentMessages, agentSessions, analyses } from "./db/schema";

const DAY_MS = 86_400_000;
// Asia/Jakarta has no daylight saving: the day starts at 00:00 UTC+7.
const WIB_MS = 7 * 3_600_000;

/** Per-user defaults, and the server's total across users. */
export const limits = {
  analyses: Number(process.env.DAILY_ANALYSIS_LIMIT ?? 60),
  chat: Number(process.env.DAILY_CHAT_LIMIT ?? 300),
  totalAnalyses: Number(process.env.DAILY_TOTAL_ANALYSIS_LIMIT ?? 200),
  totalChat: Number(process.env.DAILY_TOTAL_CHAT_LIMIT ?? 1000),
};

type Kind = "analyses" | "chat";

export type Usage = {
  analyses: { used: number; limit: number };
  chat: { used: number; limit: number };
  resetsAt: string;
};

function dayStart(now = Date.now()): Date {
  return new Date(Math.floor((now + WIB_MS) / DAY_MS) * DAY_MS - WIB_MS);
}

async function analysesUsed(since: Date, userId?: string): Promise<number> {
  const rows = await db
    .select({ kind: analyses.kind, status: analyses.status, startedAt: analyses.startedAt, progress: analyses.progress })
    .from(analyses)
    .where(and(gte(analyses.createdAt, since), userId ? eq(analyses.userId, userId) : undefined));
  // Cancelled before it started: no model was called.
  return rows
    .filter((r) => !(r.status === "cancelled" && !r.startedAt))
    .reduce((sum, r) => sum + (r.kind === "backtest" ? (r.progress?.total ?? 1) : 1), 0);
}

async function chatUsed(since: Date, userId?: string): Promise<number> {
  const where: SQL[] = [eq(agentMessages.role, "user"), gte(agentMessages.createdAt, since)];
  if (userId) where.push(eq(agentSessions.userId, userId));
  const [row] = await db
    .select({ n: count() })
    .from(agentMessages)
    .innerJoin(agentSessions, eq(agentMessages.sessionId, agentSessions.id))
    .where(and(...where));
  return row?.n ?? 0;
}

/** An account's own cap, else its plan's (shared/plans.ts); admins keep the server defaults. */
const limitFor = (user: User, kind: Kind) =>
  (kind === "analyses" ? user.dailyAnalysisLimit : user.dailyChatLimit) ??
  (user.role === "admin" ? (kind === "analyses" ? limits.analyses : limits.chat) : limitsOf(user)[kind]);

/** One user's use today against their own caps. */
export async function usage(user: User): Promise<Usage> {
  const since = dayStart();
  return {
    analyses: { used: await analysesUsed(since, user.id), limit: limitFor(user, "analyses") },
    chat: { used: await chatUsed(since, user.id), limit: limitFor(user, "chat") },
    resetsAt: new Date(since.getTime() + DAY_MS).toISOString(),
  };
}

/** How many more of `kind` this user can start today, within both their cap and the server's total. */
export async function room(user: User, kind: Kind): Promise<number> {
  const since = dayStart();
  const mine = (await usage(user))[kind];
  const total = kind === "analyses" ? limits.totalAnalyses : limits.totalChat;
  const own = mine.limit ? mine.limit - mine.used : Infinity;
  const all = total ? total - (kind === "analyses" ? await analysesUsed(since) : await chatUsed(since)) : Infinity;
  return Math.max(0, Math.min(own, all));
}

/** Why `add` more analyses (or chat turns) would go over a cap today, or null when they fit. */
export async function overLimit(user: User, kind: Kind, add = 1): Promise<string | null> {
  if (needsVerification(user)) return "Verifikasi email kamu dulu untuk memakai analisa AI dan chat agent. Tautannya ada di email pendaftaran.";
  const left = await room(user, kind);
  if (add <= left) return null;
  const mine = (await usage(user))[kind];
  const what = kind === "analyses" ? "analisa (1 sel backtest = 1 analisa)" : "pesan chat agent";
  const ownFull = mine.limit && mine.used + add > mine.limit;
  const head = ownFull
    ? `Batas harian ${mine.limit} ${what} untuk akunmu tercapai: ${mine.used} terpakai hari ini`
    : `Batas harian total server untuk ${what} tercapai`;
  const upgrade = ownFull && user.role !== "admin" && planOf(user) !== "creator" ? " Naikkan paket di menu akun → Paket & tagihan untuk kuota lebih besar." : "";
  return `${head}${add > 1 ? `, permintaan ini butuh ${add}, sisa ${left}` : ""}. Reset pukul 00.00 WIB.${upgrade}`;
}
