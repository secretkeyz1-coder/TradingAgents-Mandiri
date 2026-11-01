// Runs once before the test files (bunfig.toml preload): the server's settings for
// tests, then a fresh test database, migrated, with the first admin made from the
// test password. The database is dropped and recreated on every run, so its name
// must end in _test; any other name stops the run before anything is touched.
// Server modules read their settings when first imported, so they are imported
// only after the settings below are in place.
import postgres from "postgres";

const url = process.env.TEST_DATABASE_URL ?? "postgres://tradingagents:tradingagents@127.0.0.1:5590/tradingagents_test";
const name = new URL(url).pathname.slice(1);
if (!name.endsWith("_test")) throw new Error(`TEST_DATABASE_URL must name a database ending in _test, not "${name}"`);

Object.assign(process.env, {
  DATABASE_URL: url,
  HOST: "127.0.0.1",
  APP_USER: "admin",
  APP_PASSWORD: crypto.randomUUID(),
  SESSION_SECRET: crypto.randomUUID(),
  SIGNUP: "open",
  // Mail is "sent" to the outbox in mail.ts, where the tests read links from.
  MAIL_LOG: "1",
  SITE_BRIEF: "off",
  REMINDERS: "off",
  // Request lines stay out of the test output; warnings and errors still show.
  LOG_LEVEL: "warn",
  PUBLIC_URL: "http://localhost:3999",
  // Queued analyses stay queued: no analysis job starts under test.
  MAX_CONCURRENT_ANALYSES: "0",
  TA_WORKER_SCRIPT: "web/worker/demo_worker.py",
});

const maintenance = new URL(url);
maintenance.pathname = "/postgres";
const sql = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
await sql.unsafe(`drop database if exists "${name}" with (force)`);
await sql.unsafe(`create database "${name}"`);
await sql.end();

const { runMigrations } = await import("../src/db");
await runMigrations();
const { ensureAccounts } = await import("../src/auth");
await ensureAccounts();
