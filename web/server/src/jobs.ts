// The analysis queue (analyses and backtests), kept in Postgres so the API and the
// workers can be separate processes, any number of each.
//
// A request writes its row as "queued" and calls enqueue(), which only wakes the
// runners. A runner (runner.ts, the worker process; or the API process itself when
// MAX_CONCURRENT_ANALYSES is above 0, as in development) claims queued rows with
// FOR UPDATE SKIP LOCKED, so two runners never take one row, runs the engine,
// stores every event in analysis_events and announces it on one notification
// channel. subscribe() hears the announcements in any process and reads the new
// rows, so the live stream and the watchlist work wherever the analysis runs; a
// re-read every 15 seconds covers announcements missed while a connection
// reconnects. cancel() finishes a queued or running row in place and tells its
// runner to kill the worker. Runners heartbeat their rows, and the leader's sweep
// fails a row whose heartbeat stopped: its runner died, and a run cannot resume.
import { and, asc, eq, gt, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import { config } from "./config";
import { db, pgClient } from "./db";
import { analyses, analysisEvents, type AnalysisStatus, type BacktestResult, type RunStats } from "./db/schema";
import { recordError } from "./errors";
import { leaderOnly } from "./locks";
import { runJob, type WorkerEvent, type WorkerHandle } from "./worker";

/** What subscribers receive: a stored worker event, or the run's end. */
export type LiveEvent = { seq: number; type: string } & Record<string, unknown>;

type Listener = (event: LiveEvent) => void;

export const TERMINAL: AnalysisStatus[] = ["completed", "failed", "cancelled"];

const CHANNEL = "ta_jobs";
/** A runner also looks for queued rows this often: an announcement can be missed while its connection reconnects. */
const POLL_MS = 5_000;
/** Listeners' analyses are read again this often, for the same reason. */
const REREAD_MS = 15_000;

const listeners = new Map<string, Set<Listener>>();
/** Per analysis with listeners here: the last event seq they were given. */
const cursors = new Map<string, number>();
/** Per analysis: the reads in flight, chained so its events reach the listeners in order. */
const chains = new Map<string, Promise<void>>();

type Running = WorkerHandle & {
  /** cancel() finished the row and told this runner. */
  cancelled: boolean;
  /** Killed by the watchdog: no event for `config.jobIdleMs`. */
  stuck: boolean;
  /** The row was finished elsewhere (the sweep took it for orphaned, or a cancel this runner did not hear). */
  lost: boolean;
  /** Ended by this runner's shutdown; stopRunner fails the row. */
  stopped: boolean;
};
const running = new Map<string, Running>();
let capacity = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;

let execute = runJob;
/** Tests run fake jobs instead of the engine; called without one, the engine is back. */
export function useJobs(run: typeof runJob = runJob) {
  execute = run;
}

let listening: Promise<{ unlisten: () => Promise<void> }> | null = null;
let rereadTimer: ReturnType<typeof setInterval> | undefined;

/** Opens this process's one LISTEN connection for the queue (postgres.js keeps it reconnected); once. */
export function listenForJobs(): Promise<unknown> {
  listening ??= pgClient.listen(CHANNEL, onNotice).then(
    (meta) => {
      rereadTimer ??= setInterval(reread, REREAD_MS);
      return meta;
    },
    (err) => {
      listening = null;
      throw err;
    },
  );
  return listening;
}

/** Closes the LISTEN connection and the timers (tests, so the process can end). */
export async function stopListening() {
  clearInterval(rereadTimer);
  clearInterval(pollTimer);
  rereadTimer = pollTimer = undefined;
  const meta = await listening?.catch(() => null);
  listening = null;
  await meta?.unlisten();
}

const announce = (message: string) => pgClient.notify(CHANNEL, message).catch((err) => recordError("jobs", err));

function onNotice(message: string) {
  const [kind, id] = message.split(":");
  if (kind === "queued") {
    void fill();
  } else if (kind === "cancel") {
    const entry = running.get(id);
    if (entry && !entry.cancelled) {
      entry.cancelled = true;
      entry.kill();
    }
  } else if (kind === "event" && listeners.has(id)) {
    chain(id, () => drain(id));
  } else if (kind === "end" && listeners.has(id)) {
    chain(id, () => end(id));
  }
}

function chain(id: string, work: () => Promise<void>) {
  const next = (chains.get(id) ?? Promise.resolve()).then(work).catch((err) => {
    void recordError("jobs", err);
  });
  chains.set(id, next);
  void next.then(() => {
    if (chains.get(id) === next) chains.delete(id);
  });
}

function publish(id: string, event: LiveEvent) {
  for (const listener of listeners.get(id) ?? []) listener(event);
}

/** Gives this process's listeners of `id` the events stored since the last ones they got. */
async function drain(id: string) {
  const from = cursors.get(id);
  if (from === undefined) return;
  const rows = await db
    .select()
    .from(analysisEvents)
    .where(and(eq(analysisEvents.analysisId, id), gt(analysisEvents.seq, from)))
    .orderBy(asc(analysisEvents.seq));
  for (const row of rows) {
    cursors.set(id, row.seq);
    publish(id, { seq: row.seq, type: row.type, ...row.payload });
  }
}

/** The events left, then the end once the row is finished. */
async function end(id: string) {
  await drain(id);
  if (!listeners.has(id)) return;
  const [row] = await db.select({ status: analyses.status, rating: analyses.rating, error: analyses.error }).from(analyses).where(eq(analyses.id, id));
  if (!row || !TERMINAL.includes(row.status)) return;
  publish(id, { seq: (cursors.get(id) ?? 0) + 1, type: "end", status: row.status, rating: row.rating, error: row.error });
}

function reread() {
  for (const id of listeners.keys()) chain(id, () => end(id));
}

/**
 * Calls `listener` with every event `id` stores from now on, from any process, and then its end.
 * Resolves once listening: an event stored later reaches the listener, an earlier one is in the
 * table for the caller to read (the live stream reads that history right after).
 */
export async function subscribe(id: string, listener: Listener): Promise<() => void> {
  await listenForJobs();
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(listener);
  if (!cursors.has(id)) {
    const [row] = await db.select({ seq: max(analysisEvents.seq) }).from(analysisEvents).where(eq(analysisEvents.analysisId, id));
    if (!cursors.has(id)) cursors.set(id, row?.seq ?? 0);
  }
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(id);
      cursors.delete(id);
    }
  };
}

