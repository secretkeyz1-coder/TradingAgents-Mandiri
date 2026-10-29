import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db";
import { analyses, analysisEvents, type AnalysisStatus, type BacktestResult, type RunStats } from "./db/schema";
import { runJob, type WorkerEvent, type WorkerHandle } from "./worker";

/** What subscribers receive: a persisted worker event, or the run's end. */
export type LiveEvent = { seq: number; type: string } & Record<string, unknown>;

type Listener = (event: LiveEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const queue: string[] = [];
type Running = WorkerHandle & {
  cancelled: boolean;
  /** Killed by the watchdog: no event for `config.jobIdleMs`. */
  stuck: boolean;
  /** The row was finished by another server instance (it took this row for orphaned); nothing left to write. */
  lost: boolean;
};
const running = new Map<string, Running>();

export const TERMINAL: AnalysisStatus[] = ["completed", "failed", "cancelled"];

export function subscribe(id: string, listener: Listener): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

function publish(id: string, event: LiveEvent) {
  for (const listener of listeners.get(id) ?? []) listener(event);
}

export function enqueue(id: string) {
  queue.push(id);
  pump();
}

function pump() {
  while (running.size < config.maxConcurrent && queue.length > 0) {
    const id = queue.shift()!;
    start(id).catch((err) => console.error(`analysis ${id} crashed`, err));
  }
}

async function finish(
  id: string,
  seq: number,
  status: AnalysisStatus,
  fields: { rating?: string | null; error?: string | null } = {},
) {
  const [row] = await db
    .update(analyses)
    .set({ status, finishedAt: new Date(), ...fields })
    .where(eq(analyses.id, id))
    .returning({ rating: analyses.rating, error: analyses.error });
  publish(id, { seq, type: "end", status, rating: row?.rating ?? null, error: row?.error ?? null });
}

async function start(id: string) {
  // Claim the row: another instance on the same database may have started it first.
  const [row] = await db
    .update(analyses)
    .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date() })
    .where(and(eq(analyses.id, id), eq(analyses.status, "queued")))
    .returning();
  if (!row) return;

  let seq = 0;
  let lastEventAt = Date.now();
  // Set from inside onEvent; the cast keeps TS from narrowing it to null here.
  let outcome = null as { status: AnalysisStatus; rating?: string | null; error?: string | null } | null;

  const onEvent = async (event: WorkerEvent) => {
    const { type, ...payload } = event;
    lastEventAt = Date.now();
    // The finished report page is large and only needed once: it goes on the
    // analysis row, not into the event log or the live stream.
    const html = type === "done" ? ((payload.html as string | null) ?? null) : null;
    if (type === "done") delete payload.html;

    seq += 1;
    await db.insert(analysisEvents).values({ analysisId: id, seq, type, payload });

    switch (type) {
      case "started":
        // A backtest reports its canonical tickers; an analysis its one ticker and asset type.
        await db
          .update(analyses)
          .set(
            row.kind === "backtest"
              ? { ticker: (payload.tickers as string[]).join(",") }
              : { ticker: String(payload.ticker), assetType: String(payload.assetType) },
          )
          .where(eq(analyses.id, id));
        break;
      case "progress":
        await db
          .update(analyses)
          .set({
            progress: {
              done: Number(payload.done),
              total: Number(payload.total),
              ticker: (payload.ticker as string | null) ?? null,
              date: (payload.date as string | null) ?? null,
            },
          })
          .where(eq(analyses.id, id));
        break;
      case "status":
        await db
          .update(analyses)
          .set({ agents: payload.agents as Record<string, string> })
          .where(eq(analyses.id, id));
        break;
      case "report":
        await db
          .update(analyses)
          .set({
            reports: sql`${analyses.reports} || ${JSON.stringify({ [String(payload.section)]: payload.content })}::jsonb`,
          })
          .where(eq(analyses.id, id));
        break;
      case "stats":
        await db
          .update(analyses)
          .set({ stats: payload as unknown as RunStats })
          .where(eq(analyses.id, id));
        break;
      case "done":
        await db
          .update(analyses)
          .set({
            reportHtml: html,
            reportDir: (payload.reportDir as string) ?? null,
            result: (payload.result as BacktestResult) ?? null,
          })
          .where(eq(analyses.id, id));
        outcome = { status: "completed", rating: (payload.rating as string) ?? null };
        break;
      case "error":
        outcome = { status: "failed", error: String(payload.message) };
        break;
    }
    publish(id, { seq, type, ...payload });
  };

  const handle = runJob(row.kind, row.request, onEvent);
  const entry: Running = { ...handle, cancelled: false, stuck: false, lost: false };
  running.set(id, entry);
  // The worker only shows progress through events; a quiet one is stuck and is
  // killed. The heartbeat tells other instances this row still has a server,
  // and a heartbeat that finds the row no longer running means another
  // instance (or a cancel) finished it, so the worker must not run on.
  const watchdog = setInterval(async () => {
    if (entry.cancelled || entry.stuck || entry.lost) return;
    if (Date.now() - lastEventAt > config.jobIdleMs) {
      entry.stuck = true;
      handle.kill();
      return;
    }
    const [alive] = await db
      .update(analyses)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(analyses.id, id), eq(analyses.status, "running")))
      .returning({ id: analyses.id });
    if (!alive && !entry.cancelled) {
      entry.lost = true;
      handle.kill();
    }
  }, config.heartbeatMs);
  try {
    const { exitCode, stderrTail } = await handle.done;
    clearInterval(watchdog);
    if (entry.cancelled) {
      await finish(id, seq + 1, "cancelled", { error: "Dibatalkan oleh pengguna." });
    } else if (entry.stuck) {
      const minutes = Math.round(config.jobIdleMs / 60_000);
      await finish(id, seq + 1, "failed", { error: `Tidak ada kemajuan selama ${minutes} menit; worker dihentikan.` });
    } else if (entry.lost) {
      const [cur] = await db.select({ status: analyses.status, rating: analyses.rating, error: analyses.error }).from(analyses).where(eq(analyses.id, id));
      publish(id, { seq: seq + 1, type: "end", status: cur?.status ?? "failed", rating: cur?.rating ?? null, error: cur?.error ?? null });
    } else if (outcome) {
      await finish(id, seq + 1, outcome.status, outcome);
    } else {
      const tail = stderrTail.trim().split("\n").slice(-5).join("\n");
      await finish(id, seq + 1, "failed", { error: `Worker berhenti tanpa hasil (exit ${exitCode}).\n${tail}` });
    }
  } finally {
    clearInterval(watchdog);
    running.delete(id);
    pump();
  }
}

