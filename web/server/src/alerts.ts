// Signal notifications: each user picks symbols and indicators (PoB BYSTRA on
// 15m or 1h, Scalper Pro+ on 15m) and gets a Telegram message when a new signal
// appears and again when it hits its target, its stop or expires. Which
// indicators an account may watch is set in the admin's catalog (indicators.ts).
//
// Accuracy rules: the worker runs the same engines the chart and the agent use,
// on closed bars only, so a sent signal never changes or disappears; each signal
// is stored once per alert (unique index), so it is sent once even with two
// server instances; a new alert's first scan records what already exists
// without sending it; a signal first seen more than STALE_BARS late (server
// down, data gap) is recorded but not sent as if it were fresh.
//
// A Scalper alert runs its owner's chart settings (shared/scalper.ts) and moves to
// new ones only when no signal it announced is still running: the old inputs follow
// that signal to its end, and what the new inputs fired before the move is recorded
// as history, never sent as if it were fresh.
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./auth";
import { db } from "./db";
import { signalAlerts, signalEvents, userScripts, users, type SignalIndicator, type SignalStatus } from "./db/schema";
import { openCreatorSignals, recordCreatorSignal, scoreCreatorSignal } from "./creators";
import { recordError } from "./errors";
import { canUse, CATALOG_KEY, catalogScripts, keyOf, usableKeys, usableRows } from "./indicators";
import { ledgerPairs, ledgerScriptSignals, recordLedger, resultKey } from "./ledger";
import { leaderOnly } from "./locks";
import { log } from "./log";
import { capMessage, limitsOf, planOf } from "./plans";
import { checkPrices, notificationsInUse } from "./price-alerts";
import { getCandles, SYMBOL_PATTERN, type Interval } from "./market";
import { scalperSignalSettings, type ScalperSignalSettings } from "../../shared/scalper";
import { toScriptBars } from "../../shared/script";
import { binancePair, binancePerpetual } from "./binance";
import { cryptoBase, storedVenue, VENUES, venueOfTv, type VenueId } from "./venues";
import { runOnSymbol, type ScriptTimeframe } from "./script-run";
import { readShared, writeShared } from "./shared";
import { escape, publicUrl, sendTelegram, telegramBot } from "./watch";
import { runCommand } from "./worker";

const STALE_BARS = Number(process.env.SIGNAL_STALE_BARS ?? 4);
/** Minutes between scans; hourly pairs are scanned every third slot. */
const SLOT_MINUTES = 5;
/** Scans start this long after a slot boundary, so the bar that just closed is in Yahoo's answer. */
const SCAN_DELAY_MS = 60_000;
const SCAN_TIMEOUT_MS = 4 * 60_000;

export const COMBOS: { indicator: SignalIndicator; timeframe: "15m" | "1h" | "1d"; label: string }[] = [
  { indicator: "pob", timeframe: "15m", label: "PoB BYSTRA 15m" },
  { indicator: "pob", timeframe: "1h", label: "PoB BYSTRA 1j" },
  { indicator: "scalper", timeframe: "15m", label: "Scalper Pro+ 15m" },
  { indicator: "fib", timeframe: "15m", label: "Fib Golden Zone 15m" },
  { indicator: "fib", timeframe: "1h", label: "Fib Golden Zone 1j" },
  { indicator: "fib", timeframe: "1d", label: "Fib Golden Zone harian" },
];
const NAMES: Record<string, string> = { pob: "PoB BYSTRA", scalper: "Scalper Pro+", fib: "Fib Golden Zone" };
const TF_LABEL: Record<string, string> = { "15m": "15m", "1h": "1j", "4h": "4j", "1d": "harian" };
/** Timeframes a user's own script can be watched on. */
const SCRIPT_TFS = ["15m", "1h", "4h", "1d"] as const;
const SCRIPT_ID = /^script:([0-9a-f-]{36})$/;

export type ScanSignal = {
  time: string;
  side: "BUY" | "SELL";
  label: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  outcome: SignalStatus;
  exit_time: string | null;
  bars_ago: number;
  r?: number | null;
};
type Alert = typeof signalAlerts.$inferSelect;
/** What the scan asks of a pair: an engine's name runs its defaults; a Scalper variant runs a user's own inputs. */
type EngineRequest = string | { indicator: string; variant: string; settings: ScalperSignalSettings };
export type ScanPair = { symbol: string; timeframe: string; venue: string; indicators: EngineRequest[]; recent: number; bars?: ReturnType<typeof toScriptBars> };
/** One engine's answer for one pair, under its variant ("" = the defaults). */
export type ScanResult = { symbol: string; timeframe: string; venue: string; indicator: string; variant: string; signals: ScanSignal[] };

