import { existsSync } from "node:fs";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { config } from "./config";
import { runMigrations } from "./db";
import { recover } from "./jobs";
import { agentApi } from "./agent";
import { api } from "./routes";
import { getCatalog } from "./worker";

await runMigrations();
await recover();
// Warm the form options: the first catalog read starts Python and takes seconds.
getCatalog().catch((err) => console.error("catalog warm-up failed", err));

const app = new Hono();
app.use("/api/*", logger());
app.route("/api", api);
app.route("/api", agentApi);
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// In production the built client is served from here; in dev Vite serves it
// and proxies /api to this server.
if (existsSync(config.clientDist)) {
  app.use("/*", serveStatic({ root: config.clientDist }));
  app.get("*", serveStatic({ path: `${config.clientDist}/index.html` }));
}

console.log(`TradingAgents web API on http://${config.host}:${config.port}`);
console.log(`Python worker: ${config.pythonBin}`);

export default {
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
  // Analyses stream for minutes; keep SSE connections from being cut.
  idleTimeout: 0,
};
