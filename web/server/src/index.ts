// The server process: migrate the database, make sure the first admin exists,
// pick up analyses an earlier process left behind, start the background
// schedulers, and serve the HTTP app (app.ts) with Bun.
import { startAlertScheduler } from "./alerts";
import { app } from "./app";
import { ensureAccounts } from "./auth";
import { config } from "./config";
import { runMigrations } from "./db";
import { recordError, startErrorPruning } from "./errors";
import { recover } from "./jobs";
import { startLedgerRecaps } from "./ledger";
import { log } from "./log";
import { startReminders } from "./reminders";
import { startBriefs } from "./site";
import { startStatusChecks } from "./status";
import { startWatchScheduler } from "./watch";
import { getCatalog } from "./worker";

await runMigrations();
// The first admin, and the owner of everything stored before accounts existed.
await ensureAccounts();
await recover();
startWatchScheduler();
startAlertScheduler();
startLedgerRecaps();
startBriefs();
startReminders();
startStatusChecks();
startErrorPruning();
// Warm the form options: the first catalog read starts Python and takes seconds.
getCatalog().catch((err) => recordError("catalog", err));

log.info("server_started", { url: `http://${config.host}:${config.port}`, python: config.pythonBin });

export default {
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  // Analyses stream for minutes; keep SSE connections from being cut.
  idleTimeout: 0,
};
