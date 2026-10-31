// Signal notifications: each user picks symbols and indicators (PoB BYSTRA on
// 15m or 1h, Scalper Pro+ on 15m) and gets a Telegram message when a new signal
// appears and again when it hits its target, its stop or expires.
//
// Accuracy rules: the worker runs the same engines the chart and the agent use,
// on closed bars only, so a sent signal never changes or disappears; each signal
// is stored once per alert (unique index), so it is sent once even with two
// server instances; a new alert's first scan records what already exists
// without sending it; a signal first seen more than STALE_BARS late (server
// down, data gap) is recorded but not sent as if it were fresh.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./auth";
import { db } from "./db";
import { signalAlerts, signalEvents, userScripts, users, type SignalIndicator, type SignalStatus } from "./db/schema";
import { ledgerPairs, ledgerScriptSignals, recordLedger } from "./ledger";
import { SYMBOL_PATTERN } from "./market";
import { runOnSymbol, type ScriptTimeframe } from "./script-run";
import { escape, publicUrl, sendTelegram, telegramBot } from "./watch";
import { runCommand } from "./worker";

const MAX_ALERTS = 15;
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

type ScanSignal = {
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-10-30 11:30" → "30 Okt 11:30"; a daily bar "2026-10-30" → "30 Okt 2026". */
const when = (t: string) => `${Number(t.slice(8, 10))} ${MONTHS[Number(t.slice(5, 7)) - 1]} ${t.length > 10 ? t.slice(11, 16) : t.slice(0, 4)}`;
const price = (v: number) => v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) >= 10 ? 2 : 5 });

/** "PoB BYSTRA · OANDA:XAUUSD · 15m"; a script alert names its script. */
function head(a: Alert, scriptName?: string) {
  const name = scriptName ? `Skrip ${scriptName}` : (NAMES[a.indicator] ?? a.indicator);
  return `${name} · ${a.tvSymbol} · ${TF_LABEL[a.timeframe] ?? a.timeframe}`;
}

function link(a: Alert) {
  const base = publicUrl();
  if (!base) return "";
  const q = `s=${encodeURIComponent(a.tvSymbol)}&amp;v=ai&amp;tf=${a.timeframe}`;
  return `<a href="${base}/#/?${q}">Buka chart</a>`;
}