/** The same inputs give the same variant, in whatever order they were saved; "" = the defaults. */
const variantOf = (settings: ScalperSignalSettings | null | undefined) =>
  settings && Object.keys(settings).length
    ? createHash("sha256").update(JSON.stringify(Object.entries(settings).sort(([a], [b]) => (a < b ? -1 : 1)))).digest("hex").slice(0, 12)
    : "";

/** The Scalper inputs an account saved on its chart (client stores/indicators.svelte.ts), as the scan runs them. */
const chartSettings = (preferences: Record<string, unknown> | null | undefined) =>
  scalperSignalSettings((preferences?.indicators as { scalper?: unknown } | undefined)?.scalper);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-10-30 11:30" → "30 Okt 11:30"; a daily bar "2026-10-30" → "30 Okt 2026". */
const when = (t: string) => `${Number(t.slice(8, 10))} ${MONTHS[Number(t.slice(5, 7)) - 1]} ${t.length > 10 ? t.slice(11, 16) : t.slice(0, 4)}`;
const price = (v: number) => v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) >= 10 ? 2 : 5 });

/** "PoB BYSTRA · OANDA:XAUUSD · 15m"; a script alert names its script. */
function head(a: Alert, name?: string) {
  return `${name ?? NAMES[a.indicator] ?? a.indicator} · ${a.tvSymbol} · ${TF_LABEL[a.timeframe] ?? a.timeframe}`;
}

function link(a: Alert) {
  const base = publicUrl();
  if (!base) return "";
  const q = `s=${encodeURIComponent(a.tvSymbol)}&amp;v=ai&amp;tf=${a.timeframe}`;
  return `<a href="${base}/app#/?${q}">Buka chart</a>`;
}

/** Where an alert's bars come from: the venue it watches, else the default source the chart uses. */
function dataNote(a: Alert) {
  if (a.venue) return `Data ${VENUES[a.venue as VenueId]?.label ?? a.venue}, real-time`;
  if (binancePair(a.symbol)) return "Data Binance, real-time";
  const perpetual = binancePerpetual(a.symbol, a.timeframe as Interval);
  if (perpetual) return `Data Binance ${perpetual} (perpetual), bisa beda beberapa poin dari spot`;
  return a.symbol.endsWith("=F") ? `Data Yahoo, harga futures ${a.symbol}, bisa beda beberapa poin dari spot` : "Data Yahoo";
}

