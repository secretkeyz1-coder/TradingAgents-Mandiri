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
import { billingApi, invoicePages } from "./billing";
import { businessApi } from "./business";
import { couponsApi } from "./coupons";
import { creatorsApi, creatorsPublicApi } from "./creators";
import { priceAlertsApi } from "./price-alerts";
import { startReminders } from "./reminders";
import { startStatusChecks, statusApi } from "./status";
import { labApi } from "./lab";
import { venuesApi } from "./venues";
import { ledgerApi, startLedgerRecaps } from "./ledger";
import { scriptsApi } from "./scripts";
import { siteApi, startBriefs } from "./site";
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
startBriefs();
startReminders();
startStatusChecks();
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
// The public site's prices, signals and AI brief: no sign-in, all cached.
app.route("/api", siteApi);
app.route("/api", statusApi);
app.route("/api", creatorsPublicApi);
app.use("/api/*", requireAuth);
app.route("/api", meApi);
app.route("/api", usersApi);
app.route("/api", billingApi);
app.route("/api", couponsApi);
app.route("/api", businessApi);
app.route("/api", creatorsApi);
app.route("/api", api);
app.route("/api", agentApi);
app.route("/api", watchApi);
app.route("/api", alertsApi);
app.route("/api", priceAlertsApi);
app.route("/api", ledgerApi);
app.route("/api", labApi);
app.route("/api", venuesApi);
app.route("/api", scriptsApi);
// An order's invoice page opens from its signed link, without a session.
app.route("/", invoicePages);
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
  // The file is joined onto `root` (default "./"), so it stays relative: an absolute path would land under the working directory on Linux.
  const page = (name: string) => serveStatic({ root: dist, path: `${name}/index.html` });
  app.get("/", process.env.PUBLIC_SITE === "on" ? serveStatic({ root: dist, path: "index.html" }) : (c) => c.redirect("/app"));
  app.get("/app", page("app"));
  app.get("/app/", page("app"));
  for (const name of ["harga", "syarat", "privasi", "disclaimer", "status"]) app.get(`/${name}`, page(name));
  // A Creator's public track record; the page reads the name from the address.
  app.get("/c/:username", page("c"));
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