export async function cancel(id: string): Promise<boolean> {
  const queuedAt = queue.indexOf(id);
  if (queuedAt >= 0) {
    queue.splice(queuedAt, 1);
    await finish(id, 0, "cancelled", { error: "Dibatalkan sebelum mulai." });
    return true;
  }
  const entry = running.get(id);
  if (!entry) return false;
  entry.cancelled = true;
  entry.kill();
  return true;
}

/** Running rows whose server stopped heartbeating: that worker is gone (or orphaned), the run cannot be resumed. */
async function failOrphans() {
  const stale = new Date(Date.now() - config.jobStaleMs);
  await db
    .update(analyses)
    .set({ status: "failed", error: "Server yang menjalankan analisa ini berhenti.", finishedAt: new Date() })
    .where(and(eq(analyses.status, "running"), or(isNull(analyses.heartbeatAt), lt(analyses.heartbeatAt, stale))));
}

/**
 * At boot: orphaned runs are failed (only those, so a second instance on the
 * same database leaves live runs alone), queued ones start again, and the
 * orphan sweep keeps going in case another instance dies later.
 */
export async function recover() {
  await failOrphans();
  setInterval(() => failOrphans().catch((err) => console.error("orphan sweep failed", err)), config.jobStaleMs);
  const queued = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(eq(analyses.status, "queued"))
    .orderBy(analyses.createdAt);
  for (const { id } of queued) enqueue(id);
}
