// Members run on the server's provider and models whatever they send, and never see
// key names or backend URLs (models.ts); their analyses and backtests also run the
// standard analysis (shared/analysis.ts). Admins keep their choice. The admin console's
// read-only settings are for admins only and carry no secret (business.ts).
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { analyses } from "../src/db/schema";
import { admin, call, member } from "./helpers";

type Provider = { key: string; apiKeyEnv: string | null; defaultUrl: string | null };
const today = () => new Date().toLocaleDateString("en-CA");

// The first catalog read starts Python (web/worker), so it can take a while.
test("an admin's options carry key names; a member's carry no key names or default URLs", async () => {
  const mine = await call("/api/options", { cookie: await admin() });
  expect(mine.status).toBe(200);
  expect(mine.body.providers.some((p: Provider) => p.apiKeyEnv)).toBe(true);
  const m = await member({ verified: true });
  const theirs = await call("/api/options", { cookie: m.cookie });
  expect(theirs.body.providers.every((p: Provider) => p.apiKeyEnv === null && p.defaultUrl === null)).toBe(true);
  expect(theirs.body.defaults.backendUrl).toBeNull();
}, 90_000);

test("a member's analysis runs on the server's provider and models, not the ones it sent", async () => {
  const options = (await call("/api/options", { cookie: await admin() })).body;
  const d = options.defaults;
  const other = options.providers.find((p: Provider) => p.key !== d.provider) ?? options.providers[0];
  const m = await member({ verified: true });
  const asked = await call("/api/analyses", {
    cookie: m.cookie,
    body: { ticker: "AAPL", date: today(), analysts: ["market"], depth: 1, language: "Indonesian", provider: other.key, quickModel: "pilihan-anggota", deepModel: "pilihan-anggota", backendUrl: "https://contoh.invalid/v1" },
  });
  expect(asked.status).toBe(201);
  const [row] = await db.select({ request: analyses.request }).from(analyses).where(eq(analyses.id, asked.body.id));
  const r = row.request as unknown as Record<string, unknown>;
  expect(r.provider).toBe(d.provider);
  expect(r.quickModel).toBe(d.quickModel);
  expect(r.deepModel).toBe(d.deepModel);
  expect(r.backendUrl ?? null).toBe(d.backendUrl ?? null);
});

test("an admin keeps the models it chose", async () => {
  const d = (await call("/api/options", { cookie: await admin() })).body.defaults;
  const asked = await call("/api/analyses", {
    cookie: await admin(),
    body: { ticker: "AAPL", date: today(), analysts: ["market"], depth: 1, language: "Indonesian", provider: d.provider, quickModel: "pilihan-admin", deepModel: "pilihan-admin", backendUrl: d.backendUrl ?? "" },
  });
  expect(asked.status).toBe(201);
  const [row] = await db.select({ request: analyses.request }).from(analyses).where(eq(analyses.id, asked.body.id));
  expect((row.request as unknown as Record<string, unknown>).quickModel).toBe("pilihan-admin");
});

test("a member's analyses and backtests run the standard analysis; an admin's run as sent", async () => {
  const d = (await call("/api/options", { cookie: await admin() })).body.defaults;
  const m = await member({ plan: "pro", verified: true });
  const sent = { analysts: ["news"], depth: 5, language: "English", provider: d.provider, quickModel: d.quickModel, deepModel: d.deepModel };
  const stored = async (id: string) =>
    (await db.select({ request: analyses.request }).from(analyses).where(eq(analyses.id, id)))[0].request as unknown as Record<string, unknown>;

  // A crypto pair has no company behind it, so no fundamentals; a stock has.
  const crypto = await call("/api/analyses", { cookie: m.cookie, body: { ticker: "BTC-USD", date: today(), ...sent } });
  expect(crypto.status).toBe(201);
  expect(await stored(crypto.body.id)).toMatchObject({ analysts: ["market", "social", "news"], depth: 1, language: "Indonesian" });
  const stock = await call("/api/analyses", { cookie: m.cookie, body: { ticker: "BBCA.JK", date: today(), ...sent } });
  expect(stock.status).toBe(201);
  expect(await stored(stock.body.id)).toMatchObject({ analysts: ["market", "social", "news", "fundamentals"], depth: 1, language: "Indonesian" });
  const backtest = await call("/api/backtests", { cookie: m.cookie, body: { tickers: ["BTC-USD", "BBCA.JK"], start: today(), end: today(), everyNDays: 14, ...sent } });
  expect(backtest.status).toBe(201);
  expect(await stored(backtest.body.id)).toMatchObject({ analysts: ["market", "social", "news", "fundamentals"], depth: 1, language: "Indonesian" });

  const own = await call("/api/analyses", { cookie: await admin(), body: { ticker: "BTC-USD", date: today(), ...sent } });
  expect(own.status).toBe(201);
  expect(await stored(own.body.id)).toMatchObject({ analysts: ["news"], depth: 5, language: "English" });
});

test("a member's Telegram error names no server setting", async () => {
  const m = await member({ verified: true });
  const r = await call("/api/watchlist/test", { method: "POST", cookie: m.cookie });
  expect(r.status).toBe(400);
  expect(JSON.stringify(r.body)).not.toContain("TELEGRAM_BOT_TOKEN");
  expect(JSON.stringify(r.body)).not.toContain(".env");
});

test("the server settings page is for admins only and shows no secret value", async () => {
  const r = await call("/api/admin/config", { cookie: await admin() });
  expect(r.status).toBe(200);
  for (const key of ["signup", "telegram", "mail", "models", "metrics"]) expect(r.body).toHaveProperty(key);
  expect(r.body.opsAlerts).toEqual({ chat: false, admins: expect.any(Number) });
  const text = JSON.stringify(r.body);
  expect(text).not.toContain(process.env.SESSION_SECRET!);
  expect(text).not.toContain(process.env.APP_PASSWORD!);
  const m = await member();
  const refused = await call("/api/admin/config", { cookie: m.cookie });
  expect(refused.status).toBe(403);
  expect(refused.body.error).toBe("Khusus admin");
});
