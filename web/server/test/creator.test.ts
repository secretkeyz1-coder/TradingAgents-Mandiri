// The public status page (status.ts) and a Creator's public track record
// (creators.ts): who may turn the page on, which alerts may go public, each signal
// recorded once with its cost frozen, scored once, and kept after its alert is
// deleted. Alerts are inserted directly: creating one through the API starts a
// priming scan in Python, which is not what these tests are about.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { recordCreatorSignal, scoreCreatorSignal } from "../src/creators";
import { db } from "../src/db";
import { creatorSignals, signalAlerts, signalEvents } from "../src/db/schema";
import { tradeCost } from "../src/ledger";
import { admin, call, member } from "./helpers";

const near = (a: unknown, b: number) => typeof a === "number" && Math.abs(a - b) < 1e-9;

test("the status page reports every part, with the database up", async () => {
  const r = await call("/api/public/status");
  expect(r.status).toBe(200);
  const parts: { key: string; state: string }[] = r.body.parts;
  for (const key of ["database", "crypto", "markets", "engine", "scanner", "brief", "telegram", "mail"]) expect(parts.map((p) => p.key)).toContain(key);
  expect(parts.find((p) => p.key === "database")?.state).toBe("ok");
  expect(["ok", "degraded", "down"]).toContain(r.body.overall);
}, 30_000);

