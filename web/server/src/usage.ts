// Daily caps on what spends the owner's LLM credits: analyses (a backtest
// counts each of its cells, since each cell is a full analysis) and chat turns
// with the chart agent. Each user has a cap (their own, or the server default),
// and the server has a total cap across users. Counted from the rows already
// stored, per day in WIB, so it survives restarts. A limit of 0 turns that cap off.
// A member pays for what they got: a run a restart or deploy cut off is given back,
// and a backtest that stopped early counts the cells it ran. Clearing history gives
// nothing back: a deleted analysis or chat leaves its share in spent_quota (keepSpent),
// which Uji indikator's cap (lab.ts) uses the same way.
import { and, count, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { User } from "./auth";
import { db } from "./db";
import { recordError } from "./errors";
import { SERVER_STOPPED, WORKER_STOPPED } from "./jobs";
import { leaderOnly } from "./locks";
import { mailEnabled } from "./mail";
import { limitsOf, needsPhone, needsVerification, paymentsOpen, planOf } from "./plans";
import { agentMessages, agentSessions, analyses, spentQuota, type QuotaKind } from "./db/schema";

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
    .select({ kind: analyses.kind, status: analyses.status, error: analyses.error, startedAt: analyses.startedAt, progress: analyses.progress })
    .from(analyses)
    .where(and(gte(analyses.createdAt, since), userId ? eq(analyses.userId, userId) : undefined));
  return rows.reduce((sum, r) => sum + charged(r), 0) + (await spentSince("analyses", since, userId));
}

type Run = { kind: string; status: string; error: string | null; startedAt: Date | null; progress: { done: number; total: number } | null };

/** What one stored run takes from the day: an analysis 1 and a backtest its cells, less what the member never got. */
export function charged(r: Run): number {
  // Cancelled before it started: no model was called.
  if (r.status === "cancelled" && !r.startedAt) return 0;
  // Cut off by a restart or deploy (jobs.ts): the server's doing, not the member's.
  const lost = r.status === "failed" && (r.error === WORKER_STOPPED || r.error === SERVER_STOPPED);
  if (r.kind !== "backtest") return lost ? 0 : 1;
  // A backtest holds all its cells while it runs; once it stops early, only those that ran (kept for its resume).
  return r.status === "failed" || r.status === "cancelled" ? (r.progress?.done ?? 0) : (r.progress?.total ?? 1);
}

async function chatUsed(since: Date, userId?: string): Promise<number> {
  const where: SQL[] = [eq(agentMessages.role, "user"), gte(agentMessages.createdAt, since)];
  if (userId) where.push(eq(agentSessions.userId, userId));
  const [row] = await db
    .select({ n: count() })
    .from(agentMessages)
    .innerJoin(agentSessions, eq(agentMessages.sessionId, agentSessions.id))
    .where(and(...where));
  return (row?.n ?? 0) + (await spentSince("chat", since, userId));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Keeps what deleted rows had taken from a cap, in the transaction that deletes them; `at` is when
 * each share was spent. One older than a day falls in no window, so it is not kept.
 */
export async function keepSpent(tx: Tx, kind: QuotaKind, shares: { userId: string | null; amount: number; at: Date }[]) {
  const since = Date.now() - DAY_MS;
  const rows = shares.flatMap(({ userId, amount, at }) => (userId && amount > 0 && at.getTime() > since ? [{ userId, kind, amount, at }] : []));
  if (rows.length) await tx.insert(spentQuota).values(rows);
}

/** What deleted rows of `kind` had taken since `since`: one account's, or every account's. */
export async function spentSince(kind: QuotaKind, since: Date, userId?: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${spentQuota.amount}), 0)::int` })
    .from(spentQuota)
    .where(and(eq(spentQuota.kind, kind), gte(spentQuota.at, since), userId ? eq(spentQuota.userId, userId) : undefined));
  return row?.n ?? 0;
}

/** Today's chat turns in one session, as chatUsed counts them: read before the session is deleted. */
export async function turnsToday(tx: Tx, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(agentMessages)
    .where(and(eq(agentMessages.sessionId, sessionId), eq(agentMessages.role, "user"), gte(agentMessages.createdAt, dayStart())));
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
  // Without mail no link was sent: the admin verifies new accounts by hand (Konsol admin → Pengguna).
  if (needsVerification(user))
    return mailEnabled()
      ? "Verifikasi email kamu dulu untuk memakai analisa AI dan Tanya AI. Tautannya ada di email pendaftaran."
      : "Analisa AI dan Tanya AI terbuka setelah admin memverifikasi akunmu, biasanya di hari yang sama.";
  if (needsPhone(user)) return "Isi nomor WhatsApp-mu dulu untuk memakai analisa AI dan Tanya AI.";
  const left = await room(user, kind);
  if (add <= left) return null;
  const mine = (await usage(user))[kind];
  const what = kind === "analyses" ? "analisa (1 sel backtest = 1 analisa)" : "pesan Tanya AI";
  const ownFull = mine.limit && mine.used + add > mine.limit;
  const head = ownFull
    ? `Batas harian ${mine.limit} ${what} untuk akunmu tercapai: ${mine.used} terpakai hari ini`
    : `Batas harian total server untuk ${what} tercapai`;
  const more = paymentsOpen() ? " Naikkan paket di menu akun → Paket & tagihan untuk kuota lebih besar." : " Hubungi admin untuk kuota lebih besar.";
  const upgrade = ownFull && user.role !== "admin" && planOf(user) !== "creator" ? more : "";
  return `${head}${add > 1 ? `, permintaan ini butuh ${add}, sisa ${left}` : ""}. Reset pukul 00.00 WIB.${upgrade}`;
}

/** Deletes kept shares older than two days, past every window (tests pass their own clock). */
export async function pruneSpent(now = Date.now()) {
  await db.delete(spentQuota).where(lt(spentQuota.at, new Date(now - 2 * DAY_MS)));
}

/** Prunes kept shares now and once a day, on the instance that runs the schedulers (index.ts). */
export function startSpentPruning() {
  const prune = leaderOnly(() => pruneSpent().catch((err) => recordError("usage", err)));
  prune();
  setInterval(prune, DAY_MS);
}
