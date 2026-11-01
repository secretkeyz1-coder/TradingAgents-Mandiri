// The HTTP app: every route, its middleware and the error answer, with no side
// effects of its own. index.ts runs the migrations and the schedulers and serves
// it; the test suite (web/server/test) calls it directly with app.request().
import { existsSync } from "node:fs";
import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { agentApi } from "./agent";
import { alertsApi } from "./alerts";
import { authApi, meApi, requireAuth, usersApi, type AppEnv } from "./auth";
import { billingApi, invoicePages } from "./billing";
import { businessApi } from "./business";
import { config } from "./config";
import { couponsApi } from "./coupons";
import { creatorsApi, creatorsPublicApi } from "./creators";
import { errorCode, recordError } from "./errors";
import { labApi } from "./lab";
import { ledgerApi } from "./ledger";
import { log } from "./log";
import { priceAlertsApi } from "./price-alerts";
import { api } from "./routes";
import { scriptsApi } from "./scripts";
import { siteApi } from "./site";
import { statusApi } from "./status";
import { venuesApi } from "./venues";
import { watchApi } from "./watch";

export const app = new Hono<AppEnv>();

// Every request gets a short id: echoed in X-Request-Id, written on its log line,
// and shown to the user as the code of a 500 answer, so a report finds the details.
app.use("*", async (c, next) => {
  const id = errorCode();
  c.set("requestId", id);
  const started = performance.now();
  await next();
  c.res.headers.set("X-Request-Id", id);
  if (c.req.path.startsWith("/api/")) {
    // The path only: query strings can carry one-time tokens.
    log.info("request", { id, method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started), user: c.get("user")?.id });
  }
});

// Browser protections on every answer. The content policy only reports for now (to
// /api/csp-report): the TradingView widgets load scripts and frames from their own
// domains, so it is enforced once the reports show nothing legitimate would be blocked.
app.use(
  "*",
  secureHeaders({
    strictTransportSecurity: "max-age=15552000",
    xFrameOptions: "SAMEORIGIN",
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: "same-site",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
    contentSecurityPolicyReportOnly: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'", "https://s3.tradingview.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "https://*.tradingview.com", "https://*.tradingview-widget.com"],
      workerSrc: ["'self'", "blob:"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      reportUri: ["/api/csp-report"],
    },
  }),
);

// Unauthenticated, for the container's health check and a reverse proxy.
app.get("/healthz", (c) => c.text("ok"));

// What the content policy would have blocked, as browsers report it: logged, at most 30 a minute.
let cspWindow = { minute: 0, count: 0 };
app.post("/api/csp-report", async (c) => {
  const minute = Math.floor(Date.now() / 60_000);
  if (cspWindow.minute !== minute) cspWindow = { minute, count: 0 };
  if (++cspWindow.count <= 30) log.warn("csp_report", { report: (await c.req.text().catch(() => "")).slice(0, 2000) });
  return c.body(null, 204);
});
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

/**
 * The answer for an error no route handled: a plain message with the request's code.
 * The message and stack go to the log and the admin's error list (errors.ts), never to
 * the user, since they can carry SQL, paths or other internals.
 */
export async function answerError(err: Error, c: Context<AppEnv>) {
  // Middleware answers (401 with its WWW-Authenticate challenge) go out as they are.
  if (err instanceof HTTPException) return err.getResponse();
  const code = await recordError("request", err, { code: c.get("requestId"), method: c.req.method, path: c.req.path, userId: c.get("user")?.id });
  return c.json({ error: `Terjadi kesalahan di server (kode ${code}). Coba lagi; kalau terulang, sebutkan kode ini ke admin.` }, 500);
}
app.onError(answerError);

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
