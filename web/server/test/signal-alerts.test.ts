// Signal notifications (alerts.ts): a Scalper alert runs its owner's chart settings, read
// through shared/scalper.ts, and moves to newer ones only when no signal it announced is
// still running; what the new settings fired before the move is history, never sent. The
// Python scan is replaced with canned answers (useSignalScan) and Telegram messages are
// caught instead of sent. Alerts are inserted directly and scanned by id, so the ledger and
// other files' alerts stay out of it.
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { SCALPER_DEFAULTS, scalperSignalSettings } from "../../shared/scalper";
import { scanAlerts, useSignalScan, type ScanPair, type ScanSignal } from "../src/alerts";
import { db } from "../src/db";
import { signalAlerts, signalEvents, users } from "../src/db/schema";
import { call, member } from "./helpers";

const SYMBOL = "SOL-USD";
type Asked = { indicator: string; variant: string; settings?: Record<string, unknown> };

/** What the canned engine was asked for this file's symbol, and what it answers for a run's inputs. */
let asked: Asked[] = [];
let answer: (settings: Record<string, unknown> | undefined) => ScanSignal[] = () => [];
const sent: string[] = [];

useSignalScan(
  async (pairs: ScanPair[]) =>
    pairs.flatMap((p) =>
      p.indicators.map((r) => {
        const run = typeof r === "string" ? { indicator: r, variant: "" } : r;
        const mine = p.symbol === SYMBOL;
        if (mine) asked.push(run);
        return { symbol: p.symbol, timeframe: p.timeframe, venue: p.venue, indicator: run.indicator, variant: run.variant, signals: mine ? answer("settings" in run ? run.settings : undefined) : [] };
      }),
    ),
  async (_chat, html) => {
    sent.push(html);
    return { ok: true };
  },
);
afterAll(() => useSignalScan());

/** A Scalper signal as the engine answers it, `ago` bars before the newest closed bar. */
const sig = (time: string, side: "BUY" | "SELL", outcome: ScanSignal["outcome"], ago: number): ScanSignal => ({
  time,
  side,
  label: `${side} · UT Bot`,
  entry: 100,
  stop_loss: side === "BUY" ? 95 : 105,
  take_profit: side === "BUY" ? 110 : 90,
  outcome,
  exit_time: outcome === "open" ? null : "2026-11-01 12:00",
  bars_ago: ago,
  r: null,
});

test("saved inputs are read as the notifications run them", () => {
  expect(scalperSignalSettings({ ...SCALPER_DEFAULTS })).toBeNull();
  // Lengths are rounded as both engines round them; drawing options do not count.
  expect(scalperSignalSettings({ ...SCALPER_DEFAULTS, atrPeriod: 7.4, pivotLen: 1.2, emaFast: 20.4, showTrail: false })).toEqual({ atrPeriod: 7, pivotLen: 2 });
  // Wrong types, blanks and zeros fall back to the defaults.
  expect(scalperSignalSettings({ sensitivity: "2", slAtr: 0, riskReward: Number.NaN, useSweep: 1, atrRisk: null })).toBeNull();
  expect(scalperSignalSettings({ useSweep: true, rsiBuyMin: 55 })).toEqual({ useSweep: true, rsiBuyMin: 55 });
  expect(scalperSignalSettings(null)).toBeNull();
});

