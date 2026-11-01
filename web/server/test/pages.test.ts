// What a browser and the container's health check reach without signing in, and
// the guard in front of everything else.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { config } from "../src/config";
import { call } from "./helpers";

test("the health check answers ok", async () => {
  const r = await call("/healthz");
  expect(r.status).toBe(200);
  expect(r.body).toBe("ok");
});

test("API routes past the guard refuse a request without a session", async () => {
  for (const path of ["/api/me", "/api/price-alerts", "/api/verdict?ticker=BTC-USD", "/api/admin/config"]) {
    expect((await call(path)).status).toBe(401);
  }
});

test("the public data routes answer without a session", async () => {
  expect((await call("/api/auth/config")).status).toBe(200);
  expect((await call("/api/public/brief")).status).toBe(200);
});

// The pages exist only once the client is built (bun run build in web/client).
const built = existsSync(config.clientDist);

test.if(built)("the app and the public pages are served", async () => {
  for (const path of ["/app", "/harga", "/status", "/c/someone"]) expect((await call(path)).status).toBe(200);
});

test.if(built)("without PUBLIC_SITE the root opens the app", async () => {
  const r = await call("/");
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe("/app");
});
