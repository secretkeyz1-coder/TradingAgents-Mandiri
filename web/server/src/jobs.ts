import { eq, sql } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db";
import { analyses, analysisEvents, type AnalysisStatus, type BacktestResult, type RunStats } from "./db/schema";
import { runJob, type WorkerEvent, type WorkerHandle } from "./worker";

/** What subscribers receive: a persisted worker event, or the run's end. */
export type LiveEvent = { seq: number; type: string } & Record<string, unknown>;

type Listener = (event: LiveEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const queue: string[] = [];
const running = new Map<string, WorkerHandle & { cancelled: boolean }>();

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
  const [row] = await db
    .update(analyses)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(analyses.id, id))
    .returning();
  if (!row) return;

  let seq = 0;
  // Set from inside onEvent; the cast keeps TS from narrowing it to null here.
  let outcome = null as { status: AnalysisStatus; rating?: string | null; error?: string | null } | null;

  const onEvent = async (event: WorkerEvent) => {
    const { type, ...payload } = event;
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
  const entry = { ...handle, cancelled: false };
  running.set(id, entry);
  try {
    const { exitCode, stderrTail } = await handle.done;
    if (entry.cancelled) {
      await finish(id, seq + 1, "cancelled", { error: "Dibatalkan oleh pengguna." });
    } else if (outcome) {
      await finish(id, seq + 1, outcome.status, outcome);
    } else {
      const tail = stderrTail.trim().split("\n").slice(-5).join("\n");
      await finish(id, seq + 1, "failed", { error: `Worker berhenti tanpa hasil (exit ${exitCode}).\n${tail}` });
    }
  } finally {
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

/** After a restart: runs that were in flight cannot be resumed; queued ones start again. */
export async function recover() {
  await db
    .update(analyses)
    .set({ status: "failed", error: "Server restart saat analisa berjalan.", finishedAt: new Date() })
    .where(eq(analyses.status, "running"));
  const queued = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(eq(analyses.status, "queued"))
    .orderBy(analyses.createdAt);
  for (const { id } of queued) enqueue(id);
}