function openMessage(a: Alert, s: ScanSignal, name?: string) {
  return [
    `<b>🔔 ${escape(s.label)}</b>`,
    escape(head(a, name)),
    s.time.length > 10 ? `Candle ${when(s.time)} (jam bursa), sudah tutup` : `Candle harian ${when(s.time)}, sudah tutup`,
    `Entry <b>${price(s.entry)}</b> · SL ${price(s.stop_loss)} · TP ${price(s.take_profit)}`,
    link(a),
    `<i>${escape(dataNote(a))}. Riset, bukan saran investasi.</i>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function closeMessage(
  a: Alert,
  e: { label: string; signalTime: string; entry: number; stopLoss: number; takeProfit: number },
  status: SignalStatus,
  exit: string | null,
  name?: string,
) {
  const risk = Math.abs(e.entry - e.stopLoss);
  const what: Record<string, string> = {
    win: `✅ TP kena · ${price(e.takeProfit)} (+${(Math.abs(e.takeProfit - e.entry) / risk).toFixed(2).replace(".", ",")}R)`,
    loss: `❌ SL kena · ${price(e.stopLoss)} (−1R)`,
    exit: "🚪 Keluar oleh kondisi skrip",
    expired: "⏱ Kedaluwarsa tanpa kena TP/SL",
    replaced: "↩ Diganti sinyal baru",
  };
  return [
    `<b>${what[status] ?? status}</b>`,
    escape(head(a, name)),
    `${escape(e.label)} dari ${when(e.signalTime)} · entry ${price(e.entry)}${exit ? ` · selesai ${when(exit)}` : ""}`,
    link(a),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The engines in Python (web/worker/signals.py), on every pair at once. */
async function workerScan(pairs: ScanPair[]): Promise<ScanResult[]> {
  const out: ScanResult[] = [];
  const handle = runCommand("signals", { pairs }, null, async (e) => {
    if (e.type === "signals") {
      out.push({
        symbol: String(e.symbol),
        timeframe: String(e.timeframe),
        venue: String(e.venue ?? ""),
        indicator: String(e.indicator),
        variant: String(e.variant ?? ""),
        signals: e.signals as ScanSignal[],
      });
    } else if (e.type === "signals_error") {
      log.warn("signals_indicator_failed", { symbol: e.symbol, timeframe: e.timeframe, venue: e.venue, indicator: e.indicator, variant: e.variant, error: e.message });
    }
  });
  const timer = setTimeout(() => handle.kill(), SCAN_TIMEOUT_MS);
  const { exitCode, stderrTail } = await handle.done.finally(() => clearTimeout(timer));
  if (exitCode !== 0) log.error("signal_scan_exit", { exitCode, stderr: stderrTail.trim().split("\n").slice(-2).join(" ") });
  return out;
}

let runEngines = workerScan;
let send = sendTelegram;
let runScriptOn = runOnSymbol;

/** Tests: answer the scan without Python, run scripts on given bars, and catch its Telegram messages instead of sending them. */
export function useSignalScan(engines: typeof workerScan = workerScan, sender: typeof sendTelegram = sendTelegram, scripts: typeof runOnSymbol = runOnSymbol) {
  runEngines = engines;
  send = sender;
  runScriptOn = scripts;
}

let running = false;

/** When the last full scan finished and whether it threw, for the status page (status.ts) on any instance. */
export const scanHealth = () => readShared<{ at: number; ok: boolean }>("scan:last");

/** One scan. `only` limits it to some alerts (a new one's silent first scan). */
async function scan(only?: string[], withHourly = true) {
  if (running) return;
  running = true;
  let failed = false;
  try {
    const rows = await db
      .select({ alert: signalAlerts, chat: users.telegramChatId, preferences: users.preferences, owner: { role: users.role, plan: users.plan, planUntil: users.planUntil } })
      .from(signalAlerts)
      .innerJoin(users, eq(signalAlerts.userId, users.id))
      .where(and(eq(users.disabled, false), only?.length ? inArray(signalAlerts.id, only) : undefined))
      .orderBy(asc(signalAlerts.createdAt));
    // An indicator the admin no longer opens to an account (indicators.ts) pauses its alerts until it does, without
    // taking a place in the plan's allowance. Each account is then watched for as many alerts as its plan allows,
    // oldest first: a lapsed plan pauses the rest.
    const usable = await usableKeys([...new Map(rows.map((r) => [r.alert.userId!, { id: r.alert.userId!, ...r.owner }])).values()]);
    const held = new Map<string, number>();
    const allowed = rows.filter((r) => {
      if (!SCRIPT_ID.test(r.alert.indicator) && !usable.get(r.alert.userId!)?.has(r.alert.indicator)) return false;
      const n = (held.get(r.alert.userId!) ?? 0) + 1;
      held.set(r.alert.userId!, n);
      return n <= limitsOf(r.owner).alerts;
    });
    // Hourly and daily pairs ride every third slot (15 minutes); their bars close rarely.
    const wanted = allowed.filter((r) => withHourly || r.alert.timeframe === "15m");
    // The signal ledger (ledger.ts) rides the same scan; a new alert's silent first scan leaves it out.
    const ledger = only ? [] : await ledgerPairs(withHourly);
    if (!wanted.length && !ledger.length) return;

    // A Scalper alert runs its owner's chart settings, but moves to new ones only when no
    // signal it announced is still running: until then its old inputs follow that signal.
    const scalperIds = wanted.filter((r) => r.alert.indicator === "scalper").map((r) => r.alert.id);
    const following = new Set(
      scalperIds.length
        ? (
            await db
              .selectDistinct({ id: signalEvents.alertId })
              .from(signalEvents)
              .where(and(inArray(signalEvents.alertId, scalperIds), eq(signalEvents.status, "open"), isNull(signalEvents.closeNotifiedAt)))
          ).map((r) => r.id)
        : [],
    );
    const inputs = new Map<string, ScalperSignalSettings | null>();
    const moving = new Set<string>();
    for (const { alert, preferences } of wanted) {
      if (alert.indicator !== "scalper") continue;
      const chart = chartSettings(preferences);
      if (variantOf(chart) === variantOf(alert.settings) || following.has(alert.id)) {
        inputs.set(alert.id, alert.settings ?? null);
      } else {
        inputs.set(alert.id, chart);
        moving.add(alert.id);
      }
    }

    // One pair per symbol, timeframe and venue ("" = the default source), with every engine run asked of it.
    const pairs = new Map<string, { symbol: string; timeframe: string; venue: string; requests: Map<string, EngineRequest>; recent: number }>();
    const pairOf = (symbol: string, timeframe: string, venue: string, recent: number) => {
      const key = `${symbol}|${timeframe}|${venue}`;
      if (!pairs.has(key)) pairs.set(key, { symbol, timeframe, venue, requests: new Map(), recent: 10 });
      const pair = pairs.get(key)!;
      pair.recent = Math.max(pair.recent, recent);
      return pair;
    };
    for (const p of ledger) {
      const pair = pairOf(p.symbol, p.timeframe, p.venue, p.recent);
      for (const i of p.indicators) pair.requests.set(i, i);
    }
    for (const { alert } of wanted) {
      if (SCRIPT_ID.test(alert.indicator) || CATALOG_KEY.test(alert.indicator)) continue;
      const settings = inputs.get(alert.id) ?? null;
      const variant = variantOf(settings);
      pairOf(alert.symbol, alert.timeframe, alert.venue, 10).requests.set(
        variant ? `${alert.indicator}#${variant}` : alert.indicator,
        settings && variant ? { indicator: alert.indicator, variant, settings } : alert.indicator,
      );
    }
    // A pair on another venue carries its bars, the same candles the chart shows (venues.ts); default pairs fetch their own.
    const jobPairs: ScanPair[] = [];
    for (const p of pairs.values()) {
      const job: ScanPair = { symbol: p.symbol, timeframe: p.timeframe, venue: p.venue, indicators: [...p.requests.values()], recent: p.recent };
      if (!p.venue) {
        jobPairs.push(job);
        continue;
      }
      try {
        // As the default source holds them: a month of 15m bars, a year of hourly ones, two years of daily ones.
        const series = await getCandles(p.symbol, p.timeframe === "1d" ? "2y" : "1y", p.timeframe as Interval, p.venue as VenueId);
        jobPairs.push({ ...job, bars: toScriptBars(series.candles) });
      } catch (err) {
        log.warn("signals_pair_failed", { symbol: p.symbol, timeframe: p.timeframe, venue: p.venue, error: (err as Error).message });
      }
    }
    const found = new Map<string, ScanSignal[]>();
    if (jobPairs.length) {
      for (const r of await runEngines(jobPairs)) found.set(resultKey(r.symbol, r.timeframe, r.venue, r.indicator, r.variant), r.signals);
    }

    // Scripts run here, in the same sandbox and on the same candles as the chart: a user's own, or one the admin
    // published (indicators.ts), which runs once per pair however many accounts watch it.
    const names = new Map<string, string>();
    const catalog = wanted.some((r) => CATALOG_KEY.test(r.alert.indicator)) ? await catalogScripts() : new Map<string, { name: string; code: string }>();
    const tried = new Set<string>();
    for (const { alert } of wanted) {
      const own = alert.indicator.match(SCRIPT_ID)?.[1];
      const key = resultKey(alert.symbol, alert.timeframe, alert.venue, alert.indicator);
      if ((!own && !CATALOG_KEY.test(alert.indicator)) || tried.has(key)) continue;
      tried.add(key);
      let script = catalog.get(alert.indicator);
      if (own) {
        const [mine] = await db.select().from(userScripts).where(and(eq(userScripts.id, own), eq(userScripts.userId, alert.userId!)));
        script = mine && { name: `Skrip ${mine.name}`, code: mine.code };
      }
      if (!script?.code) continue;
      names.set(alert.indicator, script.name);
      try {
        const run = await runScriptOn(script.code, alert.symbol, alert.timeframe as ScriptTimeframe, undefined, (alert.venue || undefined) as VenueId | undefined);
        if (!run.ok) {
          log.warn("script_alert_failed", { script: script.name, symbol: alert.symbol, timeframe: alert.timeframe, error: run.error });
          continue;
        }
        const last = run.bars.length - 1;
        found.set(
          key,
          run.result.signals.slice(-10).map((s) => ({
            time: s.time,
            side: s.side,
            label: s.label,
            entry: s.entry,
            stop_loss: s.stopLoss,
            take_profit: s.takeProfit,
            outcome: s.outcome,
            exit_time: s.exitIndex == null ? null : run.bars[s.exitIndex].time,
            bars_ago: last - s.index,
            r: s.r,
          })),
        );
      } catch (e) {
        log.warn("script_alert_failed", { script: script.name, symbol: alert.symbol, error: (e as Error).message });
      }
    }

    for (const { alert, chat, owner } of wanted) {
      const scriptName = names.get(alert.indicator);
      // A Creator's published alert also feeds their public record (creators.ts).
      const publicRecord = alert.public && planOf(owner) === "creator";
      const strategy = scriptName ?? NAMES[alert.indicator] ?? alert.indicator;
      const settings = inputs.get(alert.id) ?? null;
      const signals = found.get(resultKey(alert.symbol, alert.timeframe, alert.venue, alert.indicator, variantOf(settings)));
      if (!signals) continue; // this pair failed; try again next slot
      const moves = moving.has(alert.id);
      // The old inputs' recorded-only signals would stay open for good: the new inputs never report them.
      if (moves) await db.update(signalEvents).set({ status: "replaced" }).where(and(eq(signalEvents.alertId, alert.id), eq(signalEvents.status, "open")));
      const known = new Map(
        (await db.select().from(signalEvents).where(eq(signalEvents.alertId, alert.id))).map((e) => [e.signalTime, e]),
      );
      // A pair may carry the ledger's backfill; alerts look at the last ten, as before.
      for (const s of signals.slice(-10)) {
        const seen = known.get(s.time);
        if (!seen) {
          // What new inputs fired before the move is history, as on a new alert's first scan.
          const fresh = alert.primed && !moves && s.bars_ago <= STALE_BARS;
          const [row] = await db
            .insert(signalEvents)
            .values({
              alertId: alert.id,
              // The pair travels with the signal, so the owner's history keeps it after the alert is removed.
              userId: alert.userId,
              symbol: alert.symbol,
              tvSymbol: alert.tvSymbol,
              indicator: alert.indicator,
              timeframe: alert.timeframe,
              venue: alert.venue,
              signalTime: s.time,
              side: s.side,
              label: s.label,
              entry: s.entry,
              stopLoss: s.stop_loss,
              takeProfit: s.take_profit,
              status: s.outcome,
              exitTime: s.exit_time,
              // Old or late signals are history: their outcome is never announced either.
              closeNotifiedAt: fresh ? null : new Date(),
            })
            .onConflictDoNothing()
            .returning();
          if (!row || !fresh) continue;
          // On the record the moment it fires, whether or not the Telegram message gets through.
          if (publicRecord) await recordCreatorSignal(alert, row, s, strategy).catch((err) => recordError("creator", err));
          const sent = await send(chat, openMessage(alert, s, scriptName));
          if (!sent.ok) {
            log.warn("signal_alert_not_sent", { alert: alert.id, error: sent.error });
            continue;
          }
          await db.update(signalEvents).set({ notifiedAt: new Date() }).where(eq(signalEvents.id, row.id));
          // Seen for the first time already finished (it fired and ended between scans).
          if (s.outcome !== "open" && (await send(chat, closeMessage(alert, row, s.outcome, s.exit_time, scriptName))).ok) {
            await db.update(signalEvents).set({ closeNotifiedAt: new Date() }).where(eq(signalEvents.id, row.id));
          }
        } else if (seen.status === "open" && s.outcome !== "open") {
          await db.update(signalEvents).set({ status: s.outcome, exitTime: s.exit_time }).where(eq(signalEvents.id, seen.id));
          // Scored on the public record too, if it went there when it fired (even if the alert is private now).
          await scoreCreatorSignal(seen.id, s).catch((err) => recordError("creator", err));
          if (seen.notifiedAt && !seen.closeNotifiedAt && (await send(chat, closeMessage(alert, seen, s.outcome, s.exit_time, scriptName))).ok) {
            await db.update(signalEvents).set({ closeNotifiedAt: new Date() }).where(eq(signalEvents.id, seen.id));
          }
        }
      }
      if (moves) await db.update(signalAlerts).set({ settings }).where(eq(signalAlerts.id, alert.id));
      if (!alert.primed) await db.update(signalAlerts).set({ primed: true }).where(eq(signalAlerts.id, alert.id));
    }
    if (ledger.length) await recordLedger(found).catch((err) => recordError("ledger", err));
    // Daily strategies from the lab: their bars close once a day, so the hourly slots are enough.
    if (ledger.length && withHourly) await recordLedger(await ledgerScriptSignals()).catch((err) => recordError("ledger", err));
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    running = false;
    // A new alert's own first scan (only) is not the scheduled one.
    if (!only) await writeShared("scan:last", { at: Date.now(), ok: !failed }).catch((err) => recordError("scan", err));
  }
}

