import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

// The repository root: the worker runs there so the engine finds `.env`.
const repoRoot = resolve(import.meta.dir, "../../..");

function defaultPython(): string {
  const venvPython =
    process.platform === "win32"
      ? join(repoRoot, ".venv", "Scripts", "python.exe")
      : join(repoRoot, ".venv", "bin", "python");
  return existsSync(venvPython) ? venvPython : "python";
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const blank = (v: unknown) => (v === "" ? undefined : v);
const SETTINGS = z.object({
  PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65_535).default(3080)),
  MAX_CONCURRENT_ANALYSES: z.preprocess(blank, z.coerce.number().int().min(0).default(2)),
  JOB_IDLE_MINUTES: z.preprocess(blank, z.coerce.number().positive().default(15)),
  PUBLIC_URL: z.preprocess(blank, z.url().optional()),
  SMTP_URL: z.preprocess(blank, z.url().optional()),
  SESSION_SECRET: z.preprocess(blank, z.string().min(32, "minimal 32 karakter").optional()),
  LOG_LEVEL: z.preprocess(blank, z.enum(["debug", "info", "warn", "error", "silent"]).optional()),
  MIGRATE_ON_START: z.preprocess(blank, z.enum(["0", "1"]).optional()),
  METRICS_TOKEN: z.preprocess(blank, z.string().min(16, "minimal 16 karakter").optional()),
  ALERT_CHAT_ID: z.preprocess(blank, z.string().regex(/^(-?\d+|@\w{5,})$/, "chat id Telegram (angka) atau @nama_channel").optional()),
});

/**
 * The settings checked when the server starts: a wrong value stops it with every
 * problem named, instead of surfacing the first time a feature reads it. A server
 * open to the network with sign-in needs its own SESSION_SECRET: the fallback
 * derived from APP_PASSWORD is only as strong as that password.
 */
export function readSettings(env: Record<string, string | undefined>) {
  const parsed = SETTINGS.safeParse(env);
  const problems = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  if (!LOOPBACK.has(env.HOST ?? "127.0.0.1") && env.APP_PASSWORD && !env.SESSION_SECRET) {
    problems.push("SESSION_SECRET: wajib saat server terbuka ke jaringan dengan login (string acak minimal 32 karakter)");
  }
  if (!parsed.success || problems.length) throw new Error(["Pengaturan server tidak valid:", ...problems.map((p) => `- ${p}`)].join("\n"));
  return parsed.data;
}

const settings = readSettings(process.env);

export const config = {
  repoRoot,
  port: settings.PORT,
  host: process.env.HOST ?? "127.0.0.1",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://tradingagents:tradingagents@127.0.0.1:5590/tradingagents",
  pythonBin: process.env.PYTHON_BIN ?? defaultPython(),
  // TA_WORKER_SCRIPT=web/worker/demo_worker.py replays a scripted run, for UI work without API keys.
  workerScript: resolve(repoRoot, process.env.TA_WORKER_SCRIPT ?? join("web", "worker", "ta_worker.py")),
  // Each analysis makes many LLM calls; keep the number running at once small.
  maxConcurrent: settings.MAX_CONCURRENT_ANALYSES,
  // A job that sends no event for this long is stuck (a hung LLM call, a dead gateway) and is killed.
  jobIdleMs: settings.JOB_IDLE_MINUTES * 60_000,
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
  /** Signs session cookies and tickets (auth.ts); changing it signs everyone out. */
  sessionSecret: settings.SESSION_SECRET ?? createHmac("sha256", process.env.APP_PASSWORD || "local").update("tradingagents-session").digest("hex"),
};

/** Why a request's backend URL is refused, or null when it may be used. */
export function backendUrlRefused(url: string | undefined): string | null {
  if (!url || config.allowedBackendUrls.length === 0) return null;
  return config.allowedBackendUrls.includes(url.trim().replace(/\/+$/, ""))
    ? null
    : `Backend URL ini tidak diizinkan di server ini. Yang diizinkan: ${config.allowedBackendUrls.join(", ")}`;
}

if (!LOOPBACK.has(config.host) && !config.appPassword && process.env.ALLOW_NO_AUTH !== "1") {
  throw new Error(
    `HOST=${config.host} membuka server ke jaringan tanpa login. Set APP_PASSWORD (dan APP_USER), atau ALLOW_NO_AUTH=1 kalau sudah dilindungi di depan.`,
  );
}
