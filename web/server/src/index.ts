import { existsSync } from "node:fs";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
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
// Unauthenticated, for the container's health check and a reverse proxy.
app.get("/healthz", (c) => c.text("ok"));
if (config.appPassword) {
  // Browsers resend Basic credentials on same-origin fetch and EventSource, so the SSE streams need nothing extra.
  app.use("*", basicAuth({ username: config.appUser, password: config.appPassword, realm: "TradingAgents" }));
}
app.use("/api/*", logger());
app.route("/api", api);
app.route("/api", agentApi);
app.onError((err, c) => {
  // Middleware answers (401 with its WWW-Authenticate challenge) go out as they are.
  if (err instanceof HTTPException) return err.getResponse();
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