/** One scan now, of these alerts only when given, after any scan already in flight (tests). */
export async function scanAlerts(only?: string[]) {
  while (running) await new Promise((done) => setTimeout(done, 50));
  await scan(only);
}

let lastSlot = -1;
let lastMinute = -1;
export function startAlertScheduler() {
  const tick = () => {
    // Price levels (price-alerts.ts) are checked every minute.
    const minute = Math.floor(Date.now() / 60_000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      checkPrices().catch((err) => recordError("prices", err));
    }
    const slot = Math.floor((Date.now() - SCAN_DELAY_MS) / (SLOT_MINUTES * 60_000));
    if (slot === lastSlot) return;
    lastSlot = slot;
    scan(undefined, slot % 3 === 0).catch((err) => recordError("scan", err));
  };
  setInterval(leaderOnly(tick), 20_000);
}

export const alertsApi = new Hono<AppEnv>();

alertsApi.get("/alerts", async (c) => {
  const user = c.get("user");
  const chart = variantOf(chartSettings(user.preferences));
  const [items, open, scripts, catalog] = await Promise.all([
    db.select().from(signalAlerts).where(eq(signalAlerts.userId, user.id)).orderBy(asc(signalAlerts.createdAt)),
    usableRows(user),
    db.select().from(userScripts).where(eq(userScripts.userId, user.id)).orderBy(asc(userScripts.name)),
    catalogScripts(),
  ]);
  const usable = new Set(open.map(keyOf));
  const ids = items.map((a) => a.id);
  const events = ids.length ? await db.select().from(signalEvents).where(inArray(signalEvents.alertId, ids)).orderBy(desc(signalEvents.signalTime)) : [];
  const own = new Map(scripts.map((s) => [`script:${s.id}`, `Skrip ${s.name}`]));
  return c.json({
    items: items.map((a) => {
      const last = events.find((e) => e.alertId === a.id);
      return {
        id: a.id,
        symbol: a.symbol,
        tvSymbol: a.tvSymbol,
        indicator: a.indicator,
        /** What lists call it; a removed script has none. */
        name: NAMES[a.indicator] ?? own.get(a.indicator) ?? catalog.get(a.indicator)?.name ?? null,
        /** False while the admin keeps its indicator from this account: the scan skips it until that changes. */
        available: SCRIPT_ID.test(a.indicator) || usable.has(a.indicator),
        timeframe: a.timeframe,
        venue: a.venue,
        primed: a.primed,
        public: a.public,
        // Scalper: whether it runs the owner's own inputs, and whether newer chart settings still wait to take over.
        settings: a.settings ? "custom" : "default",
        settingsPending: a.indicator === "scalper" && variantOf(a.settings) !== chart,
        last: last ? { signalTime: last.signalTime, label: last.label, status: last.status } : null,
      };
    }),
    max: limitsOf(user).alerts,
    /** Signal alerts plus active price levels: they share the plan's allowance. */
    used: await notificationsInUse(user.id),
    // The built-in engines and published scripts this account may use, then its own scripts.
    combos: [
      ...COMBOS.filter((x) => usable.has(x.indicator)),
      ...open.filter((r) => !r.builtin).flatMap((r) => SCRIPT_TFS.map((tf) => ({ indicator: keyOf(r), timeframe: tf, label: `${r.name} ${TF_LABEL[tf]}` }))),
      ...scripts.flatMap((s) => SCRIPT_TFS.map((tf) => ({ indicator: `script:${s.id}`, timeframe: tf, label: `Skrip ${s.name} ${TF_LABEL[tf]}` }))),
    ],
    telegram: { bot: telegramBot(), chat: Boolean(user.telegramChatId), configured: telegramBot() && Boolean(user.telegramChatId) },
  });
});

