// Work only one server instance may do at a time.
//
// The schedulers (signal scans, price checks, recaps, reminders, the brief, the
// status checks, pruning) run on one instance, the leader: it holds a Postgres
// advisory lock on a connection reserved for that, and every timer tick asks
// leaderOnly first. An instance that dies drops its connection, Postgres frees
// the lock, and another instance takes it at its next try (RETRY_MS). Until that
// instance notices a lost lock, two may lead for a few seconds; the work they
// share is idempotent in the database (unique indexes, conditional updates).
//
// Shorter work that must not run twice at once (a chat session's answer, a Lab
// run) takes a lease instead: a row held until it expires and renewed while the
// work runs. It costs no connection, and one left by a crashed process frees
// itself when it expires.
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, pgClient } from "./db";
import { leases } from "./db/schema";
import { log } from "./log";

const LEADER_LOCK = "tradingagents:scheduler";
const RETRY_MS = 15_000;
/** This process, in the logs. */
const PROCESS_ID = crypto.randomUUID();

type Reserved = Awaited<ReturnType<typeof pgClient.reserve>>;
let leader: Reserved | null = null;
let contending: ReturnType<typeof setInterval> | undefined;

/**
 * Whether a query failed because its connection closed. Such a connection is already back in
 * postgres.js's closed queue and must not be released: release() would hand the dead socket out again.
 */
const connectionGone = (err: unknown) => /^(CONNECTION_|CONNECT_TIMEOUT$|ECONNRESET$|EPIPE$)/.test(String((err as { code?: unknown })?.code ?? ""));

/** Gives a reserved connection back to the pool, unless the failure that ends its use closed it. */
function giveBack(conn: Reserved, failure?: unknown) {
  if (failure === undefined || !connectionGone(failure)) conn.release();
}

/** Whether this instance runs the schedulers. */
export const isLeader = () => leader !== null;

/** A scheduler tick that runs only on the instance that leads; on the others it does nothing. */
export function leaderOnly(tick: () => unknown): () => void {
  return () => {
    if (leader) tick();
  };
}

/** One try: keep the lock if this instance holds it, else take it when it is free. */
export async function contendForLeadership(): Promise<boolean> {
  try {
    if (leader) {
      // A lost connection (the database restarted) takes the lock with it.
      const [row] = await leader`select count(*)::int as held from pg_locks where locktype = 'advisory' and granted and pid = pg_backend_pid()`;
      if (row.held > 0) return true;
      throw new Error("the scheduler lock is no longer held");
    }
    const conn = await pgClient.reserve();
    let taken = false;
    try {
      [{ ok: taken }] = await conn`select pg_try_advisory_lock(hashtext(${LEADER_LOCK})) as ok`;
    } catch (err) {
      giveBack(conn, err);
      throw err;
    }
    if (!taken) {
      giveBack(conn);
      return false;
    }
    leader = conn;
    log.info("scheduler_leader", { process: PROCESS_ID });
    return true;
  } catch (err) {
    const lost = leader;
    leader = null;
    if (lost) {
      log.warn("scheduler_leader_lost", { error: err });
      giveBack(lost, err);
    } else {
      log.warn("scheduler_contend_failed", { error: err });
    }
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
  const held = leader;
  leader = null;
  if (!held) return;
  try {
    await held`select pg_advisory_unlock(hashtext(${LEADER_LOCK}))`;
    giveBack(held);
  } catch (err) {
    giveBack(held, err);
  }
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
