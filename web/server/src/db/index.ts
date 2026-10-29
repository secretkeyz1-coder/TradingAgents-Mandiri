import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { join } from "node:path";
import { config } from "../config";
import * as schema from "./schema";

const client = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
export const db = drizzle(client, { schema });

export async function runMigrations() {
  await migrate(db, { migrationsFolder: join(import.meta.dir, "..", "..", "drizzle") });
}
