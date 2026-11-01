// The analysis queue across processes (jobs.ts): a runner claims queued rows (never
// two runners one row), stores and announces every event, and a listener in any
// process (the live stream, the watchlist) gets them with the end; a cancel, the
// orphan sweep or a runner's shutdown finishes a row in place. Fake jobs stand in
// for the engine (useJobs).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { app } from "../src/app";
import { db } from "../src/db";
import { analyses, type AnalysisRequest } from "../src/db/schema";
import { cancel, claimNext, enqueue, failOrphans, startRunner, stopListening, stopRunner, subscribe, useJobs, type LiveEvent } from "../src/jobs";
import type { WorkerEvent, WorkerHandle } from "../src/worker";
import { member } from "./helpers";

type Job = NonNullable<Parameters<typeof useJobs>[0]>;

/** A fake engine run: emits `events`, then ends at once or, holding, only when killed. */
function fake(events: WorkerEvent[], hold = false, onKill = () => {}): Job {
  return (_kind, _request, _meter, onEvent): WorkerHandle => {
    let killed!: () => void;
    const stopped = new Promise<void>((resolve) => (killed = resolve));
    const done = (async () => {
      for (const event of events) await onEvent(event);
      if (hold) await stopped;
      return { exitCode: hold ? 143 : 0, stderrTail: "" };
    })();
    return {
      kill: () => {
        onKill();
        killed();
      },
      done,
    };
  };
}

const request: AnalysisRequest = { ticker: "BTC-USD", date: "2026-11-01", analysts: ["market"], depth: 1, provider: "openai", quickModel: "m", deepModel: "m", language: "Indonesian" };

async function queued(userId: string) {
  const [row] = await db.insert(analyses).values({ userId, ticker: "BTC-USD", tradeDate: "2026-11-01", request }).returning({ id: analyses.id });
  return row.id;
}

const rowOf = async (id: string) =>
  (await db.select({ status: analyses.status, error: analyses.error, rating: analyses.rating, reportHtml: analyses.reportHtml }).from(analyses).where(eq(analyses.id, id)))[0];

/** Waits for `check` to give something truthy. */
async function until<T>(check: () => Promise<T | null | undefined | false>, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`not within ${ms} ms`);
    await Bun.sleep(50);
  }
}

/** The events of an SSE response, read until its end event. */
async function readStream(res: Response, ms = 15_000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (!/event: end[\s\S]*?\n\n/.test(text)) {
    const left = deadline - Date.now();
    const chunk = left > 0 ? await Promise.race([reader.read(), Bun.sleep(left).then(() => null)]) : null;
    if (!chunk || chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text
    .split("\n\n")
    .map((block) => Object.fromEntries(block.split("\n").flatMap((line) => (line.includes(": ") && !line.startsWith(":") ? [[line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]] : []))))
    .filter((fields) => fields.event) as { event: string; data: string }[];
}

beforeAll(async () => {
  // Rows other files queued (no runner runs in the suite) would be claimed here first.
  await db.update(analyses).set({ status: "cancelled" }).where(eq(analyses.status, "queued"));
});

afterAll(async () => {
  await stopRunner();
  useJobs();
  await stopListening();
});

test("a runner runs a queued analysis, and its live stream gets every event and the end", async () => {
  const m = await member();
  const id = await queued(m.id);
  useJobs(
    fake([
      { type: "started", ticker: "BTC-USD", assetType: "crypto" },
      { type: "report", section: "market", content: "Tren naik" },
      { type: "done", rating: "Buy", html: "<p>laporan</p>", reportDir: null },
    ]),
  );
  // The stream opens first, as a browser's would, while the row waits in the queue.
  const res = await app.request(`/api/analyses/${id}/events`, { headers: { cookie: m.cookie } });
  expect(res.status).toBe(200);
  const reading = readStream(res);
  await startRunner(1);
  const got = await reading;
  expect(got.map((e) => e.event)).toEqual(["started", "report", "done", "end"]);
  expect(JSON.parse(got.at(-1)!.data)).toMatchObject({ status: "completed", rating: "Buy" });
  expect(await rowOf(id)).toMatchObject({ status: "completed", rating: "Buy", reportHtml: "<p>laporan</p>" });
  await stopRunner();
});

test("enqueue wakes an idle runner without waiting for its poll", async () => {
  useJobs(fake([{ type: "done", rating: "Hold", html: null, reportDir: null }]));
  await startRunner(1);
  const m = await member();
  const id = await queued(m.id);
  enqueue(id);
  await until(async () => (await rowOf(id)).status === "completed", 4_000);
  await stopRunner();
});

test("runners never claim one row twice", async () => {
  const m = await member();
  const ids = [await queued(m.id), await queued(m.id), await queued(m.id)];
  const claims = await Promise.all([claimNext(), claimNext(), claimNext(), claimNext()]);
  expect(claims.flatMap((row) => (row ? [row.id] : [])).sort()).toEqual([...ids].sort());
  expect(claims.filter((row) => row === null)).toHaveLength(1);
  await db.update(analyses).set({ status: "cancelled" }).where(inArray(analyses.id, ids));
});

test("cancelling a queued analysis ends it before it starts, for every listener", async () => {
  const m = await member();
  const id = await queued(m.id);
  const got: LiveEvent[] = [];
  const stop = await subscribe(id, (event) => got.push(event));
  expect(await cancel(id)).toBe(true);
  await until(async () => got.find((event) => event.type === "end"));
  stop();
  expect(got.at(-1)).toMatchObject({ type: "end", status: "cancelled", error: "Dibatalkan sebelum mulai." });
  expect(await cancel(id)).toBe(false);
});

test("cancelling a running analysis kills its worker, wherever it runs", async () => {
  const m = await member();
  const id = await queued(m.id);
  let killed = false;
  useJobs(fake([{ type: "started", ticker: "BTC-USD", assetType: "crypto" }], true, () => (killed = true)));
  await startRunner(1);
  await until(async () => (await rowOf(id)).status === "running");
  const got: LiveEvent[] = [];
  const stop = await subscribe(id, (event) => got.push(event));
  expect(await cancel(id)).toBe(true);
  await until(async () => killed && got.find((event) => event.type === "end"));
  stop();
  expect(await rowOf(id)).toMatchObject({ status: "cancelled", error: "Dibatalkan oleh pengguna." });
  await stopRunner();
});

test("the sweep fails a running analysis whose runner stopped heartbeating", async () => {
  const m = await member();
  const id = await queued(m.id);
  await db.update(analyses).set({ status: "running", heartbeatAt: new Date(Date.now() - 10 * 60_000) }).where(eq(analyses.id, id));
  const got: LiveEvent[] = [];
  const stop = await subscribe(id, (event) => got.push(event));
  await failOrphans();
  await until(async () => got.find((event) => event.type === "end"));
  stop();
  expect(await rowOf(id)).toMatchObject({ status: "failed", error: "Server yang menjalankan analisa ini berhenti." });
});

test("a runner that shuts down fails its runs with the reason", async () => {
  const m = await member();
  const id = await queued(m.id);
  useJobs(fake([{ type: "started", ticker: "BTC-USD", assetType: "crypto" }], true));
  await startRunner(1);
  await until(async () => (await rowOf(id)).status === "running");
  await stopRunner();
  expect(await rowOf(id)).toMatchObject({ status: "failed", error: "Worker berhenti karena restart atau deploy. Jalankan lagi analisanya." });
});
