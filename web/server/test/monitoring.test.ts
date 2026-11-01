// What the server tells whoever runs it: /metrics for a Prometheus scrape behind
// its token (metrics.ts), and Telegram alerts when errors pile up, the queue stops,
// analyses keep failing or a part is down (monitor.ts), each sent once when it
// starts and once when it clears. The messages are caught here (useOpsSender).
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq, like, or } from "drizzle-orm";
import { db } from "../src/db";
import { analyses, serverErrors, sharedValues, users, type AnalysisRequest } from "../src/db/schema";
import { runOpsChecks, useOpsSender } from "../src/monitor";
import { writeShared } from "../src/shared";
import { forgetStatus } from "../src/status";
import { call, member } from "./helpers";

const sent: { chat: string | null; html: string }[] = [];
const TOKEN = "metrics-test-token-0123";
const request: AnalysisRequest = { ticker: "BTC-USD", date: "2026-11-01", analysts: ["market"], depth: 1, provider: "openai", quickModel: "m", deepModel: "m", language: "Indonesian" };

beforeAll(async () => {
  useOpsSender(async (chat, html) => {
    sent.push({ chat, html });
    return { ok: true };
  });
  // Only the admin the setup made receives the alerts, whichever admins other files made.
  await db.update(users).set({ telegramChatId: null }).where(eq(users.role, "admin"));
  await db.update(users).set({ telegramChatId: "1001" }).where(eq(users.username, process.env.APP_USER!));
});

beforeEach(async () => {
  sent.length = 0;
  delete process.env.ALERT_CHAT_ID;
  await db.delete(sharedValues).where(like(sharedValues.key, "ops:%"));
});

afterAll(async () => {
  useOpsSender();
  delete process.env.METRICS_TOKEN;
  delete process.env.ALERT_CHAT_ID;
  await db.update(users).set({ telegramChatId: null }).where(eq(users.role, "admin"));
  // The other files see no alert state and no status round of this file's making, in whatever order they run.
  await db.delete(sharedValues).where(or(like(sharedValues.key, "ops:%"), eq(sharedValues.key, "status:latest")));
  forgetStatus();
});

test("metrics need their token, and count requests by route pattern, never by path", async () => {
  delete process.env.METRICS_TOKEN;
  expect((await call("/metrics")).status).toBe(404);
  process.env.METRICS_TOKEN = TOKEN;
  expect((await call("/metrics")).status).toBe(401);
  expect((await call("/metrics", { headers: { authorization: "Bearer salah" } })).status).toBe(401);

  const m = await member();
  expect((await call(`/api/analyses/${crypto.randomUUID()}`, { cookie: m.cookie })).status).toBe(404);
  const r = await call("/metrics", { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("text/plain");
  expect(r.body).toContain('ta_http_requests_total{method="GET",route="/api/analyses/:id",status="404"}');
  expect(r.body).not.toMatch(/route="\/api\/analyses\/[0-9a-f-]{36}"/);
  expect(r.body).toMatch(/^ta_http_request_duration_seconds_count\{route="\/api\/analyses\/:id"\} \d+$/m);
  expect(r.body).toMatch(/^ta_analyses\{status="queued"\} \d+$/m);
  expect(r.body).toMatch(/^ta_scheduler_leader [01]$/m);
});

test("errors piling up are reported once, and once more when they clear", async () => {
  await db.delete(serverErrors);
  for (let i = 0; i < 5; i++) await db.insert(serverErrors).values({ code: `ops0${i}`, source: i < 4 ? "scan" : "prices", message: "boom" });
  await runOpsChecks(["errors"]);
  expect(sent).toHaveLength(1);
  expect(sent[0].chat).toBe("1001");
  expect(sent[0].html).toContain("5 error server dalam 10 menit terakhir (scan ×4, prices ×1)");
  await runOpsChecks(["errors"]);
  expect(sent).toHaveLength(1);

  await db.delete(serverErrors);
  await runOpsChecks(["errors"]);
  expect(sent).toHaveLength(2);
  expect(sent[1].html).toContain("Pulih");
  expect(sent[1].html).toContain("error server kembali normal");
});

test("a queue no worker takes from is reported, and cleared once it moves", async () => {
  await db.update(analyses).set({ status: "cancelled" }).where(eq(analyses.status, "queued"));
  await db.update(analyses).set({ status: "failed" }).where(eq(analyses.status, "running"));
  const m = await member();
  const [row] = await db
    .insert(analyses)
    .values({ userId: m.id, ticker: "BTC-USD", tradeDate: "2026-11-01", request, createdAt: new Date(Date.now() - 15 * 60_000) })
    .returning({ id: analyses.id });
  await runOpsChecks(["queue"]);
  expect(sent.at(-1)?.html).toContain("Antrean analisa tidak berjalan: 1 antre, yang tertua menunggu 15 menit, dan tidak ada yang sedang jalan");
  await db.update(analyses).set({ status: "completed" }).where(eq(analyses.id, row.id));
  await runOpsChecks(["queue"]);
  expect(sent.at(-1)?.html).toContain("antrean analisa berjalan lagi");
});

test("analyses failing one after another are reported", async () => {
  // Failures earlier in the suite stay outside the 30 minutes counted.
  await db.update(analyses).set({ finishedAt: new Date(Date.now() - 86_400_000) }).where(eq(analyses.status, "failed"));
  const m = await member();
  for (let i = 0; i < 3; i++) {
    await db.insert(analyses).values({ userId: m.id, ticker: "BTC-USD", tradeDate: "2026-11-01", request, status: "failed", finishedAt: new Date() });
  }
  await runOpsChecks(["failing"]);
  expect(sent.at(-1)?.html).toContain("3 analisa gagal dalam 30 menit terakhir");
});

test("a part found down goes to ALERT_CHAT_ID when it is set, instead of the admins", async () => {
  process.env.ALERT_CHAT_ID = "-1009876543210";
  await writeShared("status:latest", { at: Date.now(), parts: [{ name: "Database", state: "ok" }, { name: "Mesin analisa AI", state: "down" }] });
  await runOpsChecks(["status"]);
  expect(sent).toHaveLength(1);
  expect(sent[0].chat).toBe("-1009876543210");
  expect(sent[0].html).toContain("Cek status menemukan bagian yang mati: Mesin analisa AI.");
});
