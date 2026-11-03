// "Dari prompt" in the script editor (server/src/scripts.ts): a prompt becomes a plan of rules, and the rules the user
// keeps become a script. The worker is the demo one (test/setup.ts), which answers both steps with fixed examples, so no
// model runs: these check what each step takes and the shape of what it gives back.
import { describe, expect, test } from "bun:test";
import { call, member } from "./helpers";

const model = { provider: "openai", quickModel: "m", deepModel: "m", language: "Indonesian" };
const prompt = "Cari break of structure dari swing terakhir, lalu entry saat harga kembali ke level itu dengan RR minimal 2.";

describe("indicator script from a prompt", () => {
  test("a prompt too short to plan from is refused, saying why", async () => {
    const m = await member({ verified: true });
    const r = await call("/api/scripts/plan", { cookie: m.cookie, body: { ...model, prompt: "terlalu pendek" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("minimal 20 huruf");
  });

  test("the plan lists rules to keep, what was changed and what no script can do", async () => {
    const m = await member({ verified: true });
    const r = await call("/api/scripts/plan", { cookie: m.cookie, body: { ...model, prompt } });
    expect(r.status).toBe(200);
    expect(r.body.plan.rules.length).toBeGreaterThan(0);
    expect(typeof r.body.plan.rules[0].text).toBe("string");
    expect(Array.isArray(r.body.plan.adapted)).toBe(true);
    expect(r.body.plan.dropped[0]).toHaveProperty("why");
  });

  test("a script needs at least one rule kept", async () => {
    const m = await member({ verified: true });
    const r = await call("/api/scripts/compose", { cookie: m.cookie, body: { ...model, prompt, rules: [] } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("minimal satu aturan");
  });

  test("the rules kept come back as a script that signals", async () => {
    const m = await member({ verified: true });
    const rules = ["Swing high dan swing low yang sudah terkonfirmasi", "SL di balik swing berlawanan, TP pada risk-reward minimum"];
    const r = await call("/api/scripts/compose", { cookie: m.cookie, body: { ...model, prompt, rules } });
    expect(r.status).toBe(200);
    expect(r.body.code).toContain("signal(");
  });

  test("both steps need a session", async () => {
    expect((await call("/api/scripts/plan", { body: { ...model, prompt } })).status).toBe(401);
    expect((await call("/api/scripts/compose", { body: { ...model, prompt, rules: ["x"] } })).status).toBe(401);
  });
});
