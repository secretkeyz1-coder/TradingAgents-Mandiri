// The indicator catalog (indicators.ts): the plans and accounts that see each chart
// indicator, and how the chart's menu, signal notifications and the lab follow it. Telegram
// messages are caught and a script runs in the real sandbox on bars given here instead of
// candles from the network (useSignalScan). The built-ins' seed rows are shared with every
// other test file, so they go back to their defaults at the end.
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { runScript, type ScriptBar } from "../../shared/script";
import { scanAlerts, useSignalScan } from "../src/alerts";
import { db } from "../src/db";
import { signalEvents } from "../src/db/schema";
import { quickjs } from "../src/script-run";
import { admin, call, member } from "./helpers";

const sent: string[] = [];
let bars: ScriptBar[] = [];
useSignalScan(
  async () => [],
  async (_chat, html) => {
    sent.push(html);
    return { ok: true };
  },
  async (code, _symbol, _timeframe, inputs) => ({ ...runScript(await quickjs(), code, bars, { inputs }), bars }),
);

/** Flat 15m bars at 100, then a close for each of `jumps`, one bar each; the newest bar is still forming, so it fires nothing. */
function series(jumps: number[]): ScriptBar[] {
  const closes = [...Array(60).fill(100), ...jumps];
  return closes.map((close, i) => {
    const t = new Date(Date.UTC(2026, 9, 1, 0, 0) + i * 15 * 60_000).toISOString();
    return { time: `${t.slice(0, 10)} ${t.slice(11, 16)}`, open: close, high: close, low: close, close, volume: 1 };
  });
}
/** A BUY whenever a bar closes 10% above the one before. */
const JUMP = `for (let i = 1; i < n; i++) if (close[i] > close[i - 1] * 1.1) signal(i, "BUY", { sl: close[i] * 0.95, tp: close[i] * 1.2, label: "Lompat" });`;

const keys = (r: { body: { items: { key: string }[] } }) => r.body.items.map((i) => i.key);
const builtin = async (key: string) => (await call("/api/admin/indicators", { cookie: await admin() })).body.find((r: { key: string }) => r.key === key);
const patch = async (id: string, body: unknown) => call(`/api/admin/indicators/${id}`, { method: "PATCH", cookie: await admin(), body });

afterAll(async () => {
  useSignalScan();
  for (const key of ["scalper", "pob", "fib"]) {
    const row = await builtin(key);
    await patch(row.id, { plans: ["free", "pro", "creator"], active: true, defaultOn: false });
    await call(`/api/admin/indicators/${row.id}/grants`, { method: "PUT", cookie: await admin(), body: { userIds: [] } });
  }
});

