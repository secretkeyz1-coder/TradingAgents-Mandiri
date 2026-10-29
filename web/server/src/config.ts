import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// The repository root: the worker runs there so the engine finds `.env`.
const repoRoot = resolve(import.meta.dir, "../../..");

function defaultPython(): string {
  const venvPython =
    process.platform === "win32"
      ? join(repoRoot, ".venv", "Scripts", "python.exe")
      : join(repoRoot, ".venv", "bin", "python");
  return existsSync(venvPython) ? venvPython : "python";
}

export const config = {
  repoRoot,
  port: Number(process.env.PORT ?? 3080),
  host: process.env.HOST ?? "127.0.0.1",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://tradingagents:tradingagents@127.0.0.1:5590/tradingagents",
  pythonBin: process.env.PYTHON_BIN ?? defaultPython(),
  // TA_WORKER_SCRIPT=web/worker/demo_worker.py replays a scripted run, for UI work without API keys.
  workerScript: resolve(repoRoot, process.env.TA_WORKER_SCRIPT ?? join("web", "worker", "ta_worker.py")),
  // Each analysis makes many LLM calls; keep the number running at once small.
  maxConcurrent: Number(process.env.MAX_CONCURRENT_ANALYSES ?? 2),
  // A job that sends no event for this long is stuck (a hung LLM call, a dead gateway) and is killed.
  jobIdleMs: Number(process.env.JOB_IDLE_MINUTES ?? 15) * 60_000,
  // A running job's heartbeat; another instance treats a row quiet for longer than `jobStaleMs` as orphaned.
  heartbeatMs: 30_000,
  jobStaleMs: 120_000,
  // The app's one login (see auth.ts: login page and session cookie). Required when the server
  // listens beyond loopback: every analysis spends the owner's LLM credits.
  appUser: process.env.APP_USER ?? "admin",
  appPassword: process.env.APP_PASSWORD ?? "",
  // The worker sends the provider's API key to the backend URL a request names,
  // so on a shared server only these URLs are accepted (comma-separated; empty = any).
  allowedBackendUrls: (process.env.ALLOWED_BACKEND_URLS ?? "")
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  clientDist: join(repoRoot, "web", "client", "dist"),
};

/** Why a request's backend URL is refused, or null when it may be used. */
export function backendUrlRefused(url: string | undefined): string | null {
  if (!url || config.allowedBackendUrls.length === 0) return null;
  return config.allowedBackendUrls.includes(url.trim().replace(/\/+$/, ""))
    ? null
    : `Backend URL ini tidak diizinkan di server ini. Yang diizinkan: ${config.allowedBackendUrls.join(", ")}`;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
if (!LOOPBACK.has(config.host) && !config.appPassword && process.env.ALLOW_NO_AUTH !== "1") {
  throw new Error(
    `HOST=${config.host} membuka server ke jaringan tanpa login. Set APP_PASSWORD (dan APP_USER), atau ALLOW_NO_AUTH=1 kalau sudah dilindungi di depan.`,
  );
}
