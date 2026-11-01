// The server's own error log, for the admin console: every request that ended in a
// 500 (under the code its answer showed the user) and every background job that broke,
// kept 30 days. Writing it never throws: when the database is down, that failure is
// logged and the original error still reaches the log.
import { count, desc, gte, lt } from "drizzle-orm";
import { db } from "./db";
import { serverErrors } from "./db/schema";
import { leaderOnly } from "./locks";
import { log } from "./log";

const KEEP_DAYS = 30;

/** A short code a person can read out to the admin. */
export const errorCode = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** Log an error and keep it for the admin console; resolves to its code, even when the database is down. */
export async function recordError(
  source: string,
  err: unknown,
  context: { code?: string; method?: string; path?: string; userId?: string | null } = {},
): Promise<string> {
  const code = context.code ?? errorCode();
  const e = err instanceof Error ? err : new Error(String(err));
  log.error(source === "request" ? "request_failed" : `${source}_failed`, {
    code,
    method: context.method,
    path: context.path,
    user: context.userId ?? undefined,
    error: e,
  });
  try {
    await db.insert(serverErrors).values({
      code,
      source,
      method: context.method ?? null,
      path: context.path ?? null,
      userId: context.userId ?? null,
      message: e.message.slice(0, 2000),
      stack: e.stack?.slice(0, 8000) ?? null,
    });
  } catch (writeErr) {
    log.error("error_log_write_failed", { code, error: writeErr });
  }
  return code;
}

/** Drop errors older than KEEP_DAYS, now and once a day; started with the other schedulers (index.ts). */
export function startErrorPruning() {
  const prune = leaderOnly(() =>
    db
      .delete(serverErrors)
      .where(lt(serverErrors.createdAt, new Date(Date.now() - KEEP_DAYS * 86_400_000)))
      .catch((err) => log.error("error_prune_failed", { error: err })),
  );
  prune();
  setInterval(prune, 86_400_000);
}

/** The newest 50 errors, and how many came in the last 24 hours (the admin console, business.ts). */
export async function recentErrors() {
  const [items, [day]] = await Promise.all([
    db.select().from(serverErrors).orderBy(desc(serverErrors.createdAt)).limit(50),
    db
      .select({ n: count() })
      .from(serverErrors)
      .where(gte(serverErrors.createdAt, new Date(Date.now() - 86_400_000))),
  ]);
  return { items, lastDay: day.n };
}