describe("built-in engines", () => {
  test("every plan sees all three until the admin narrows one", async () => {
    const free = await member();
    const r = await call("/api/indicators", { cookie: free.cookie });
    expect(r.status).toBe(200);
    expect(keys(r)).toEqual(["scalper", "pob", "fib"]);
    expect(r.body.items.map((i: { name: string }) => i.name)).toEqual(["Scalper Pro+", "PoB BYSTRA", "Fib GZ"]);
    expect(r.body.items.every((i: { code: string | null; defaultOn: boolean }) => i.code === null && !i.defaultOn)).toBe(true);
  });

  test("one kept for Pro leaves Gratis's menu, notifications and lab", async () => {
    const pob = await builtin("pob");
    expect((await patch(pob.id, { plans: ["pro", "creator", "pro"] })).body.plans).toEqual(["pro", "creator"]);
    const free = await member();
    const pro = await member({ plan: "pro" });

    expect(keys(await call("/api/indicators", { cookie: free.cookie }))).toEqual(["scalper", "fib"]);
    expect(keys(await call("/api/indicators", { cookie: pro.cookie }))).toEqual(["scalper", "pob", "fib"]);

    const alerts = await call("/api/alerts", { cookie: free.cookie });
    expect(alerts.body.combos.some((x: { indicator: string }) => x.indicator === "pob")).toBe(false);
    const add = (cookie: string) => call("/api/alerts", { cookie, body: { symbol: "ADA-USD", tvSymbol: "BINANCE:ADAUSDT", indicator: "pob", timeframe: "15m" } });
    const refused = await add(free.cookie);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("Indikator ini tidak tersedia di paketmu");
    expect((await add(pro.cookie)).status).toBe(201);

    expect(Object.keys((await call("/api/lab", { cookie: free.cookie })).body.engines)).toEqual(["scalper", "fib"]);
    const run = await call("/api/lab/run", {
      cookie: free.cookie,
      body: { strategy: { kind: "engine", name: "pob" }, symbols: ["ADA-USD"], timeframe: "15m", days: 30 },
    });
    expect(run.status).toBe(403);
  });

  test("a grant opens one to a single account whatever its plan; the admin always sees it", async () => {
    const pob = await builtin("pob");
    await patch(pob.id, { plans: [] });
    const chosen = await member();
    const other = await member({ plan: "creator" });
    const granted = await call(`/api/admin/indicators/${pob.id}/grants`, {
      method: "PUT",
      cookie: await admin(),
      body: { userIds: [chosen.id, chosen.id, crypto.randomUUID()] },
    });
    expect(granted.status).toBe(200);
    expect(granted.body.grants).toEqual([{ id: chosen.id, username: chosen.username, email: chosen.email }]);
    expect((await builtin("pob")).grants.map((g: { id: string }) => g.id)).toEqual([chosen.id]);

    expect(keys(await call("/api/indicators", { cookie: chosen.cookie }))).toContain("pob");
    expect(keys(await call("/api/indicators", { cookie: other.cookie }))).not.toContain("pob");
    expect(keys(await call("/api/indicators", { cookie: await admin() }))).toContain("pob");
    // Kept to named accounts, it is not on offer on the pricing page.
    expect((await call("/api/public/indicators")).body.map((i: { name: string }) => i.name)).not.toContain("PoB BYSTRA");
  });

  test("switched off, it is hidden from members; it cannot be deleted, renamed or rewritten", async () => {
    const fib = await builtin("fib");
    const pro = await member({ plan: "pro" });
    await patch(fib.id, { active: false });
    expect(keys(await call("/api/indicators", { cookie: pro.cookie }))).not.toContain("fib");
    expect(keys(await call("/api/indicators", { cookie: await admin() }))).toContain("fib");
    expect((await call("/api/public/indicators")).body.map((i: { name: string }) => i.name)).not.toContain("Fib GZ");

    expect((await call(`/api/admin/indicators/${fib.id}`, { method: "DELETE", cookie: await admin() })).status).toBe(400);
    expect((await patch(fib.id, { code: JUMP })).status).toBe(400);
    expect((await patch(fib.id, { name: "Fibo" })).status).toBe(400);
    // Its description is the admin's to word; the same name sent back is no change.
    const kept = await patch(fib.id, { name: "Fib GZ", description: "Area pullback Fibonacci.", active: true });
    expect(kept.status).toBe(200);
    expect(kept.body.description).toBe("Area pullback Fibonacci.");
  });

  test("the defaults the chart starts with are the admin's", async () => {
    const scalper = await builtin("scalper");
    await patch(scalper.id, { defaultOn: true });
    const free = await member();
    const items = (await call("/api/indicators", { cookie: free.cookie })).body.items as { key: string; defaultOn: boolean }[];
    expect(items.find((i) => i.key === "scalper")?.defaultOn).toBe(true);
    expect(items.find((i) => i.key === "fib")?.defaultOn).toBe(false);
  });
});

