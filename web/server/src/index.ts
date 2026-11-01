// The server process: migrate the database, make sure the first admin exists,
// pick up analyses an earlier process left behind, start the background
// schedulers, and serve the HTTP app (app.ts) with Bun. Every instance starts the
// schedulers' timers; only the one holding the scheduler lock runs them (locks.ts).
import { startAlertScheduler } from "./alerts";
import { app } from "./app";
import { ensureAccounts } from "./auth";
import { config } from "./config";
import { runMigrations } from "./db";
import { recordError, startErrorPruning } from "./errors";
import { recover } from "./jobs";
import { startLedgerRecaps } from "./ledger";
import { startLimitPruning } from "./limits";
import { isLeader, resignLeadership, startLeadership } from "./locks";
import { log } from "./log";
import { startReminders } from "./reminders";
import { startBriefs } from "./site";
import { startStatusChecks } from "./status";
import { startWatchScheduler } from "./watch";
import { getCatalog } from "./worker";

// In production the deploy migrates first (migrate.ts) and sets MIGRATE_ON_START=0.
if (process.env.MIGRATE_ON_START !== "0") await runMigrations();
// The first admin, and the owner of everything stored before accounts existed.
await ensureAccounts();
await recover();
// Decided before the timers start, so their first runs happen on the leader only.
await startLeadership();
startWatchScheduler();
startAlertScheduler();
startLedgerRecaps();
startBriefs();
startReminders();
startStatusChecks();
startErrorPruning();
startLimitPruning();
// Warm the form options: the first catalog read starts Python and takes seconds.
getCatalog().catch((err) => recordError("catalog", err));

// docker stop: hand the schedulers over at once rather than after the lock times out.
process.on("SIGTERM", () => {
  resignLeadership().finally(() => process.exit(0));
});

log.info("server_started", { url: `http://${config.host}:${config.port}`, python: config.pythonBin, leader: isLeader() });

export default {
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  // Analyses stream for minutes; keep SSE connections from being cut.
  idleTimeout: 0,
};