// The member's own signal calls, for Beranda. A call is a signal that went out live (announced,
// or due to be when Telegram is not set up), not the history a new alert records silently on
// its first scan (inserted already closed, never announced). R counts what the engines settle
// exactly: a target pays its distance over the stop's, a stop costs one; an exit by condition or
// time is counted, not scored, since its exit price is not kept.
const HISTORY_DAYS = [7, 30, 90, 365];
const liveCall = or(isNotNull(signalEvents.notifiedAt), isNull(signalEvents.closeNotifiedAt));
const rOf = sql<number | null>`case
  when ${signalEvents.status} = 'win' and abs(${signalEvents.entry} - ${signalEvents.stopLoss}) > 0
    then abs(${signalEvents.takeProfit} - ${signalEvents.entry}) / abs(${signalEvents.entry} - ${signalEvents.stopLoss})
  when ${signalEvents.status} = 'loss' then -1
end`;
// A signal recorded by the previous release in the moment before migration 0025's columns were
// filled has its pair only through its alert.
const evSymbol = sql<string>`coalesce(${signalEvents.symbol}, ${signalAlerts.symbol})`;
const evTvSymbol = sql<string>`coalesce(${signalEvents.tvSymbol}, ${signalAlerts.tvSymbol})`;
const evIndicator = sql<SignalIndicator>`coalesce(${signalEvents.indicator}, ${signalAlerts.indicator})`;
const evTimeframe = sql<string>`coalesce(${signalEvents.timeframe}, ${signalAlerts.timeframe})`;
const tally = {
  total: sql<number>`count(*)::int`,
  win: sql<number>`count(*) filter (where ${signalEvents.status} = 'win')::int`,
  loss: sql<number>`count(*) filter (where ${signalEvents.status} = 'loss')::int`,
  // Still running only while its alert watches it; a removed alert's open signal is no longer followed.
  open: sql<number>`count(*) filter (where ${signalEvents.status} = 'open' and ${signalEvents.alertId} is not null)::int`,
  r: sql<number>`coalesce(sum(${rOf}), 0)::float`,
};