/** Wakes the runners for a row just written as "queued". */
export function enqueue(id: string) {
  void announce(`queued:${id}`);
}

/** Takes the oldest queued row for this runner, or null: FOR UPDATE SKIP LOCKED, so no two runners take one row. */
export async function claimNext() {
  const oldest = sql`(select ${analyses.id} from ${analyses} where ${analyses.status} = 'queued' order by ${analyses.createdAt} limit 1 for update skip locked)`;
  const [row] = await db
    .update(analyses)
    .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date() })
    .where(eq(analyses.id, oldest))
    .returning();
  return row ?? null;
}

let filling = false;
let again = false;

/** Claims queued rows until this runner is full or none are left. */
async function fill() {
  if (filling) {
    again = true;
    return;
  }
  filling = true;
  try {
    do {
      again = false;
      while (running.size < capacity) {
        const row = await claimNext();
        if (!row) break;
        run(row);
      }
    } while (again);
  } catch (err) {
    await recordError("jobs", err);
  } finally {
    filling = false;
  }
}

/** Starts claiming and running queued rows, `concurrency` at a time; with none, this process only queues them. */
export async function startRunner(concurrency = config.maxConcurrent) {
  capacity = concurrency;
  if (capacity < 1) return;
  await listenForJobs();
  pollTimer ??= setInterval(() => void fill(), POLL_MS);
  await fill();
}

/** Stops claiming, kills the workers running here and fails their rows: a run cannot resume elsewhere. */
export async function stopRunner() {
  capacity = 0;
  const ids = [...running.keys()];
  for (const entry of running.values()) {
    entry.stopped = true;
    entry.kill();
  }
  if (!ids.length) return;
  const failed = await db
    .update(analyses)
    .set({ status: "failed", error: "Worker berhenti karena restart atau deploy. Jalankan lagi analisanya.", finishedAt: new Date() })
    .where(and(inArray(analyses.id, ids), eq(analyses.status, "running")))
    .returning({ id: analyses.id });
  for (const { id } of failed) await announce(`end:${id}`);
}