describe("a published script", () => {
  test("members on its plans draw it, watch it and test it; it pauses when the admin closes it, and goes with its alerts", async () => {
    const created = await call("/api/admin/indicators", {
      cookie: await admin(),
      body: { name: "Lompat Harga", description: "Beli saat harga melompat 10%.", code: JUMP, plans: ["creator", "pro"], defaultOn: true },
    });
    expect(created.status).toBe(201);
    expect(created.body.plans).toEqual(["pro", "creator"]);
    const key = created.body.key as `catalog:${string}`;
    expect(key).toBe(`catalog:${created.body.id}`);

    const free = await member();
    const pro = await member({ plan: "pro" });
    const mine = (await call("/api/indicators", { cookie: pro.cookie })).body.items.find((i: { key: string }) => i.key === key);
    expect(mine).toMatchObject({ name: "Lompat Harga", code: JUMP, defaultOn: true, builtin: null });
    expect(keys(await call("/api/indicators", { cookie: free.cookie }))).not.toContain(key);
    // The pricing page names it and its plans, never its code.
    const listed = (await call("/api/public/indicators")).body.find((i: { name: string }) => i.name === "Lompat Harga");
    expect(listed).toEqual({ name: "Lompat Harga", description: "Beli saat harga melompat 10%.", plans: ["pro", "creator"] });

    expect((await call("/api/lab", { cookie: pro.cookie })).body.catalog).toContainEqual({ id: created.body.id, name: "Lompat Harga" });
    expect((await call("/api/lab", { cookie: free.cookie })).body.catalog).toEqual([]);
    const lab = await call("/api/lab/run", {
      cookie: free.cookie,
      body: { strategy: { kind: "catalog", id: created.body.id }, symbols: ["ADA-USD"], timeframe: "15m", days: 30 },
    });
    expect(lab.status).toBe(403);

    const add = (cookie: string) => call("/api/alerts", { cookie, body: { symbol: "XRP-USD", tvSymbol: "BINANCE:XRPUSDT", indicator: key, timeframe: "1h" } });
    expect((await add(free.cookie)).status).toBe(403);
    bars = series([]);
    const added = await add(pro.cookie);
    expect(added.status).toBe(201);
    const list = await call("/api/alerts", { cookie: pro.cookie });
    expect(list.body.items.find((a: { id: string }) => a.id === added.body.id)).toMatchObject({ name: "Lompat Harga", available: true });
    expect(list.body.combos).toContainEqual({ indicator: key, timeframe: "4h", label: "Lompat Harga 4j" });

    // The first scan records what is there; a jump after it goes out under the indicator's own name.
    await scanAlerts([added.body.id]);
    bars = series([115, 115]);
    await scanAlerts([added.body.id]);
    const message = sent.find((m) => m.includes("XRPUSDT"));
    expect(message).toContain("Lompat Harga · BINANCE:XRPUSDT · 1j");
    expect(message).not.toContain("Skrip");

    // Kept for Creator now: the Pro member's alert waits, marked, and sends nothing.
    await patch(created.body.id, { plans: ["creator"] });
    expect((await call("/api/alerts", { cookie: pro.cookie })).body.items.find((a: { id: string }) => a.id === added.body.id).available).toBe(false);
    const before = sent.length;
    bars = series([115, 130, 130]);
    await scanAlerts([added.body.id]);
    expect(sent.length).toBe(before);

    const history = await call("/api/alerts/history", { cookie: pro.cookie });
    expect(history.body.scriptNames[key]).toBe("Lompat Harga");
    // Another member's history names only what it shows.
    expect((await call("/api/alerts/history", { cookie: free.cookie })).body.scriptNames[key]).toBeUndefined();

    const removed = await call(`/api/admin/indicators/${created.body.id}`, { method: "DELETE", cookie: await admin() });
    expect(removed.body).toEqual({ ok: true, alerts: 1 });
    expect((await call("/api/alerts", { cookie: pro.cookie })).body.items.some((a: { id: string }) => a.id === added.body.id)).toBe(false);
    // Its calls stay in the member's history, without the name of an indicator that is gone.
    const calls = await db.select().from(signalEvents).where(eq(signalEvents.indicator, key));
    expect(calls.length).toBe(1);
    expect(calls[0].userId).toBe(pro.id);
    const after = await call("/api/alerts/history", { cookie: pro.cookie });
    expect(after.body.calls.some((c: { indicator: string }) => c.indicator === key)).toBe(true);
    expect(after.body.scriptNames[key]).toBeUndefined();
  });

  test("its code, name and plans are checked", async () => {
    const empty = await call("/api/admin/indicators", { cookie: await admin(), body: { name: "Kosong", code: "   " } });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toContain("Isi kode skripnya");
    const plans = await call("/api/admin/indicators", { cookie: await admin(), body: { name: "Rencana", code: JUMP, plans: ["gold"] } });
    expect(plans.status).toBe(400);
    const made = await call("/api/admin/indicators", { cookie: await admin(), body: { name: "Semua paket", code: JUMP } });
    expect(made.body).toMatchObject({ plans: ["free", "pro", "creator"], defaultOn: false, active: true, description: "" });
    await call(`/api/admin/indicators/${made.body.id}`, { method: "DELETE", cookie: await admin() });
  });
});

test("only the admin manages the catalog", async () => {
  const pro = await member({ plan: "pro" });
  expect((await call("/api/admin/indicators", { cookie: pro.cookie })).status).toBe(403);
  expect((await call("/api/admin/indicators", { cookie: pro.cookie, body: { name: "Punyaku", code: JUMP } })).status).toBe(403);
  const pob = await builtin("pob");
  expect((await call(`/api/admin/indicators/${pob.id}/grants`, { method: "PUT", cookie: pro.cookie, body: { userIds: [pro.id] } })).status).toBe(403);
  expect((await call("/api/indicators")).status).toBe(401);
  expect((await call("/api/public/indicators")).status).toBe(200);
});
