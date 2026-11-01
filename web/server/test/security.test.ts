// The protections every answer carries (app.ts), the settings checked at start
// (config.ts), and what an unhandled error shows: a code for the user, the details
// for the admin only (errors.ts).
import { expect, test } from "bun:test";
import { Hono } from "hono";
import { answerError } from "../src/app";
import type { AppEnv } from "../src/auth";
import { readSettings } from "../src/config";
import { admin, call, member } from "./helpers";

test("every answer carries the browser protections and a request id", async () => {
  for (const path of ["/healthz", "/api/auth/config", "/api/me"]) {
    const r = await call(path);
    expect(r.headers.get("strict-transport-security")).toContain("max-age=");
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(r.headers.get("content-security-policy-report-only")).toContain("default-src 'self'");
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f]{8}$/);
  }
});

test("a browser's content-policy report is taken without a session", async () => {
  const r = await call("/api/csp-report", { body: { "csp-report": { "violated-directive": "script-src", "blocked-uri": "https://example.test/x.js" } } });
  expect(r.status).toBe(204);
});

test("an unhandled error answers with its code and no internals; the admin sees the details", async () => {
  const boom = new Hono<AppEnv>();
  boom.use("*", async (c, next) => {
    c.set("requestId", "abcd1234");
    await next();
  });
  boom.get("/x", () => {
    throw new Error('relation "secret_table" does not exist');
  });
  boom.onError(answerError);
  const res = await boom.request("/x");
  const body = (await res.json()) as { error: string };
  expect(res.status).toBe(500);
  expect(body.error).toContain("abcd1234");
  expect(body.error).not.toContain("secret_table");

  const list = await call("/api/admin/errors", { cookie: await admin() });
  expect(list.status).toBe(200);
  const kept = list.body.items.find((e: { code: string }) => e.code === "abcd1234");
  expect(kept.message).toContain("secret_table");
  expect(kept.source).toBe("request");
  expect(list.body.lastDay).toBeGreaterThan(0);
  expect((await call("/api/admin/errors", { cookie: (await member()).cookie })).status).toBe(403);
});

test("wrong settings stop the server, each one named", () => {
  expect(() => readSettings({ PORT: "abc", PUBLIC_URL: "bukan url", LOG_LEVEL: "loud" })).toThrow(/PORT[\s\S]*PUBLIC_URL[\s\S]*LOG_LEVEL/);
  expect(() => readSettings({ MAX_CONCURRENT_ANALYSES: "-1" })).toThrow(/MAX_CONCURRENT_ANALYSES/);
});

test("a server open to the network with sign-in needs a session secret of 32 characters or more", () => {
  expect(() => readSettings({ HOST: "0.0.0.0", APP_PASSWORD: "x" })).toThrow(/SESSION_SECRET/);
  expect(() => readSettings({ HOST: "0.0.0.0", APP_PASSWORD: "x", SESSION_SECRET: "pendek" })).toThrow(/SESSION_SECRET/);
  expect(readSettings({ HOST: "0.0.0.0", APP_PASSWORD: "x", SESSION_SECRET: "s".repeat(32) }).PORT).toBe(3080);
});

test("on loopback the defaults apply and no secret is needed", () => {
  expect(readSettings({})).toMatchObject({ PORT: 3080, MAX_CONCURRENT_ANALYSES: 2, JOB_IDLE_MINUTES: 15 });
  expect(readSettings({ PORT: "", PUBLIC_URL: "" }).PORT).toBe(3080);
});
