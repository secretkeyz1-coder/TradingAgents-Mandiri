import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { join } from "node:path";
import { config } from "../config";
import * as schema from "./schema";

const client = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
export const db = drizzle(client, { schema });
/** The pool under `db`, for what Drizzle does not cover: a reserved connection holding a session lock (locks.ts). */
export const pgClient = client;

/**
 * Applies the pending migrations to `url` (the app's own database unless given). Instances
 * that start together take turns on an advisory lock: the next one finds nothing left to apply.
 */
export async function runMigrations(url = config.databaseUrl) {
  const own = url === config.databaseUrl ? null : postgres(url, { max: 2, onnotice: () => {} });
  const conn = await (own ?? client).reserve();
  try {
    await conn`select pg_advisory_lock(hashtext('tradingagents:migrate'))`;
    await migrate(own ? drizzle(own, { schema }) : db, { migrationsFolder: join(import.meta.dir, "..", "..", "drizzle") });
  } finally {
    await conn`select pg_advisory_unlock(hashtext('tradingagents:migrate'))`.catch(() => {});
    conn.release();
    await own?.end();
  }
}
