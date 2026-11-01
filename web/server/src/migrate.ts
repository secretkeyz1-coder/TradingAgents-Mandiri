// Applies the database migrations and exits: the deploy's step before the app is
// replaced (web/deploy/compose.yml runs it as the one-shot "migrate" service, and
// the app then starts with MIGRATE_ON_START=0). Exit status 1 when a migration
// fails, which stops the deploy while the running app keeps serving the old code.
import { pgClient, runMigrations } from "./db";
import { log } from "./log";

try {
  await runMigrations();
  const [{ total }] = await pgClient`select count(*)::int as total from drizzle.__drizzle_migrations`;
  log.info("migrations_applied", { total });
  process.exit(0);
} catch (err) {
  log.error("migrations_failed", { error: err });
  process.exit(1);
}