describe("Scalper alerts follow the chart settings", () => {
  let owner: Awaited<ReturnType<typeof member>>;
  let alertId = "";
  const chartSettings = (scalper: Record<string, unknown>) =>
    db.update(users).set({ preferences: { indicators: { scalperOn: true, scalper } } }).where(eq(users.id, owner.id));
  const alertRow = async () => (await db.select().from(signalAlerts).where(eq(signalAlerts.id, alertId)))[0];
  const events = () => db.select().from(signalEvents).where(eq(signalEvents.alertId, alertId));
  const listed = async () => (await call("/api/alerts", { cookie: owner.cookie })).body.items.find((a: { id: string }) => a.id === alertId);

  test("a new alert runs its owner's own inputs, and its first scan sends nothing", async () => {
    owner = await member({ plan: "pro", verified: true });
    await db.update(users).set({ telegramChatId: "424242" }).where(eq(users.id, owner.id));
    await chartSettings({ ...SCALPER_DEFAULTS, sensitivity: 1.5, atrPeriod: 7.4 });
    alertId = (
      await db.insert(signalAlerts).values({ userId: owner.id, symbol: SYMBOL, tvSymbol: "BINANCE:SOLUSDT", indicator: "scalper", timeframe: "15m" }).returning({ id: signalAlerts.id })
    )[0].id;
    asked = [];
    answer = (s) => (s?.sensitivity === 1.5 ? [sig("2026-11-01 10:00", "BUY", "open", 3)] : []);
    await scanAlerts([alertId]);
    expect(asked).toEqual([{ indicator: "scalper", variant: expect.any(String), settings: { sensitivity: 1.5, atrPeriod: 7 } }]);
    const row = await alertRow();
    expect(row.settings).toEqual({ sensitivity: 1.5, atrPeriod: 7 });
    expect(row.primed).toBe(true);
    expect(sent).toHaveLength(0);
    // Recorded as history: its outcome is never announced either.
    expect((await events())[0].closeNotifiedAt).not.toBeNull();
  });

  test("a fresh signal of those inputs is announced", async () => {
    answer = (s) => (s?.sensitivity === 1.5 ? [sig("2026-11-01 10:00", "BUY", "replaced", 5), sig("2026-11-01 10:30", "SELL", "open", 1)] : []);
    await scanAlerts([alertId]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("SELL · UT Bot");
    const open = (await events()).find((e) => e.signalTime === "2026-11-01 10:30");
    expect(open?.status).toBe("open");
    expect(open?.notifiedAt).not.toBeNull();
  });

  test("new chart settings wait while that signal runs", async () => {
    await chartSettings({ ...SCALPER_DEFAULTS, sensitivity: 2, atrPeriod: 7 });
    expect(await listed()).toMatchObject({ settings: "custom", settingsPending: true });
    asked = [];
    // The old inputs still follow it; an old signal first seen 9 bars late is only recorded.
    answer = (s) =>
      s?.sensitivity === 1.5 ? [sig("2026-11-01 09:00", "BUY", "open", 9), sig("2026-11-01 10:30", "SELL", "open", 2)] : [sig("2026-11-01 10:45", "BUY", "open", 1)];
    await scanAlerts([alertId]);
    expect(asked.map((a) => a.settings)).toEqual([{ sensitivity: 1.5, atrPeriod: 7 }]);
    expect((await alertRow()).settings).toEqual({ sensitivity: 1.5, atrPeriod: 7 });
    expect(sent).toHaveLength(1);
  });

  test("once it has finished, the alert moves to them and sends nothing they fired before", async () => {
    // The scan that sees the signal end announces its outcome, still on the old inputs.
    answer = (s) => (s?.sensitivity === 1.5 ? [sig("2026-11-01 09:00", "BUY", "open", 10), sig("2026-11-01 10:30", "SELL", "win", 3)] : []);
    await scanAlerts([alertId]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("TP kena");
    // The next one moves: the new inputs' recent signal is history; the old recorded-only one is closed.
    asked = [];
    answer = (s) => (s?.sensitivity === 2 ? [sig("2026-11-01 10:45", "BUY", "open", 1)] : []);
    await scanAlerts([alertId]);
    expect(asked.map((a) => a.settings)).toEqual([{ sensitivity: 2, atrPeriod: 7 }]);
    expect((await alertRow()).settings).toEqual({ sensitivity: 2, atrPeriod: 7 });
    expect(sent).toHaveLength(2);
    const all = await events();
    expect(all.find((e) => e.signalTime === "2026-11-01 10:45")?.closeNotifiedAt).not.toBeNull();
    expect(all.find((e) => e.signalTime === "2026-11-01 09:00")?.status).toBe("replaced");
    expect(await listed()).toMatchObject({ settings: "custom", settingsPending: false });
  });

  test("then the new settings' fresh signals are announced", async () => {
    answer = (s) => (s?.sensitivity === 2 ? [sig("2026-11-01 10:45", "BUY", "replaced", 2), sig("2026-11-01 11:15", "SELL", "open", 1)] : []);
    await scanAlerts([alertId]);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toContain("SELL · UT Bot");
  });

  test("accounts that kept the defaults share one plain run beside the own inputs", async () => {
    const plain = await member({ plan: "pro", verified: true });
    const plainAlert = (
      await db.insert(signalAlerts).values({ userId: plain.id, symbol: SYMBOL, tvSymbol: "BINANCE:SOLUSDT", indicator: "scalper", timeframe: "15m" }).returning({ id: signalAlerts.id })
    )[0].id;
    asked = [];
    answer = () => [];
    await scanAlerts([alertId, plainAlert]);
    expect(asked).toHaveLength(2);
    expect(asked.find((a) => a.variant === "")).toEqual({ indicator: "scalper", variant: "" });
    expect(asked.find((a) => a.variant !== "")?.settings).toEqual({ sensitivity: 2, atrPeriod: 7 });
    expect((await db.select().from(signalAlerts).where(eq(signalAlerts.id, plainAlert)))[0].settings).toBeNull();
  });
});