describe("Creator track record", () => {
  let creator: Awaited<ReturnType<typeof member>>;
  let pro: Awaited<ReturnType<typeof member>>;
  let alertId = "";
  let proAlert = "";
  let openEventId = "";
  const alertRow = (userId: string) =>
    db
      .insert(signalAlerts)
      .values({ userId, symbol: "BTC-USD", tvSymbol: "BINANCE:BTCUSDT", indicator: "pob", timeframe: "15m", primed: true })
      .returning({ id: signalAlerts.id })
      .then(([row]) => row.id);

  test("only a Creator may turn the page on; a Pro account may still set its name", async () => {
    creator = await member({ plan: "creator", verified: true });
    pro = await member({ plan: "pro", verified: true });
    expect((await call("/api/me/profile", { method: "PATCH", cookie: pro.cookie, body: { publicProfile: true } })).status).toBe(403);
    const named = await call("/api/me/profile", { method: "PATCH", cookie: pro.cookie, body: { displayName: "Uji Pro" } });
    expect(named.status).toBe(200);
    expect(named.body.displayName).toBe("Uji Pro");
    expect(named.body.publicProfile).toBe(false);
    expect((await call(`/api/public/creators/${pro.username}`)).status).toBe(404);
    expect((await call(`/api/public/creators/${creator.username}`)).status).toBe(404);
  });

  test("a Creator turns the page on with a trimmed name and a bio; a bio over 400 characters is refused", async () => {
    const r = await call("/api/me/profile", {
      method: "PATCH",
      cookie: creator.cookie,
      body: { publicProfile: true, displayName: "  Uji Creator  ", bio: "Swing BTC harian.\nRisiko 1% per trade." },
    });
    expect(r.status).toBe(200);
    expect(r.body.publicProfile).toBe(true);
    expect(r.body.displayName).toBe("Uji Creator");
    expect((await call("/api/me/profile", { method: "PATCH", cookie: creator.cookie, body: { bio: "x".repeat(401) } })).status).toBe(400);
  });

  test("only a Creator publishes an alert, and only their own", async () => {
    alertId = await alertRow(creator.id);
    proAlert = await alertRow(pro.id);
    expect((await call(`/api/alerts/${proAlert}/public`, { method: "PATCH", cookie: pro.cookie, body: { public: true } })).status).toBe(403);
    expect((await call(`/api/alerts/${proAlert}/public`, { method: "PATCH", cookie: creator.cookie, body: { public: true } })).status).toBe(404);
    const r = await call(`/api/alerts/${alertId}/public`, { method: "PATCH", cookie: creator.cookie, body: { public: true } });
    expect(r.status).toBe(200);
    expect(r.body.public).toBe(true);
    const list = await call("/api/alerts", { cookie: creator.cookie });
    expect(list.body.items.find((a: { id: string }) => a.id === alertId)?.public).toBe(true);
  });

  test("each signal goes on the record once, its cost frozen in R when it fires", async () => {
    const [alert] = await db.select().from(signalAlerts).where(eq(signalAlerts.id, alertId));
    // Bar times no real signal has.
    const event = async (signalTime: string, side: "BUY" | "SELL", stopLoss: number, takeProfit: number) =>
      (await db.insert(signalEvents).values({ alertId, signalTime, side, label: `${side} uji`, entry: 100_000, stopLoss, takeProfit, status: "open", exitTime: null }).returning())[0];
    const e1 = await event("2099-01-01 00:00", "BUY", 99_000, 102_000);
    const e2 = await event("2099-01-01 00:15", "SELL", 101_000, 98_000);
    const e3 = await event("2099-01-01 00:30", "BUY", 99_000, 102_000);
    openEventId = e3.id;
    await recordCreatorSignal(alert, e1, { outcome: "win", exit_time: "2099-01-01 01:00", r: 2 }, "PoB BYSTRA");
    await recordCreatorSignal(alert, e2, { outcome: "loss", exit_time: "2099-01-01 01:00", r: -1 }, "PoB BYSTRA");
    await recordCreatorSignal(alert, e3, { outcome: "open", exit_time: null }, "PoB BYSTRA");
    await recordCreatorSignal(alert, e3, { outcome: "open", exit_time: null }, "PoB BYSTRA");
    const rows = await db.select().from(creatorSignals).where(eq(creatorSignals.userId, creator.id));
    const cost = tradeCost("BTC-USD", 100_000, false, "") / 1000;
    expect(rows).toHaveLength(3);
    expect(cost).toBeGreaterThan(0);
    expect(rows.every((x) => near(x.costR, cost))).toBe(true);

    const page = await call(`/api/public/creators/${creator.username.toUpperCase()}`);
    const [win, loss] = [2 - cost, -1 - cost];
    expect(page.status).toBe(200);
    expect(page.body.name).toBe("Uji Creator");
    expect(page.body.bio.startsWith("Swing")).toBe(true);
    expect(page.body.record.closed).toBe(2);
    expect(page.body.record.open).toBe(1);
    expect(page.body.record.winRate).toBe(0.5);
    expect(near(page.body.record.avgR, (win + loss) / 2)).toBe(true);
    expect(near(page.body.record.totalR, win + loss)).toBe(true);
    expect(page.body.strategies).toHaveLength(1);
    expect(page.body.strategies[0].strategy).toBe("PoB BYSTRA");
    expect(page.body.signals[0].status).toBe("open");
    expect(page.body.signals[0].netR).toBeNull();
    expect(JSON.stringify(page.body).includes("@example.test")).toBe(false);
    expect("id" in page.body || "email" in page.body).toBe(false);
  });

  test("an alert with an open public signal cannot be deleted; a signal is scored once", async () => {
    expect((await call(`/api/alerts/${alertId}`, { method: "DELETE", cookie: creator.cookie })).status).toBe(409);
    await scoreCreatorSignal(openEventId, { outcome: "win", exit_time: "2099-01-01 02:00", r: 2 });
    await scoreCreatorSignal(openEventId, { outcome: "loss", exit_time: "2099-01-01 03:00", r: -1 });
    const [scored] = await db.select().from(creatorSignals).where(eq(creatorSignals.eventId, openEventId));
    expect(scored.status).toBe("win");
    expect(scored.grossR).toBe(2);
    expect(scored.closedAt).not.toBeNull();
  });

  test("the alert goes private and can be deleted; the record keeps its signals", async () => {
    const r = await call(`/api/alerts/${alertId}/public`, { method: "PATCH", cookie: creator.cookie, body: { public: false } });
    expect(r.body.public).toBe(false);
    expect((await call(`/api/alerts/${alertId}`, { method: "DELETE", cookie: creator.cookie })).status).toBe(200);
    const page = await call(`/api/public/creators/${creator.username}`);
    expect(page.status).toBe(200);
    expect(page.body.record.closed).toBe(3);
    expect(page.body.signals).toHaveLength(3);
    expect(near(page.body.record.winRate, 2 / 3)).toBe(true);
  });

  test("the page goes down once the plan is no longer Creator, and can still be switched off", async () => {
    await call(`/api/users/${creator.id}`, { method: "PATCH", cookie: await admin(), body: { plan: "free" } });
    // The page is cached for a minute; a change to the owner's settings drops it.
    await call("/api/me/profile", { method: "PATCH", cookie: creator.cookie, body: { bio: "Swing BTC harian." } });
    expect((await call(`/api/public/creators/${creator.username}`)).status).toBe(404);
    const off = await call("/api/me/profile", { method: "PATCH", cookie: creator.cookie, body: { publicProfile: false } });
    expect(off.status).toBe(200);
    expect(off.body.publicProfile).toBe(false);
    expect((await call("/api/public/creators/A!")).status).toBe(404);
  });
});
