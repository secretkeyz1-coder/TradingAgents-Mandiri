// The analysis worker process (web/deploy/compose.yml, service "worker"): it claims
// queued analyses and backtests from Postgres and runs the engine for them
// (jobs.ts), so the API's instances never spawn it for those. Run as many as the
// machine allows; each runs MAX_CONCURRENT_ANALYSES at once. The rows of a runner
// that dies are failed by the API leader's sweep once their heartbeat stops.
import { config } from "./config";
import { recordError } from "./errors";
import { startRunner, stopRunner } from "./jobs";
import { log } from "./log";

if (config.maxConcurrent < 1) {
  log.error("runner_not_started", { reason: "MAX_CONCURRENT_ANALYSES must be 1 or more in a worker process" });
  process.exit(1);
}
await startRunner();
log.info("runner_started", { concurrency: config.maxConcurrent, python: config.pythonBin });

// docker stop: the runs here end with a reason rather than waiting for the sweep.
process.on("SIGTERM", () => {
  stopRunner()
    .catch((err) => recordError("jobs", err))
    .finally(() => process.exit(0));
});