function openMessage(a: Alert, s: ScanSignal, scriptName?: string) {
  const futures = a.symbol.endsWith("=F") ? `, harga futures ${escape(a.symbol)}, bisa beda beberapa poin dari spot` : "";
  return [
    `<b>🔔 ${escape(s.label)}</b>`,
    escape(head(a, scriptName)),
    s.time.length > 10 ? `Candle ${when(s.time)} (jam bursa), sudah tutup` : `Candle harian ${when(s.time)}, sudah tutup`,
    `Entry <b>${price(s.entry)}</b> · SL ${price(s.stop_loss)} · TP ${price(s.take_profit)}`,
    link(a),
    `<i>Data Yahoo${futures}. Riset, bukan saran investasi.</i>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function closeMessage(
  a: Alert,
  e: { label: string; signalTime: string; entry: number; stopLoss: number; takeProfit: number },
  status: SignalStatus,
  exit: string | null,
  scriptName?: string,
) {
  const risk = Math.abs(e.entry - e.stopLoss);
  const what: Record<string, string> = {
    win: `✅ TP kena · ${price(e.takeProfit)} (+${(Math.abs(e.takeProfit - e.entry) / risk).toFixed(2).replace(".", ",")}R)`,
    loss: `❌ SL kena · ${price(e.stopLoss)} (−1R)`,
    expired: "⏱ Kedaluwarsa tanpa kena TP/SL",
    replaced: "↩ Diganti sinyal baru",
  };
  return [
    `<b>${what[status] ?? status}</b>`,
    escape(head(a, scriptName)),
    `${escape(e.label)} dari ${when(e.signalTime)} · entry ${price(e.entry)}${exit ? ` · selesai ${when(exit)}` : ""}`,
    link(a),
  ]
    .filter(Boolean)
    .join("\n");
}

let running = false;

/** One scan. `only` limits it to some alerts (a new one's silent first scan). */
async function scan(only?: string[], withHourly = true) {
  if (running) return;
  running = true;
  try {
    const rows = await db
      .select({ alert: signalAlerts, chat: users.telegramChatId })
      .from(signalAlerts)
      .innerJoin(users, eq(signalAlerts.userId, users.id))
      .where(and(eq(users.disabled, false), only?.length ? inArray(signalAlerts.id, only) : undefined));
    // Hourly and daily pairs ride every third slot (15 minutes); their bars close rarely.
    const wanted = rows.filter((r) => withHourly || r.alert.timeframe === "15m");
    // The signal ledger (ledger.ts) rides the same scan; a new alert's silent first scan leaves it out.
    const ledger = only ? [] : await ledgerPairs(withHourly);
    if (!wanted.length && !ledger.length) return;

    const pairs = new Map<string, { symbol: string; timeframe: string; indicators: Set<string>; recent: number }>();
    for (const p of ledger) {
      const key = `${p.symbol}|${p.timeframe}`;
      if (!pairs.has(key)) pairs.set(key, { symbol: p.symbol, timeframe: p.timeframe, indicators: new Set(), recent: 10 });
      const pair = pairs.get(key)!;
      for (const i of p.indicators) pair.indicators.add(i);
      pair.recent = Math.max(pair.recent, p.recent);
    }
    for (const { alert } of wanted) {
      if (SCRIPT_ID.test(alert.indicator)) continue;
      const key = `${alert.symbol}|${alert.timeframe}`;
      if (!pairs.has(key)) pairs.set(key, { symbol: alert.symbol, timeframe: alert.timeframe, indicators: new Set(), recent: 10 });
      pairs.get(key)!.indicators.add(alert.indicator);
    }
    const found = new Map<string, ScanSignal[]>();
    if (pairs.size) {
      const handle = runCommand(
        "signals",
        { pairs: [...pairs.values()].map((p) => ({ ...p, indicators: [...p.indicators] })) },
        async (e) => {
          if (e.type === "signals") found.set(`${e.symbol}|${e.timeframe}|${e.indicator}`, e.signals as ScanSignal[]);
          else if (e.type === "signals_error") console.error(`signals ${e.symbol} ${e.timeframe} ${e.indicator}: ${e.message}`);
        },
      );
      const timer = setTimeout(() => handle.kill(), SCAN_TIMEOUT_MS);
      const { exitCode, stderrTail } = await handle.done.finally(() => clearTimeout(timer));
      if (exitCode !== 0) console.error(`signal scan exited ${exitCode}: ${stderrTail.trim().split("\n").slice(-2).join(" ")}`);
    }

    // Users' own scripts run here, in the same sandbox and on the same candles as the chart.
    const scriptNames = new Map<string, string>();
    for (const { alert } of wanted) {
      const id = alert.indicator.match(SCRIPT_ID)?.[1];
      const key = `${alert.symbol}|${alert.timeframe}|${alert.indicator}`;
      if (!id || found.has(key)) continue;
      const [script] = await db.select().from(userScripts).where(and(eq(userScripts.id, id), eq(userScripts.userId, alert.userId!)));
      if (!script) continue;
      scriptNames.set(alert.indicator, script.name);
      try {
        const run = await runOnSymbol(script.code, alert.symbol, alert.timeframe as ScriptTimeframe);
        if (!run.ok) {
          console.error(`script ${script.name} on ${alert.symbol} ${alert.timeframe}: ${run.error}`);
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
          })),
        );
      } catch (e) {
        console.error(`script ${script.name} on ${alert.symbol}: ${(e as Error).message}`);
      }
    }

    for (const { alert, chat } of wanted) {
      const scriptName = scriptNames.get(alert.indicator);
      const signals = found.get(`${alert.symbol}|${alert.timeframe}|${alert.indicator}`);
      if (!signals) continue; // this pair failed; try again next slot
      const known = new Map(
        (await db.select().from(signalEvents).where(eq(signalEvents.alertId, alert.id))).map((e) => [e.signalTime, e]),
      );
      // A pair may carry the ledger's backfill; alerts look at the last ten, as before.
      for (const s of signals.slice(-10)) {
        const seen = known.get(s.time);
        if (!seen) {
          const fresh = alert.primed && s.bars_ago <= STALE_BARS;
          const [row] = await db
            .insert(signalEvents)
            .values({
              alertId: alert.id,
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
          const sent = await sendTelegram(chat, openMessage(alert, s, scriptName));
          if (!sent.ok) {
            console.error(`signal alert ${alert.id}: ${sent.error}`);
            continue;
          }
          await db.update(signalEvents).set({ notifiedAt: new Date() }).where(eq(signalEvents.id, row.id));
          // Seen for the first time already finished (it fired and ended between scans).
          if (s.outcome !== "open" && (await sendTelegram(chat, closeMessage(alert, row, s.outcome, s.exit_time, scriptName))).ok) {
            await db.update(signalEvents).set({ closeNotifiedAt: new Date() }).where(eq(signalEvents.id, row.id));
          }
        } else if (seen.status === "open" && s.outcome !== "open") {
          await db.update(signalEvents).set({ status: s.outcome, exitTime: s.exit_time }).where(eq(signalEvents.id, seen.id));
          if (seen.notifiedAt && !seen.closeNotifiedAt && (await sendTelegram(chat, closeMessage(alert, seen, s.outcome, s.exit_time, scriptName))).ok) {
            await db.update(signalEvents).set({ closeNotifiedAt: new Date() }).where(eq(signalEvents.id, seen.id));
          }
        }
      }
      if (!alert.primed) await db.update(signalAlerts).set({ primed: true }).where(eq(signalAlerts.id, alert.id));
    }
    if (ledger.length) await recordLedger(found).catch((err) => console.error("signal ledger", err));
    // Daily strategies from the lab: their bars close once a day, so the hourly slots are enough.
    if (ledger.length && withHourly) await recordLedger(await ledgerScriptSignals()).catch((err) => console.error("signal ledger scripts", err));
  } finally {
    running = false;
  }
}

let lastSlot = -1;
export function startAlertScheduler() {
  const tick = () => {
    const slot = Math.floor((Date.now() - SCAN_DELAY_MS) / (SLOT_MINUTES * 60_000));
    if (slot === lastSlot) return;
    lastSlot = slot;
    scan(undefined, slot % 3 === 0).catch((err) => console.error("signal scan failed", err));
  };
  setInterval(tick, 20_000);
}

export const alertsApi = new Hono<AppEnv>();

alertsApi.get("/alerts", async (c) => {
  const user = c.get("user");
  const items = await db.select().from(signalAlerts).where(eq(signalAlerts.userId, user.id)).orderBy(asc(signalAlerts.createdAt));
  const ids = items.map((a) => a.id);
  const events = ids.length ? await db.select().from(signalEvents).where(inArray(signalEvents.alertId, ids)).orderBy(desc(signalEvents.signalTime)) : [];
  return c.json({
    items: items.map((a) => {
      const last = events.find((e) => e.alertId === a.id);
      return {
        id: a.id,
        symbol: a.symbol,
        tvSymbol: a.tvSymbol,
        indicator: a.indicator,
        timeframe: a.timeframe,
        primed: a.primed,
        last: last ? { signalTime: last.signalTime, label: last.label, status: last.status } : null,
      };
    }),
    max: MAX_ALERTS,
    combos: [
      ...COMBOS,
      ...(await db.select().from(userScripts).where(eq(userScripts.userId, user.id)).orderBy(asc(userScripts.name))).flatMap((s) =>
        SCRIPT_TFS.map((tf) => ({ indicator: `script:${s.id}`, timeframe: tf, label: `Skrip ${s.name} ${TF_LABEL[tf]}` })),
      ),
    ],
    telegram: { bot: telegramBot(), chat: Boolean(user.telegramChatId), configured: telegramBot() && Boolean(user.telegramChatId) },
  });
});

const alertSchema = z.object({
  symbol: z.string().regex(SYMBOL_PATTERN),
  tvSymbol: z.string().min(1).max(40),
  indicator: z.union([z.enum(["pob", "scalper", "fib"]), z.string().regex(SCRIPT_ID)]),
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
  } else if (!COMBOS.some((x) => x.indicator === indicator && x.timeframe === timeframe)) {
    return c.json({ error: "Kombinasi indikator dan timeframe ini belum didukung" }, 400);
  }
  const count = (await db.select({ id: signalAlerts.id }).from(signalAlerts).where(eq(signalAlerts.userId, user.id))).length;
  if (count >= MAX_ALERTS) return c.json({ error: `Maksimal ${MAX_ALERTS} notifikasi per akun` }, 409);
  const [row] = await db
    .insert(signalAlerts)
    .values({ userId: user.id, symbol: symbol.toUpperCase(), tvSymbol: tvSymbol.toUpperCase(), indicator: indicator as SignalIndicator, timeframe })
    .onConflictDoNothing()
    .returning();
  // Record what already exists now, silently, so the first message is a truly new signal.
  if (row) scan([row.id]).catch((err) => console.error("signal priming failed", err));
  return c.json({ ok: true, id: row?.id ?? null }, row ? 201 : 200);
});

alertsApi.delete("/alerts/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  await db.delete(signalAlerts).where(and(eq(signalAlerts.id, id), eq(signalAlerts.userId, c.get("user").id)));
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
