// Small values every server instance must agree on, kept in Postgres rather than
// one process's memory. The schedulers run on one instance only (locks.ts), so
// what they last did (the signal scan, the status checks) and the last Telegram
// send must be readable from whichever instance answers the status page.
import { eq } from "drizzle-orm";
import { db } from "./db";
import { sharedValues } from "./db/schema";

/** The value stored under `key`, or null when none is. */
export async function readShared<T>(key: string): Promise<T | null> {
  const [row] = await db.select({ value: sharedValues.value }).from(sharedValues).where(eq(sharedValues.key, key));
  return row ? (row.value as T) : null;
}

/** Stores `value` under `key` for every instance to read. */
export async function writeShared(key: string, value: unknown): Promise<void> {
  await db
    .insert(sharedValues)
    .values({ key, value })
    .onConflictDoUpdate({ target: sharedValues.key, set: { value, updatedAt: new Date() } });
}
