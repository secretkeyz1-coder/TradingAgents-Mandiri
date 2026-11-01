import { config } from "./config";
import type { AnalysisRequest, BacktestRequest, JobKind } from "./db/schema";
import { recordTokens, type Meter } from "./tokens";

/** One line of the Python worker's protocol (see web/worker/ta_worker.py). */
export type WorkerEvent = { type: string } & Record<string, unknown>;

export type WorkerHandle = {
  kill: () => void;
  /** Resolves with the exit code once stdout is drained and the process has ended. */
  done: Promise<{ exitCode: number; stderrTail: string }>;
};

const STDERR_TAIL_CHARS = 4000;

type WorkerCommand = "run" | "backtest" | "agent" | "signals" | "translate" | "lab" | "brief" | "catalog";

function spawnWorker(command: WorkerCommand) {
  return Bun.spawn([config.pythonBin, "-u", config.workerScript, command], {
    cwd: config.repoRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // TA_BUN_BIN: the agent runs the user's scripts through this same Bun (web/server/src/script-cli.ts).
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", TA_BUN_BIN: process.execPath },
  });
}

async function readTail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let tail = "";
  for await (const chunk of stream) {
    tail = (tail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL_CHARS);
  }
  return tail;
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

/** Start one job: an analysis or a backtest sweep. `onEvent` is awaited per line, so events are handled in order. */
export function runJob(
  kind: JobKind,
  request: AnalysisRequest | BacktestRequest,
  meter: Meter,
  onEvent: (event: WorkerEvent) => Promise<void>,
): WorkerHandle {
  return runCommand(kind === "backtest" ? "backtest" : "run", request, meter, onEvent);
}

/**
 * Run any worker command with one JSON payload on stdin, handling its events in
 * order. `meter` says whose work it is: the model tokens the worker reports at
 * the end are kept for it (tokens.ts); null for commands that call no model.
 */
export function runCommand(
  command: Exclude<WorkerCommand, "catalog">,
  payload: unknown,
  meter: Meter | null,
  onEvent: (event: WorkerEvent) => Promise<void>,
): WorkerHandle {
  const proc = spawnWorker(command);
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();

  const stderr = readTail(proc.stderr);
  const done = (async () => {
    for await (const line of readLines(proc.stdout)) {
      let event: WorkerEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // not protocol; the worker keeps stdout clean, so this is noise
      }
      if (event.type === "usage") {
        if (meter) await recordTokens(meter, event.models).catch((err) => console.error("token meter:", err));
        continue;
      }
      await onEvent(event);
    }
    const exitCode = await proc.exited;
    return { exitCode, stderrTail: await stderr };
  })();

  return { kill: () => proc.kill(), done };
}

export type Catalog = {
  providers: {
    key: string;
    label: string;
    defaultUrl: string | null;
    apiKeyEnv: string | null;
    hasKey: boolean;
    needsUrl: boolean;
    models: Record<"quick" | "deep", { label: string; value: string }[]>;
  }[];
  analysts: { value: string; label: string }[];
  depths: { value: number; label: string; description: string }[];
  languages: string[];
  defaults: { provider: string; quickModel: string; deepModel: string; backendUrl: string | null };
};

let cached: { at: number; value: Catalog } | null = null;
let inflight: Promise<Catalog> | null = null;
const CATALOG_TTL_MS = 30_000;
/** Whether the last catalog load worked: starting Python and the engine is what every analysis needs too (status.ts). */
let lastLoad: { at: number; ok: boolean } | null = null;
export const catalogHealth = () => lastLoad;

async function loadCatalog(): Promise<Catalog> {
  try {
    const proc = spawnWorker("catalog");
    proc.stdin.end();
    const [stdout, stderrTail, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      readTail(proc.stderr),
      proc.exited,
    ]);
    if (exitCode !== 0) throw new Error(`Worker catalog gagal (exit ${exitCode}): ${stderrTail}`);
    cached = { at: Date.now(), value: JSON.parse(stdout) };
    lastLoad = { at: Date.now(), ok: true };
    return cached.value;
  } catch (err) {
    lastLoad = { at: Date.now(), ok: false };
    throw err;
  }
}

function refreshCatalog(): Promise<Catalog> {
  inflight ??= loadCatalog().finally(() => (inflight = null));
  return inflight;
}

/**
 * Form options from the engine. Starting Python takes seconds, so a stale copy
 * is served at once while a fresh one loads; that is how a key added to `.env`
 * shows up without blocking the page.
 */
export async function getCatalog(): Promise<Catalog> {
  if (!cached) return refreshCatalog();
  if (Date.now() - cached.at > CATALOG_TTL_MS) refreshCatalog().catch((err) => console.error(err));
  return cached.value;
}
