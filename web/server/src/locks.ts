// Work only one server instance may do at a time.
//
// The schedulers (signal scans, price checks, recaps, reminders, the brief, the
// status checks, pruning) run on one instance, the leader: it holds a Postgres
// advisory lock, and every timer tick asks leaderOnly first. The lock lives on a
// connection of its own, outside the query pool: a session lock lasts exactly as
// long as its connection, and postgres.js recycles pooled connections (and hands
// a reserved one's socket to other queries after it closes). When that connection
// closes, this instance stops leading at once; an instance that dies drops it,
// Postgres frees the lock, and another instance takes it at its next try
// (RETRY_MS). Until a cut-off leader notices, two may lead for a few seconds; the
// work they share is idempotent in the database (unique indexes, conditional updates).
//
// Shorter work that must not run twice at once (a chat session's answer, a Lab
// run) takes a lease instead: a row held until it expires and renewed while the
// work runs. It costs no connection, and one left by a crashed process frees
// itself when it expires.
import { and, eq, gt, lt, sql } from "drizzle-orm";
import postgres from "postgres";
import { config } from "./config";
import { db } from "./db";
import { leases } from "./db/schema";
import { log } from "./log";

const LEADER_LOCK = "tradingagents:scheduler";
const RETRY_MS = 15_000;
/** This process, in the logs. */
const PROCESS_ID = crypto.randomUUID();

let leader = false;
let contending: ReturnType<typeof setInterval> | undefined;
let lockSql: postgres.Sql | null = null;

/** The scheduler lock's own connection, opened once; a query after it closed opens a new session (without the lock). */
function lockConnection(): postgres.Sql {
  lockSql ??= postgres(config.databaseUrl, {
    max: 1,
    // Never rotated or closed when idle: the lock goes with the connection.
    max_lifetime: null,
    idle_timeout: 0,
    onnotice: () => {},
    onclose: () => {
      if (!leader) return;
      leader = false;
      log.warn("scheduler_leader_lost", { process: PROCESS_ID, reason: "its connection closed" });
    },
  });
  return lockSql;
}

/** A query on the lock's connection, given up after five seconds: a connection the server cut may never answer. */
function answered<T>(query: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("the scheduler lock's connection did not answer")), 5_000);
  });
  return Promise.race([query, silence]).finally(() => clearTimeout(timer));
}

/** Whether this instance runs the schedulers. */
export const isLeader = () => leader;

/** A scheduler tick that runs only on the instance that leads; on the others it does nothing. */
export function leaderOnly(tick: () => unknown): () => void {
  return () => {
    if (leader) tick();
  };
}

/** One try: keep the lock if this instance still holds it, else take it when it is free. */
export async function contendForLeadership(): Promise<boolean> {
  const sql = lockConnection();
  try {
    if (leader) {
      // A connection replaced behind our back holds nothing.
      const [row] = await answered(sql`select count(*)::int as held from pg_locks where locktype = 'advisory' and granted and pid = pg_backend_pid()`);
      if (row.held > 0) return true;
      leader = false;
      log.warn("scheduler_leader_lost", { process: PROCESS_ID, reason: "the lock is no longer held" });
    }
    const [row] = await answered(sql`select pg_try_advisory_lock(hashtext(${LEADER_LOCK})) as ok`);
    leader = Boolean(row.ok);
    if (leader) log.info("scheduler_leader", { process: PROCESS_ID });
    return leader;
  } catch (err) {
    if (leader) log.warn("scheduler_leader_lost", { process: PROCESS_ID, error: err });
    else log.warn("scheduler_contend_failed", { error: err });
    leader = false;
    return false;
  }
}

/** Contends for the schedulers until the process ends; resolves after the first try, so the timers started next see it. */
export async function startLeadership(): Promise<void> {
  await contendForLeadership();
  contending ??= setInterval(contendForLeadership, RETRY_MS);
}

/** Lets go of the schedulers (on shutdown, or in tests), so another instance takes them at once. */
export async function resignLeadership(): Promise<void> {
  clearInterval(contending);
  contending = undefined;
  if (!leader || !lockSql) return;
  leader = false;
  await answered(lockSql`select pg_advisory_unlock(hashtext(${LEADER_LOCK}))`).catch((err) => log.warn("scheduler_resign_failed", { error: err }));
}

const until = (ms: number) => sql`now() + ${`${Math.round(ms)} milliseconds`}::interval`;

/** Takes the lease on `key` for `holder` when no live one exists; a lease that expired, whoever held it, is taken over. */
async function takeLease(key: string, holder: string, ttlMs: number): Promise<boolean> {
  // Leases of keys no longer used (a deleted chat session) do not pile up.
  await db.delete(leases).where(lt(leases.expiresAt, sql`now() - interval '1 hour'`));
  const taken = await db
    .insert(leases)
    .values({ key, holder, expiresAt: until(ttlMs) })
    .onConflictDoUpdate({ target: leases.key, set: { holder, expiresAt: until(ttlMs) }, setWhere: lt(leases.expiresAt, sql`now()`) })
    .returning({ key: leases.key });
  return taken.length > 0;
}

/**
 * Takes the lease on `key` and renews it every third of `ttlMs` until `release()`: null at once
 * when a live lease exists, held by another instance or by this one. Each lease has its own
 * holder token, so a handle whose lease expired and was taken over cannot renew or end the new one.
 */
export async function holdLease(key: string, ttlMs: number): Promise<{ release: () => Promise<void> } | null> {
  const holder = crypto.randomUUID();
  if (!(await takeLease(key, holder, ttlMs))) return null;
  const mine = and(eq(leases.key, key), eq(leases.holder, holder));
  const renewal = setInterval(() => {
    db.update(leases)
      .set({ expiresAt: until(ttlMs) })
      .where(mine)
      .catch((err) => log.warn("lease_renew_failed", { key, error: err }));
  }, Math.max(1_000, Math.floor(ttlMs / 3)));
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(renewal);
      await db
        .delete(leases)
        .where(mine)
        .catch((err) => log.warn("lease_release_failed", { key, error: err }));
    },
  };
}

/** Whether a live lease on `key` exists, held by any instance. */
export async function leaseHeld(key: string): Promise<boolean> {
  const [row] = await db
    .select({ key: leases.key })
    .from(leases)
    .where(and(eq(leases.key, key), gt(leases.expiresAt, sql`now()`)));
  return Boolean(row);
}
