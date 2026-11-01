// The API reference (docs/api/openapi.json), generated from the routes themselves
// rather than written beside them: every route the app mounts, with its path
// parameters, whether it needs a session (mounted after requireAuth) or an admin
// (behind requireAdmin), and the request bodies of the main routes from their zod
// schemas; the rest say only that they take JSON. `bun run openapi` writes the
// file, and a test fails when a route changes without the file written again.
import { join } from "node:path";
import { z } from "zod";
import { alertSchema } from "./alerts";
import { app } from "./app";
import { loginSchema, signupSchema } from "./auth";
import { config } from "./config";
import { runSchema } from "./lab";
import { log } from "./log";
import { levelSchema } from "./price-alerts";
import { backtestSchema, createSchema } from "./routes";

export const OPENAPI_FILE = join(config.repoRoot, "docs", "api", "openapi.json");

/** The routes whose request body is documented from its schema. */
const BODIES: Record<string, { summary: string; schema: z.ZodType }> = {
  "POST /api/login": { summary: "Masuk dengan nama pengguna dan kata sandi", schema: loginSchema },
  "POST /api/signup": { summary: "Daftar akun baru dengan email", schema: signupSchema },
  "POST /api/analyses": { summary: "Antrekan satu analisa", schema: createSchema },
  "POST /api/backtests": { summary: "Antrekan backtest", schema: backtestSchema },
  "POST /api/alerts": { summary: "Buat notifikasi sinyal", schema: alertSchema },
  "POST /api/price-alerts": { summary: "Buat notifikasi harga", schema: levelSchema },
  "POST /api/lab/run": { summary: "Jalankan uji Lab", schema: runSchema },
};

const METHODS = ["get", "post", "put", "patch", "delete"];
type Route = { method: string; path: string; handler: { name?: string } };

/** Whether a middleware mounted on `pattern` ("/api/*", "/api/users") runs for `path`. */
const covers = (pattern: string, path: string) =>
  pattern.endsWith("/*") ? path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1)) : pattern === path;

function bodySchema(schema: z.ZodType) {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return json;
}

/** The OpenAPI 3.1 document of the app as it is mounted now. */
export function openApiDocument() {
  const routes = app.routes as Route[];
  const paths: Record<string, Record<string, unknown>> = {};
  routes.forEach((route, i) => {
    if (route.method === "ALL") return;
    if (!route.path.startsWith("/api/") && route.path !== "/healthz" && route.path !== "/metrics") return;
    const guards = routes.slice(0, i).filter((r) => r.method === "ALL" && covers(r.path, route.path));
    const member = guards.some((r) => r.handler.name === "requireAuth");
    const admin = guards.some((r) => r.handler.name === "requireAdmin");
    const names: string[] = [];
    const path = route.path.replace(/:(\w+)(\{[^}]*\})?/g, (_, name: string) => {
      names.push(name);
      return `{${name}}`;
    });
    const body = BODIES[`${route.method} ${route.path}`];
    const takesJson = ["POST", "PUT", "PATCH"].includes(route.method);
    (paths[path] ??= {})[route.method.toLowerCase()] = {
      tags: [route.path.split("/")[route.path.startsWith("/api/") ? 2 : 1]],
      ...(body ? { summary: body.summary } : {}),
      security: route.path === "/metrics" ? [{ metrics: [] }] : member ? [{ session: [] }, { basic: [] }] : [],
      ...(admin ? { "x-admin": true } : {}),
      ...(names.length ? { parameters: names.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })) } : {}),
      ...(body
        ? { requestBody: { required: true, content: { "application/json": { schema: bodySchema(body.schema) } } } }
        : takesJson
          ? { requestBody: { content: { "application/json": { schema: { type: "object" } } } } }
          : {}),
      responses: {
        "200": { description: "Berhasil" },
        ...(takesJson ? { "400": { description: "Isian tidak valid; `error` menjelaskannya" } } : {}),
        ...(member ? { "401": { description: "Belum masuk" } } : {}),
        ...(admin ? { "403": { description: "Khusus admin" } } : {}),
      },
    };
  });
  const sorted = Object.fromEntries(
    Object.keys(paths)
      .sort()
      .map((p) => [p, Object.fromEntries(METHODS.filter((m) => paths[p][m]).map((m) => [m, paths[p][m]]))]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "TradingAgents web API",
      version: "1",
      description:
        "Dibangkitkan dari route server (web/server/src/openapi.ts); jangan disunting tangan, jalankan `bun run openapi`. Error dijawab sebagai `{ \"error\": \"...\" }`. `x-admin`: khusus admin.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: "ta_session", description: "Cookie sesi dari POST /api/login" },
        basic: { type: "http", scheme: "basic", description: "Nama pengguna dan kata sandi akun, untuk skrip; tidak untuk akun dengan verifikasi dua langkah" },
        metrics: { type: "http", scheme: "bearer", description: "METRICS_TOKEN" },
      },
    },
    paths: sorted,
  };
}

if (import.meta.main) {
  await Bun.write(OPENAPI_FILE, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
  log.info("openapi_written", { file: OPENAPI_FILE });
}
