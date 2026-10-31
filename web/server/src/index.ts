import { existsSync } from "node:fs";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { config } from "./config";
import { runMigrations } from "./db";
import { recover } from "./jobs";
import { agentApi } from "./agent";
import { alertsApi, startAlertScheduler } from "./alerts";
import { billingApi } from "./billing";
import { labApi } from "./lab";
import { venuesApi } from "./venues";
import { ledgerApi, startLedgerRecaps } from "./ledger";
import { scriptsApi } from "./scripts";
import { authApi, ensureAccounts, meApi, requireAuth, usersApi, type AppEnv } from "./auth";
import { api } from "./routes";
import { startWatchScheduler, watchApi } from "./watch";
import { getCatalog } from "./worker";

await runMigrations();
// The first admin, and the owner of everything stored before accounts existed.
await ensureAccounts();
await recover();
startWatchScheduler();
startAlertScheduler();
startLedgerRecaps();
// Warm the form options: the first catalog read starts Python and takes seconds.
getCatalog().catch((err) => console.error("catalog warm-up failed", err));

const app = new Hono<AppEnv>();
// Unauthenticated, for the container's health check and a reverse proxy.
app.get("/healthz", (c) => c.text("ok"));
app.use("/api/*", logger());
// Login, logout and the session check come before the guard; every other API
// route needs a session. The page itself is public: it holds no data and shows
// the login form until /api/session says yes. Cookies ride on same-origin
// fetch and EventSource, so the SSE streams need nothing extra.
app.route("/api", authApi);
app.use("/api/*", requireAuth);
app.route("/api", meApi);
app.route("/api", usersApi);
app.route("/api", billingApi);
app.route("/api", api);
app.route("/api", agentApi);
app.route("/api", watchApi);
app.route("/api", alertsApi);
app.route("/api", ledgerApi);
app.route("/api", labApi);
app.route("/api", venuesApi);
app.route("/api", scriptsApi);
app.onError((err, c) => {
  // Middleware answers (401 with its WWW-Authenticate challenge) go out as they are.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// In production the built client is served from here; in dev Vite serves it
// and proxies /api to this server. The app lives at /app; the public pages
// (pricing, legal) beside it, and the landing page at the root once
// PUBLIC_SITE=on (until then the root opens the app, as it always did).
if (existsSync(config.clientDist)) {
  const dist = config.clientDist;
  const page = (name: string) => serveStatic({ path: `${dist}/${name}/index.html` });
  app.get("/", process.env.PUBLIC_SITE === "on" ? serveStatic({ path: `${dist}/index.html` }) : (c) => c.redirect("/app"));
  app.get("/app", page("app"));
  app.get("/app/", page("app"));
  for (const name of ["harga", "syarat", "privasi", "disclaimer"]) app.get(`/${name}`, page(name));
  app.use("/*", serveStatic({ root: dist }));
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found" }, 404) : c.redirect("/")));
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
