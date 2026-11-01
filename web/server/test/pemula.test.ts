// The Pemula screen's server side: new accounts start in Pemula through the `ui`
// preference (auth.ts), and /api/verdict answers from the user's latest finished
// analysis, else the daily brief, else null (routes.ts, site.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { analyses, marketBriefs } from "../src/db/schema";
import { forgetCache } from "../src/site";
import { admin, call, member } from "./helpers";

describe("the Pemula preference", () => {
  test("an admin-made member starts in Pemula; an admin-made admin opens Pro", async () => {
    const m = await member();
    expect(m.created.preferences.ui.mode).toBe("pemula");
    const madeAdmin = await call("/api/users", { cookie: await admin(), body: { username: `a${Date.now().toString(36)}`, password: crypto.randomUUID(), role: "admin" } });
    expect(madeAdmin.status).toBe(201);
    expect(madeAdmin.body.preferences.ui).toBeUndefined();
  });

  test("an e-mail sign-up starts in Pemula", async () => {
    const r = await call("/api/signup", { body: { email: `s${Date.now().toString(36)}@example.test`, password: crypto.randomUUID(), acceptTerms: true } });
    expect(r.status).toBe(201);
    expect(r.body.user.preferences.ui.mode).toBe("pemula");
  });

  test("the ui key is accepted, another new key is not, and null removes it", async () => {
    const m = await member();
    const toPro = await call("/api/me/preferences", { method: "PATCH", cookie: m.cookie, body: { ui: { mode: "pro" } } });
    expect(toPro.status).toBe(200);
    expect(toPro.body.preferences.ui.mode).toBe("pro");
    expect((await call("/api/me/preferences", { method: "PATCH", cookie: m.cookie, body: { theme: { dark: true } } })).status).toBe(400);
    const other = await call("/api/me/preferences", { method: "PATCH", cookie: m.cookie, body: { indicators: { scalperOn: false } } });
    expect(other.body.preferences.ui.mode).toBe("pro");
    const cleared = await call("/api/me/preferences", { method: "PATCH", cookie: m.cookie, body: { ui: null } });
    expect(cleared.body.preferences.ui).toBeUndefined();
  });
});

describe("the verdict for one ticker", () => {
  const T = "ZZUJI";
  let m: Awaited<ReturnType<typeof member>>;
  let briefId = "";
  let firstId = "";

  beforeAll(async () => {
    m = await member({ verified: true });
    const [brief] = await db
      .insert(marketBriefs)
      .values({
        model: "uji",
        content: {
          headline: "Ringkasan uji",
          summary: "Ringkasan pasar buatan untuk tes.",
          assets: [{ symbol: "Emas", bias: "naik", bull: "Permintaan aset aman naik.", bear: "Dolar menguat.", watch: "Data inflasi AS." }],
          risk: "Uji.",
        },
        data: {},
      })
      .returning({ id: marketBriefs.id });
    briefId = brief.id;
    forgetCache();
  });

  afterAll(async () => {
    await db.delete(marketBriefs).where(eq(marketBriefs.id, briefId));
    forgetCache();
  });

  test("no analysis and no brief: null; a bad ticker is refused", async () => {
    const none = await call(`/api/verdict?ticker=${T}`, { cookie: m.cookie });
    expect(none.status).toBe(200);
    expect(none.body).toBeNull();
    expect((await call(`/api/verdict?ticker=${encodeURIComponent("<x>")}`, { cookie: m.cookie })).status).toBe(400);
  });

  test("the finished analysis with the latest trade date answers, as plain text", async () => {
    const request = { ticker: T, date: "2026-10-30", analysts: ["market"], depth: 1, provider: "uji", quickModel: "uji", deepModel: "uji", language: "Indonesian" };
    const rows = await db
      .insert(analyses)
      .values([
        {
          userId: m.id,
          ticker: T,
          tradeDate: "2026-10-30",
          request,
          status: "completed",
          rating: "Overweight",
          reports: { final_trade_decision: "**Rating**: Overweight\n\n**Executive Summary**: Tren naik masih terjaga. Tambah porsi bertahap di dekat support.\n\nRincian…" },
          finishedAt: new Date(),
        },
        // An older trade date that finished later, and a newer run that failed: neither answers.
        { userId: m.id, ticker: T, tradeDate: "2026-09-01", request, status: "completed", rating: "Sell", finishedAt: new Date(Date.now() + 1000) },
        { userId: m.id, ticker: T, tradeDate: "2026-10-31", request, status: "failed" },
      ])
      .returning({ id: analyses.id });
    firstId = rows[0].id;
    const r = await call(`/api/verdict?ticker=${T}`, { cookie: m.cookie });
    expect(r.body.source).toBe("analysis");
    expect(r.body.id).toBe(firstId);
    expect(r.body.rating).toBe("Overweight");
    expect(r.body.date).toBe("2026-10-30");
    expect(r.body.summary).toBe("Tren naik masih terjaga. Tambah porsi bertahap di dekat support.");
    expect(r.body).not.toHaveProperty("reports");
    expect(r.body.hasReport).toBe(false);
  });

  test("the ticker is read in any case, and another user does not see it", async () => {
    expect((await call(`/api/verdict?ticker=${T.toLowerCase()}`, { cookie: m.cookie })).body.id).toBe(firstId);
    expect((await call(`/api/verdict?ticker=${T}`, { cookie: await admin() })).body).toBeNull();
  });

  test("without an analysis, the brief answers for an asset it covers, and only those", async () => {
    const gold = await call(`/api/verdict?ticker=${encodeURIComponent("GC=F")}`, { cookie: m.cookie });
    expect(gold.body.source).toBe("brief");
    expect(gold.body.symbol).toBe("Emas");
    expect(gold.body.bias).toBe("naik");
    expect(gold.body.bull).toBe("Permintaan aset aman naik.");
    expect((await call("/api/verdict?ticker=BTC-USD", { cookie: m.cookie })).body).toBeNull();
    expect((await call("/api/verdict?ticker=BBCA.JK", { cookie: m.cookie })).body).toBeNull();
  });
});
