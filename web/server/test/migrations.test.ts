// Migrations as a deploy runs them (runMigrations in db/index.ts, migrate.ts): two
// instances that start on one fresh database at once take turns, and every migration
// applies once. A database of its own, made and dropped here, keeps the suite's intact.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { runMigrations } from "../src/db";

test("two instances migrating one fresh database at once both finish, each migration applied once", async () => {
  const suite = new URL(process.env.DATABASE_URL!);
  const name = suite.pathname.slice(1).replace(/_test$/, "_migrate_test");
  const maintenance = new URL(suite);
  maintenance.pathname = "/postgres";
  const sql = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  await sql.unsafe(`drop database if exists "${name}" with (force)`);
  await sql.unsafe(`create database "${name}"`);
  const fresh = new URL(suite);
  fresh.pathname = `/${name}`;
  try {
    await Promise.all([runMigrations(fresh.toString()), runMigrations(fresh.toString())]);
    const check = postgres(fresh.toString(), { max: 1, onnotice: () => {} });
    const [{ applied }] = await check`select count(*)::int as applied from drizzle.__drizzle_migrations`;
    await check.end();
    expect(applied).toBe(readdirSync(join(import.meta.dir, "..", "drizzle")).filter((f) => f.endsWith(".sql")).length);
  } finally {
    await sql.unsafe(`drop database if exists "${name}" with (force)`);
    await sql.end();
  }
}, 120_000);
