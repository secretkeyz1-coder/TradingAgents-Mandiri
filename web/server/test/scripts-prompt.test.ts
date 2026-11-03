// The AI script writer in the editor (server/src/scripts.ts): Pine Script translated with a report, or a prompt made
// into a plan of rules and the kept rules into a script. Every draft is tested on bars and sent back to be repaired
// while it fails. The worker is the demo one (test/setup.ts): its plan and scripts are fixed, and with TA_DEMO_PINE=1
// its Pine translation is a first draft that reads the bar after its signal, then the repair. The bars are made up
// (useTestBars), so no model and no market data are touched. Answers stream as server-sent events.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { useTestBars } from "../src/scripts";
import { admin, call, member, sseEvents, walkBars } from "./helpers";

const model = { provider: "openai", quickModel: "m", deepModel: "m", language: "Indonesian" };
const prompt = "Cari break of structure dari swing terakhir, lalu entry saat harga kembali ke level itu dengan RR minimal 2.";
const pine = `//@version=6
indicator("EMA cross", overlay = true)
ema = ta.ema(close, input.int(10, "Periode EMA"))
plot(ema)
if ta.crossover(close, ema)
    label.new(bar_index, low, "BUY")`;

beforeAll(() => {
  process.env.TA_DEMO_PINE = "1";
  useTestBars(async (symbol, timeframe) => ({ bars: walkBars(1200), context: { timeframe, tz: "UTC" }, where: `${symbol} uji` }));
});
afterAll(() => {
  delete process.env.TA_DEMO_PINE;
  useTestBars();
});

describe("AI script writer", () => {
  test("a prompt too short to plan from is refused, saying why", async () => {
    const m = await member({ verified: true });
    const r = await call("/api/scripts/plan", { cookie: m.cookie, body: { ...model, prompt: "terlalu pendek" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("minimal 20 huruf");
  });

  test("the plan streams, then lists rules to keep, what was changed and what no script can do", async () => {
    const m = await member({ verified: true });
    const r = await call("/api/scripts/plan", { cookie: m.cookie, body: { ...model, prompt } });
    expect(r.status).toBe(200);
    const events = sseEvents(r.body);
    expect(events[0].event).toBe("step");
    const plan = events.find((e) => e.event === "plan")!.data.plan;
    expect(plan.rules.length).toBeGreaterThan(0);
    expect(typeof plan.rules[0].text).toBe("string");
    expect(Array.isArray(plan.adapted)).toBe(true);
    expect(plan.dropped[0]).toHaveProperty("why");
    expect(events.at(-1)!.event).toBe("end");
  }, 30_000);

  test("a script needs at least one rule kept", async () => {
    const m = await member({ verified: true });
    const r = await call("/api/scripts/compose", { cookie: m.cookie, body: { ...model, prompt, rules: [] } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("minimal satu aturan");
  });

  test("the rules kept come back as a script that signals, tested on the chart's bars", async () => {
    const m = await member({ verified: true });
    const rules = ["Swing high dan swing low yang sudah terkonfirmasi", "SL di balik swing berlawanan, TP pada risk-reward minimum"];
    const r = await call("/api/scripts/compose", { cookie: m.cookie, body: { ...model, prompt, rules, symbol: "GC=F", timeframe: "15m" } });
    expect(r.status).toBe(200);
    const result = sseEvents(r.body).find((e) => e.event === "result")!.data;
    expect(result.code).toContain("signal(");
    expect(result.check.where).toBe("GC=F uji");
    expect(result.check.bars).toBe(1200);
  }, 30_000);

  test("a Pine translation that reads the next bar is caught, repaired and reported", async () => {
    const m = await member({ verified: true });
    const r = await call("/api/scripts/translate", { cookie: m.cookie, body: { ...model, pine } });
    expect(r.status).toBe(200);
    const events = sseEvents(r.body);
    const steps = events.filter((e) => e.event === "step").map((e) => e.data.text as string);
    expect(steps[0]).toContain("Menerjemahkan");
    expect(steps.some((s) => s.startsWith("Memperbaiki (1 dari 2)") && s.includes("candle sesudahnya"))).toBe(true);
    const result = events.find((e) => e.event === "result")!.data;
    expect(result.repairs).toBe(1);
    expect(result.check.problems).toEqual([]);
    expect(result.code).toContain("close[i - 1]");
    expect(result.report.kept.length).toBeGreaterThan(0);
    expect(result.report.dropped[0]).toHaveProperty("why");
    // Tested on Bitcoin hourly when the editor names no chart.
    expect(result.check.where).toBe("BTC-USD uji");
  }, 60_000);

  test("each step takes one chat turn from the day, and a member out of turns is refused", async () => {
    const m = await member({ verified: true });
    const limited = await call(`/api/users/${m.id}`, { method: "PATCH", cookie: await admin(), body: { dailyChatLimit: 1 } });
    expect(limited.status).toBe(200);
    expect((await call("/api/usage", { cookie: m.cookie })).body.chat).toMatchObject({ used: 0, limit: 1 });
    const planned = await call("/api/scripts/plan", { cookie: m.cookie, body: { ...model, prompt } });
    expect(sseEvents(planned.body).some((e) => e.event === "plan")).toBe(true);
    expect((await call("/api/usage", { cookie: m.cookie })).body.chat.used).toBe(1);
    const refused = await call("/api/scripts/translate", { cookie: m.cookie, body: { ...model, pine } });
    expect(refused.status).toBe(429);
    expect(refused.body.error).toContain("pesan Tanya AI");
  }, 30_000);

  test("every step needs a session", async () => {
    expect((await call("/api/scripts/plan", { body: { ...model, prompt } })).status).toBe(401);
    expect((await call("/api/scripts/compose", { body: { ...model, prompt, rules: ["x"] } })).status).toBe(401);
    expect((await call("/api/scripts/translate", { body: { ...model, pine } })).status).toBe(401);
  });
});