/** The runner's last word on a row it ran: written only while the row is still its own. */
async function finish(id: string, status: AnalysisStatus, fields: { rating?: string | null; error?: string | null } = {}) {
  await db
    .update(analyses)
    .set({ status, finishedAt: new Date(), ...fields })
    .where(and(eq(analyses.id, id), eq(analyses.status, "running")));
  await announce(`end:${id}`);
}

/** Runs one claimed row: its events stored and announced, its heartbeat kept, its end written. */
function run(row: typeof analyses.$inferSelect) {
  const id = row.id;
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
    await announce(`event:${id}`);
  };

  const handle = execute(row.kind, row.request, { userId: row.userId, kind: row.kind }, onEvent);
  const entry: Running = { ...handle, cancelled: false, stuck: false, lost: false, stopped: false };
  running.set(id, entry);
  // The worker only shows progress through events; a quiet one is stuck and is
  // killed. The heartbeat tells the sweep this row still has a runner, and a
  // heartbeat that finds the row no longer running means it was finished
  // elsewhere, so the worker must not run on.
  const watchdog = setInterval(async () => {
    if (entry.cancelled || entry.stuck || entry.lost || entry.stopped) return;
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
    if (!alive && !entry.cancelled && !entry.stopped) {
      entry.lost = true;
      handle.kill();
    }
  }, config.heartbeatMs);

  void (async () => {
    try {
      const { exitCode, stderrTail } = await handle.done;
      // cancel() and stopRunner() have written the row and announced its end.
      if (entry.cancelled || entry.stopped) return;
      if (entry.stuck) {
        const minutes = Math.round(config.jobIdleMs / 60_000);
        await finish(id, "failed", { error: `Tidak ada kemajuan selama ${minutes} menit; worker dihentikan.` });
      } else if (entry.lost) {
        await announce(`end:${id}`);
      } else if (outcome) {
        await finish(id, outcome.status, outcome);
      } else {
        const tail = stderrTail.trim().split("\n").slice(-5).join("\n");
        await finish(id, "failed", { error: `Worker berhenti tanpa hasil (exit ${exitCode}).\n${tail}` });
      }
    } catch (err) {
      await recordError("analysis", err);
    } finally {
      clearInterval(watchdog);
      running.delete(id);
      void fill();
    }
  })();
}

/** Cancels a queued or running row; false when it is neither. A running row's runner, told, kills its worker. */
export async function cancel(id: string): Promise<boolean> {
  const [row] = await db
    .update(analyses)
    .set({
      status: "cancelled",
      error: sql`case when ${analyses.status} = 'queued' then 'Dibatalkan sebelum mulai.' else 'Dibatalkan oleh pengguna.' end`,
      finishedAt: new Date(),
    })
    .where(and(eq(analyses.id, id), inArray(analyses.status, ["queued", "running"])))
    .returning({ id: analyses.id });
  if (!row) return false;
  await announce(`cancel:${id}`);
  await announce(`end:${id}`);
  return true;
}

/** Running rows whose runner stopped heartbeating: it died (or was cut off), and the run cannot resume. */
export async function failOrphans() {
  const stale = new Date(Date.now() - config.jobStaleMs);
  const failed = await db
    .update(analyses)
    .set({ status: "failed", error: "Server yang menjalankan analisa ini berhenti.", finishedAt: new Date() })
    .where(and(eq(analyses.status, "running"), or(isNull(analyses.heartbeatAt), lt(analyses.heartbeatAt, stale))))
    .returning({ id: analyses.id });
  for (const { id } of failed) await announce(`end:${id}`);
}

/** The orphan sweep, on the instance that runs the schedulers (locks.ts). */
export function startOrphanSweep() {
  const sweep = leaderOnly(() => failOrphans().catch((err) => recordError("jobs", err)));
  sweep();
  setInterval(sweep, config.jobStaleMs);
}
