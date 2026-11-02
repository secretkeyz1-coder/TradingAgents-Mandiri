// The indicators an analysis or an Uji saran AI reads (readings.ts, ADR 0017): a request names
// them by key and timeframe; the server checks each against what the account may use, stores it
// as the worker needs it (a built-in with the account's own Scalper inputs, a script's source as it
// is now) and never answers with that source or those inputs. Only the Market Analyst reads them.
// The rows stay queued: no runner works in the tests.
import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { analyses } from "../src/db/schema";
import { admin, call, member } from "./helpers";

type Stored = { analysts: string[]; indicators?: Record<string, unknown>[] };
const today = () => new Date().toLocaleDateString("en-CA");
const stored = async (id: string) => (await db.select({ request: analyses.request }).from(analyses).where(eq(analyses.id, id)))[0].request as unknown as Stored;
const published: string[] = [];

afterAll(async () => {
  for (const id of published) await call(`/api/admin/indicators/${id}`, { method: "DELETE", cookie: await admin() });
});

/** A request body on the server's own models, which a member runs on whatever it sends. */
async function body(extra: Record<string, unknown>) {
  const d = (await call("/api/options", { cookie: await admin() })).body.defaults;
  return { analysts: ["market"], depth: 1, language: "Indonesian", provider: d.provider, quickModel: d.quickModel, deepModel: d.deepModel, ...extra };
}

// The first catalog read starts Python (web/worker), so it can take a while.
test("an analysis stores what it reads as the worker needs it, and answers without the source", async () => {
  const m = await member({ plan: "pro", verified: true });
  await call("/api/me/preferences", { method: "PATCH", cookie: m.cookie, body: { indicators: { scalper: { sensitivity: 2 } } } });
  const script = await call("/api/scripts", { cookie: m.cookie, body: { name: "Lompat", code: "plot(close)" } });
  expect(script.status).toBe(201);
  const picks = [
    { key: "scalper", timeframe: "15m" },
    { key: "pob", timeframe: "1d" },
    { key: `script:${script.body.id}`, timeframe: "1d" },
  ];
  const made = await call("/api/analyses", { cookie: m.cookie, body: await body({ ticker: "BTC-USD", date: today(), indicators: picks }) });
  expect(made.status).toBe(201);
  expect((await stored(made.body.id)).indicators).toEqual([
    { key: "scalper", name: "Scalper Pro+", timeframe: "15m", engine: "scalper", settings: { sensitivity: 2 } },
    // PoB has no daily setups: its daily reading is hourly (shared/readings.ts).
    { key: "pob", name: "PoB BYSTRA", timeframe: "1h", engine: "pob" },
    { key: `script:${script.body.id}`, name: "Lompat", timeframe: "1d", code: "plot(close)" },
  ]);

  const shown = [
    { key: "scalper", name: "Scalper Pro+", timeframe: "15m", engine: "scalper" },
    { key: "pob", name: "PoB BYSTRA", timeframe: "1h", engine: "pob" },
    { key: `script:${script.body.id}`, name: "Lompat", timeframe: "1d" },
  ];
  const list = await call("/api/analyses", { cookie: m.cookie });
  expect(list.body.find((r: { id: string }) => r.id === made.body.id).request.indicators).toEqual(shown);
  expect((await call(`/api/analyses/${made.body.id}`, { cookie: m.cookie })).body.request.indicators).toEqual(shown);
  const everyone = await call("/api/analyses?scope=all", { cookie: await admin() });
  expect(JSON.stringify(everyone.body.find((r: { id: string }) => r.id === made.body.id))).not.toContain("plot(close)");
}, 90_000);

test("a published indicator is read only by the plans it is open to, with its source copied in", async () => {
  const created = await call("/api/admin/indicators", { cookie: await admin(), body: { name: "Khusus Pro", code: "plot(open)", plans: ["pro"] } });
  expect(created.status).toBe(201);
  published.push(created.body.id);
  const picks = [{ key: `catalog:${created.body.id}`, timeframe: "1h" }];

  // Verifying the address starts the Pro trial; this account is back on Gratis.
  const free = await member({ verified: true });
  await call(`/api/users/${free.id}`, { method: "PATCH", cookie: await admin(), body: { plan: "free" } });
  expect((await call("/api/me", { cookie: free.cookie })).body.plan).toBe("free");
  const refused = await call("/api/analyses", { cookie: free.cookie, body: await body({ ticker: "BTC-USD", date: today(), indicators: picks }) });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toBe("Indikator itu tidak tersedia untuk akunmu.");

  const pro = await member({ plan: "pro", verified: true });
  const made = await call("/api/backtests", { cookie: pro.cookie, body: await body({ tickers: ["BTC-USD"], start: today(), end: today(), everyNDays: 7, indicators: picks }) });
  expect(made.status).toBe(201);
  expect((await stored(made.body.id)).indicators).toEqual([{ key: `catalog:${created.body.id}`, name: "Khusus Pro", timeframe: "1h", code: "plot(open)" }]);
});

test("another account's script, an unknown key or a fourth indicator is refused", async () => {
  const owner = await member({ verified: true });
  const theirs = await call("/api/scripts", { cookie: owner.cookie, body: { name: "Punya orang", code: "plot(close)" } });
  const m = await member({ verified: true });
  const ask = async (indicators: unknown) => call("/api/analyses", { cookie: m.cookie, body: await body({ ticker: "AAPL", date: today(), indicators }) });

  const other = await ask([{ key: `script:${theirs.body.id}`, timeframe: "1d" }]);
  expect(other.status).toBe(400);
  expect(other.body.error).toBe("Skrip indikatormu tidak ditemukan. Muat ulang halaman.");
  expect((await ask([{ key: "macd", timeframe: "1d" }])).status).toBe(400);
  const four = await ask(["scalper", "pob", "fib", "scalper"].map((key, i) => ({ key: i === 3 ? `script:${crypto.randomUUID()}` : key, timeframe: "1d" })));
  expect(four.status).toBe(400);
  expect(four.body.error).toContain("Maksimal 3 indikator");
  // The same one twice is read once.
  const twice = await ask([{ key: "fib", timeframe: "1d" }, { key: "fib", timeframe: "15m" }]);
  expect(twice.status).toBe(201);
  expect((await stored(twice.body.id)).indicators).toEqual([{ key: "fib", name: "Fib GZ", timeframe: "15m", engine: "fib" }]);
});

test("only the Market Analyst reads indicators: an admin's run without it is refused", async () => {
  const r = await call("/api/analyses", { cookie: await admin(), body: await body({ ticker: "AAPL", date: today(), analysts: ["news"], indicators: [{ key: "fib", timeframe: "1d" }] }) });
  expect(r.status).toBe(400);
  expect(r.body.error).toContain("Market Analyst");
  const without = await call("/api/analyses", { cookie: await admin(), body: await body({ ticker: "AAPL", date: today(), analysts: ["news"] }) });
  expect(without.status).toBe(201);
  expect((await stored(without.body.id)).indicators).toBeUndefined();
});
