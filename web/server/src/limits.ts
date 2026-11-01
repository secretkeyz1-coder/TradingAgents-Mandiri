// Attempt limits shared by every server instance: wrong passwords and two-step
// codes lock an address or an account out for a while, and sign-ups, mails and
// browsers' content-policy reports are capped per hour or minute. Kept in
// memory, each instance would grant its own allowance and a restart would forget
// them; here a row per key holds one fixed window, timed by the database's clock
// so instances whose clocks differ still agree. Ended windows are pruned daily.
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { rateLimits } from "./db/schema";
import { recordError } from "./errors";
import { leaderOnly } from "./locks";

const interval = (ms: number) => sql`${`${Math.round(ms)} milliseconds`}::interval`;

/** One more attempt on `key`, in a window of `windowMs` that starts with the first: the count so far. */
async function bump(key: string, windowMs: number): Promise<number> {
  const ended = sql`${rateLimits.resetAt} <= now()`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: sql`now() + ${interval(windowMs)}` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${ended} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${ended} then now() + ${interval(windowMs)} else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count });
  return row.count;
}

/** Counts an attempt on `key`: false once more than `max` fall in one window of `windowMs`. */
export async function allow(key: string, max: number, windowMs: number): Promise<boolean> {
  return (await bump(key, windowMs)) <= max;
}

/** How long `key` stays locked (ms) after `max` failures in its window; 0 when it is not locked. */
export async function lockedFor(key: string, max: number): Promise<number> {
  const [row] = await db
    .select({ count: rateLimits.count, left: sql<string>`extract(epoch from ${rateLimits.resetAt} - now()) * 1000` })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, key), gt(rateLimits.resetAt, sql`now()`)));
  return row && row.count >= max ? Math.max(1, Math.ceil(Number(row.left))) : 0;
}

/** Counts a failure on `key`, in a window of `windowMs` that starts with the first failure. */
export async function recordFailure(key: string, windowMs: number): Promise<void> {
  await bump(key, windowMs);
}

/** Forgets `key`'s failures, after it got something right. */
export async function clearFailures(key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/** Deletes the windows that ended a day ago or more, daily, on the instance that runs the schedulers. */
export function startLimitPruning() {
  const prune = leaderOnly(() =>
    db
      .delete(rateLimits)
      .where(lt(rateLimits.resetAt, sql`now() - interval '1 day'`))
      .catch((err) => recordError("limits", err)),
  );
  prune();
  setInterval(prune, 86_400_000);
}
