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
  clientDist: join(repoRoot, "web", "client", "dist"),
};