alertsApi.get("/alerts/history", async (c) => {
  const user = c.get("user");
  const asked = Number(c.req.query("days"));
  const days = HISTORY_DAYS.includes(asked) ? asked : 90;
  const where = and(
    sql`coalesce(${signalEvents.userId}, ${signalAlerts.userId}) = ${user.id}`,
    gte(signalEvents.createdAt, new Date(Date.now() - days * 86_400_000)),
    liveCall,
  );
  const join = eq(signalEvents.alertId, signalAlerts.id);
  const day = sql<string>`to_char(${signalEvents.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;
  const [[totals], byIndicator, bySymbol, daily, calls, scripts, catalog, [held]] = await Promise.all([
    db
      .select({
        ...tally,
        exit: sql<number>`count(*) filter (where ${signalEvents.status} = 'exit')::int`,
        expired: sql<number>`count(*) filter (where ${signalEvents.status} = 'expired')::int`,
        replaced: sql<number>`count(*) filter (where ${signalEvents.status} = 'replaced')::int`,
        stopped: sql<number>`count(*) filter (where ${signalEvents.status} = 'open' and ${signalEvents.alertId} is null)::int`,
      })
      .from(signalEvents)
      .leftJoin(signalAlerts, join)
      .where(where),
    db
      .select({ indicator: evIndicator, timeframe: evTimeframe, ...tally })
      .from(signalEvents)
      .leftJoin(signalAlerts, join)
      .where(where)
      .groupBy(evIndicator, evTimeframe)
      .orderBy(desc(tally.total)),
    db
      .select({ symbol: evSymbol, tvSymbol: evTvSymbol, ...tally })
      .from(signalEvents)
      .leftJoin(signalAlerts, join)
      .where(where)
      .groupBy(evSymbol, evTvSymbol)
      .orderBy(desc(tally.total))
      .limit(20),
    db.select({ day, win: tally.win, loss: tally.loss, r: tally.r }).from(signalEvents).leftJoin(signalAlerts, join).where(where).groupBy(day).orderBy(asc(day)),
    db
      .select({
      id: signalEvents.id,
      tracked: sql<boolean>`${signalEvents.alertId} is not null`,
      symbol: evSymbol,
      tvSymbol: evTvSymbol,
      indicator: evIndicator,
      timeframe: evTimeframe,
      venue: sql<string>`coalesce(${signalEvents.venue}, ${signalAlerts.venue}, '')`,
      side: signalEvents.side,
      label: signalEvents.label,
      entry: signalEvents.entry,
      stopLoss: signalEvents.stopLoss,
      takeProfit: signalEvents.takeProfit,
      status: signalEvents.status,
      signalTime: signalEvents.signalTime,
      exitTime: signalEvents.exitTime,
      r: rOf,
    })
      .from(signalEvents)
      .leftJoin(signalAlerts, join)
      .where(where)
      .orderBy(desc(signalEvents.createdAt))
      .limit(200),
    db.select({ id: userScripts.id, name: userScripts.name }).from(userScripts).where(eq(userScripts.userId, user.id)),
    catalogScripts(),
    db.select({ n: sql<number>`count(*)::int` }).from(signalAlerts).where(eq(signalAlerts.userId, user.id)),
  ]);
  const decided = totals.win + totals.loss;
  return c.json({
    days,
    summary: { ...totals, winRate: decided ? totals.win / decided : null, alerts: held.n, max: limitsOf(user).alerts },
    byIndicator,
    bySymbol,
    daily,
    calls,
    /** Names for `script:<id>` indicators and the published `catalog:<id>` ones shown here; a removed one has none. */
    scriptNames: Object.fromEntries([
      ...scripts.map((s) => [`script:${s.id}`, s.name]),
      ...[...catalog].filter(([key]) => byIndicator.some((i) => i.indicator === key)).map(([key, s]) => [key, s.name]),
    ]),
    telegram: telegramBot() && Boolean(user.telegramChatId),
  });
});

export const alertSchema = z.object({
  symbol: z.string().regex(SYMBOL_PATTERN),
  tvSymbol: z.string().min(1).max(40),
  indicator: z.union([z.enum(["pob", "scalper", "fib"]), z.string().regex(SCRIPT_ID), z.string().regex(CATALOG_KEY)]),
  timeframe: z.enum(["15m", "1h", "4h", "1d"]),
});

alertsApi.post("/alerts", async (c) => {
  const body = alertSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Data notifikasi tidak valid" }, 400);
  const { symbol, tvSymbol, indicator, timeframe } = body.data;
  const user = c.get("user");
  const scriptId = indicator.match(SCRIPT_ID)?.[1];
  if (scriptId) {
    const [mine] = await db.select({ id: userScripts.id }).from(userScripts).where(and(eq(userScripts.id, scriptId), eq(userScripts.userId, user.id)));
    if (!mine) return c.json({ error: "Skrip tidak ditemukan" }, 404);
  } else if (!(await canUse(user, indicator))) {
    return c.json({ error: "Indikator ini tidak tersedia di paketmu" }, 403);
  } else if (!CATALOG_KEY.test(indicator) && !COMBOS.some((x) => x.indicator === indicator && x.timeframe === timeframe)) {
    return c.json({ error: "Kombinasi indikator dan timeframe ini belum didukung" }, 400);
  }
  // The venue comes from the chart's symbol: BYBIT:BTCUSDT watches Bybit's bars, BINANCE:… the default source.
  const venue = storedVenue(venueOfTv(tvSymbol));
  if (venue && !cryptoBase(symbol)) return c.json({ error: "Bursa hanya untuk simbol kripto" }, 400);
  const max = limitsOf(user).alerts;
  if ((await notificationsInUse(user.id)) >= max) return c.json({ error: capMessage(user, max, "notifikasi") }, 409);
  const [row] = await db
    .insert(signalAlerts)
    .values({ userId: user.id, symbol: symbol.toUpperCase(), tvSymbol: tvSymbol.toUpperCase(), indicator: indicator as SignalIndicator, timeframe, venue })
    .onConflictDoNothing()
    .returning();
  // Record what already exists now, silently, so the first message is a truly new signal.
  if (row) scan([row.id]).catch((err) => recordError("scan", err));
  return c.json({ ok: true, id: row?.id ?? null }, row ? 201 : 200);
});

alertsApi.delete("/alerts/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const [mine] = await db.select().from(signalAlerts).where(and(eq(signalAlerts.id, id), eq(signalAlerts.userId, c.get("user").id)));
  if (!mine) return c.json({ ok: true });
  // Its scan scores the public record's open signals: deleting it now would leave them open forever.
  if (await openCreatorSignals(id)) {
    return c.json({ error: "Alert ini punya sinyal yang masih berjalan di halaman publikmu. Jadikan privat dulu; alert bisa dihapus setelah sinyalnya selesai." }, 409);
  }
  // Its signals stay in the owner's history; one recorded before they carried their pair takes it now.
  await db
    .update(signalEvents)
    .set({ userId: mine.userId, symbol: mine.symbol, tvSymbol: mine.tvSymbol, indicator: mine.indicator, timeframe: mine.timeframe, venue: mine.venue })
    .where(and(eq(signalEvents.alertId, id), isNull(signalEvents.userId)));
  await db.delete(signalAlerts).where(eq(signalAlerts.id, id));
  return c.json({ ok: true });
});

alertsApi.post("/alerts/test", async (c) => {
  const user = c.get("user");
  const sent = await sendTelegram(
    user.telegramChatId,
    `<b>🔔 Notifikasi sinyal TradingAgents</b>\nTersambung untuk ${escape(user.username)}. Sinyal baru dan hasil TP/SL akan dikirim ke chat ini.`,
  );
  return sent.ok ? c.json({ ok: true }) : c.json({ error: sent.error }, 400);
});
