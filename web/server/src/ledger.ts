// The signal ledger and its simulated account (Phase 1 of the agentic trading
// spec). Every signal the built-in engines fire on the tracked symbols is stored
// once, frozen at birth, and scored as later bars close, by the same scan that
// sends the Telegram alerts (alerts.ts), whoever watches those symbols.
//
// The simulated account follows each engine's own plan (one stop, one target)
// and pays a round-trip cost per trade (spread, fees, slippage), expressed in R
// so every signal is judged on what it would have paid after costs. Each trade
// risks the same share of the starting balance, so the equity curve is the sum
// of net R times that amount.
//
// Settings (env): SIGNAL_LEDGER_SYMBOLS (default BTC-USD,ETH-USD,GC=F),
// SIGNAL_PAPER_BALANCE (10000), SIGNAL_PAPER_RISK_PCT (1), SIGNAL_COSTS (JSON,
// per symbol {"pct": 0.0012} or {"abs": 0.4}), SIGNAL_RECAP_TIME (HH:MM WIB, 05:15).
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { isAdmin, type AppEnv } from "./auth";
import { binancePair, binancePerpetual } from "./binance";
import { db } from "./db";
import { ledgerRecaps, ledgerSignals, signalAlerts, users, type SignalStatus } from "./db/schema";
import { getCandles, SYMBOL_PATTERN } from "./market";
import { escape, publicUrl, sendTelegram } from "./watch";

export type LedgerSignal = {
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

/** The engines and timeframes the ledger follows on every tracked symbol (the notification menu's). */
export const LEDGER_COMBOS: { source: string; timeframe: "15m" | "1h" | "1d" }[] = [
  { source: "pob", timeframe: "15m" },
  { source: "pob", timeframe: "1h" },
  { source: "scalper", timeframe: "15m" },
  { source: "fib", timeframe: "15m" },
  { source: "fib", timeframe: "1h" },
  { source: "fib", timeframe: "1d" },
];
const NAMES: Record<string, string> = { pob: "PoB BYSTRA", scalper: "Scalper Pro+", fib: "Fib Golden Zone" };

export const LEDGER_SYMBOLS = (process.env.SIGNAL_LEDGER_SYMBOLS ?? "BTC-USD,ETH-USD,GC=F")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter((s) => SYMBOL_PATTERN.test(s));
const START_BALANCE = Number(process.env.SIGNAL_PAPER_BALANCE ?? 10_000);
const RISK_PCT = Number(process.env.SIGNAL_PAPER_RISK_PCT ?? 1);
const RISK_USD = (START_BALANCE * RISK_PCT) / 100;
const STALE_BARS = Number(process.env.SIGNAL_STALE_BARS ?? 4);
/** Signals asked of a pair the ledger has never seen, so its history starts filled (kept apart from live ones). */
export const BACKFILL_SIGNALS = 300;
const RECAP_TIME = /^\d{1,2}:\d{2}$/.test(process.env.SIGNAL_RECAP_TIME ?? "") ? process.env.SIGNAL_RECAP_TIME! : "05:15";
const WIB_MS = 7 * 3_600_000;

type Cost = { pct?: number; abs?: number };
const COSTS: Record<string, Cost> = (() => {
  try {
    return JSON.parse(process.env.SIGNAL_COSTS ?? "{}");
  } catch {
    console.error("SIGNAL_COSTS is not JSON; using the defaults");
    return {};
  }
})();

/**
 * Round-trip cost of one trade in price units. Taker (market orders): crypto 0.12% (fees and
 * slippage), gold 0.40 USD, others 0.10%, or SIGNAL_COSTS. Maker (limit orders at the level, for the
 * strategy lab): crypto and others 0.05%; gold stays 0.40 USD, its cost being the broker's spread.
 */
export function tradeCost(symbol: string, price: number, maker = false): number {
  if (maker) return symbol === "GC=F" ? 0.4 : 0.0005 * price;
  const c = COSTS[symbol] ?? (binancePair(symbol) ? { pct: 0.0012 } : symbol === "GC=F" ? { abs: 0.4 } : { pct: 0.001 });
  return c.abs ?? (c.pct ?? 0) * price;
}
const costOf = (symbol: string, price: number) => tradeCost(symbol, price);

/** UTC milliseconds of an exchange-local wall-clock time ("YYYY-MM-DD HH:MM" or a date) in time zone `tz`. */
function toUtc(local: string, tz: string): number {
  const guess = Date.parse(`${local.slice(0, 10)}T${local.length > 10 ? local.slice(11, 16) : "00:00"}:00Z`);
  if (tz === "UTC") return guess;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const offset = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) - guess;
  return guess - offset;
}

/** Trading session of a UTC moment: Asia 21:00-07:00, London 07:00-13:00, New York 13:00-21:00 UTC. */
const sessionOf = (ms: number) => {
  const h = new Date(ms).getUTCHours();
  return h >= 7 && h < 13 ? "london" : h >= 13 && h < 21 ? "newyork" : "asia";
};

/** Whether the engines read this symbol and timeframe from Binance (real time, UTC bar times). */
const fromBinance = (symbol: string, timeframe: "15m" | "1h" | "1d") => !!(binancePair(symbol) ?? binancePerpetual(symbol, timeframe));

const zones = new Map<string, string>();
/** The time zone the engines print a symbol's bar times in: UTC for Binance bars, else the exchange's. */
async function zoneOf(symbol: string, timeframe: "15m" | "1h" | "1d"): Promise<string> {
  if (fromBinance(symbol, timeframe)) return "UTC";
  if (!zones.has(symbol)) {
    const series = await getCandles(symbol, "6mo", "1d").catch(() => null);
    zones.set(symbol, series?.exchangeTimezone ?? "UTC");
  }
  return zones.get(symbol)!;
}

/** Pairs the ledger asks the scan for; a pair it has never recorded asks for its history too. */
export async function ledgerPairs(withHourly: boolean): Promise<{ symbol: string; timeframe: string; indicators: string[]; recent: number }[]> {
  if (!LEDGER_SYMBOLS.length) return [];
  const seen = new Set(
    (
      await db
        .selectDistinct({ source: ledgerSignals.source, symbol: ledgerSignals.symbol, timeframe: ledgerSignals.timeframe })
        .from(ledgerSignals)
        .where(inArray(ledgerSignals.symbol, LEDGER_SYMBOLS))
    ).map((r) => `${r.symbol}|${r.timeframe}|${r.source}`),
  );
  const pairs = new Map<string, { symbol: string; timeframe: string; indicators: string[]; recent: number }>();
  for (const symbol of LEDGER_SYMBOLS) {
    for (const c of LEDGER_COMBOS) {
      if (!withHourly && c.timeframe !== "15m") continue;
      const key = `${symbol}|${c.timeframe}`;
      if (!pairs.has(key)) pairs.set(key, { symbol, timeframe: c.timeframe, indicators: [], recent: 10 });
      const pair = pairs.get(key)!;
      pair.indicators.push(c.source);
      if (!seen.has(`${key}|${c.source}`)) pair.recent = BACKFILL_SIGNALS;
    }
  }
  return [...pairs.values()];
}

/** Store what a scan found for the ledger's pairs: new signals once, finished ones scored. */
export async function recordLedger(found: Map<string, LedgerSignal[]>) {
  for (const symbol of LEDGER_SYMBOLS) {
    for (const c of LEDGER_COMBOS) {
      const signals = found.get(`${symbol}|${c.timeframe}|${c.source}`);
      if (!signals?.length) continue;
      const tz = await zoneOf(symbol, c.timeframe);
      const dataSource = fromBinance(symbol, c.timeframe) ? "binance" : "yahoo";
      const rows = await db
        .select()
        .from(ledgerSignals)
        .where(
          and(
            eq(ledgerSignals.source, c.source),
            eq(ledgerSignals.symbol, symbol),
            eq(ledgerSignals.timeframe, c.timeframe),
            inArray(
              ledgerSignals.signalTime,
              signals.map((s) => s.time),
            ),
          ),
        );
      const known = new Map(rows.map((r) => [r.signalTime, r]));
      // When it finished: the exit bar's time, so history recorded late still sits where it happened.
      const closedAt = (s: LedgerSignal) => (s.exit_time ? new Date(toUtc(s.exit_time, tz)) : new Date());
      const fresh = [];
      for (const s of signals) {
        const closed = s.outcome !== "open";
        const row = known.get(s.time);
        if (row) {
          if (row.status === "open" && closed) {
            await db
              .update(ledgerSignals)
              .set({ status: s.outcome, exitTime: s.exit_time, grossR: s.r ?? null, closedAt: closedAt(s) })
              .where(eq(ledgerSignals.id, row.id));
          }
          continue;
        }
        const risk = Math.abs(s.entry - s.stop_loss);
        if (!(risk > 0)) continue;
        const at = toUtc(s.time, tz);
        fresh.push({
          source: c.source,
          symbol,
          timeframe: c.timeframe,
          signalTime: s.time,
          signalAt: new Date(at),
          session: sessionOf(at),
          side: s.side,
          label: s.label,
          entry: s.entry,
          stopLoss: s.stop_loss,
          takeProfit: s.take_profit,
          status: s.outcome,
          exitTime: s.exit_time,
          grossR: closed ? (s.r ?? null) : null,
          costR: costOf(symbol, s.entry) / risk,
          dataSource,
          live: s.bars_ago <= STALE_BARS,
          closedAt: closed ? closedAt(s) : null,
        });
      }
      if (fresh.length) await db.insert(ledgerSignals).values(fresh).onConflictDoNothing();
    }
  }
}

// --------------------------------------------------------------------------- statistics

type Row = typeof ledgerSignals.$inferSelect;
const netR = (r: Row) => (r.grossR == null ? null : r.grossR - r.costR);

export type LedgerStats = {
  key: string;
  count: number;
  closed: number;
  wins: number;
  losses: number;
  other: number;
  open: number;
  winRate: number | null;
  expectancy: number | null;
  /** The engine alone, before costs. */
  grossExpectancy: number | null;
  avgCostR: number | null;
  profitFactor: number | null;
  totalR: number;
  maxDrawdownR: number;
};

/** Win rate, expectancy (mean net R), profit factor and deepest drawdown of some signals, in closing order. */
function stats(key: string, rows: Row[]): LedgerStats {
  const done = rows.filter((r) => netR(r) != null).sort((a, b) => +(a.closedAt ?? a.signalAt) - +(b.closedAt ?? b.signalAt));
  const results = done.map((r) => netR(r)!);
  const gain = results.filter((x) => x > 0).reduce((a, x) => a + x, 0);
  const loss = -results.filter((x) => x < 0).reduce((a, x) => a + x, 0);
  let run = 0;
  let peak = 0;
  let deepest = 0;
  for (const x of results) {
    run += x;
    peak = Math.max(peak, run);
    deepest = Math.max(deepest, peak - run);
  }
  const wins = done.filter((r) => r.status === "win").length;
  const losses = done.filter((r) => r.status === "loss").length;
  return {
    key,
    count: rows.length,
    closed: done.length,
    wins,
    losses,
    other: done.length - wins - losses,
    open: rows.filter((r) => r.status === "open").length,
    winRate: done.length ? wins / done.length : null,
    expectancy: done.length ? run / done.length : null,
    grossExpectancy: done.length ? done.reduce((a, r) => a + r.grossR!, 0) / done.length : null,
    avgCostR: done.length ? done.reduce((a, r) => a + r.costR, 0) / done.length : null,
    profitFactor: loss > 0 ? gain / loss : null,
    totalR: run,
    maxDrawdownR: deepest,
  };
}

function groupStats(rows: Row[], by: (r: Row) => string): LedgerStats[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(by(r), [...(groups.get(by(r)) ?? []), r]);
  return [...groups.entries()].map(([k, list]) => stats(k, list)).sort((a, b) => b.totalR - a.totalR);
}

export const ledgerApi = new Hono<AppEnv>();

ledgerApi.get("/ledger", async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
  const withHistory = c.req.query("history") === "1";
  const filters = [gte(ledgerSignals.signalAt, new Date(Date.now() - days * 86_400_000))];
  for (const [name, column] of [
    ["symbol", ledgerSignals.symbol],
    ["source", ledgerSignals.source],
    ["timeframe", ledgerSignals.timeframe],
    ["session", ledgerSignals.session],
  ] as const) {
    const value = c.req.query(name);
    if (value) filters.push(eq(column, value));
  }
  if (!withHistory) filters.push(eq(ledgerSignals.live, true));
  const rows = await db
    .select()
    .from(ledgerSignals)
    .where(and(...filters))
    .orderBy(desc(ledgerSignals.signalAt))
    .limit(5000);

  let equity = START_BALANCE;
  const curve = rows
    .filter((r) => netR(r) != null)
    .sort((a, b) => +(a.closedAt ?? a.signalAt) - +(b.closedAt ?? b.signalAt))
    .map((r) => {
      equity += netR(r)! * RISK_USD;
      return { time: (r.closedAt ?? r.signalAt).toISOString(), equity: Math.round(equity * 100) / 100 };
    });

  return c.json({
    config: { symbols: LEDGER_SYMBOLS, startBalance: START_BALANCE, riskPct: RISK_PCT, riskUsd: RISK_USD, staleBars: STALE_BARS, days, history: withHistory },
    total: stats("total", rows),
    bySource: groupStats(rows, (r) => r.source),
    bySymbol: groupStats(rows, (r) => r.symbol),
    byTimeframe: groupStats(rows, (r) => r.timeframe),
    bySession: groupStats(rows, (r) => r.session),
    equity: curve,
    items: rows.slice(0, 150).map((r) => ({ ...r, netR: netR(r) })),
  });
});

// --------------------------------------------------------------------------- recaps

const r1 = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}R`;

/** The recap text for signals closed in [from, to). */
async function recapText(title: string, from: Date, to: Date): Promise<string> {
  const closed = await db
    .select()
    .from(ledgerSignals)
    .where(and(eq(ledgerSignals.live, true), isNotNull(ledgerSignals.closedAt), gte(ledgerSignals.closedAt, from), lt(ledgerSignals.closedAt, to)));
  const open = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerSignals)
    .where(and(eq(ledgerSignals.live, true), eq(ledgerSignals.status, "open")));
  const s = stats("total", closed);
  const lines = [`<b>${escape(title)}</b>`];
  if (!s.closed) lines.push("Belum ada sinyal yang selesai pada periode ini.");
  else {
    lines.push(`Selesai: ${s.closed} · TP ${s.wins} · SL ${s.losses}${s.other ? ` · lainnya ${s.other}` : ""}`);
    lines.push(`Hasil bersih: <b>${r1(s.totalR)}</b> (≈ ${s.totalR >= 0 ? "+" : "−"}${Math.abs(Math.round(s.totalR * RISK_USD)).toLocaleString("id-ID")} USD akun simulasi, risiko ${RISK_PCT}% per sinyal)`);
    const parts = groupStats(closed, (r) => `${NAMES[r.source] ?? r.source} ${r.timeframe === "1d" ? "harian" : r.timeframe === "1h" ? "1j" : r.timeframe}`).map(
      (g) => `${escape(g.key)} ${r1(g.totalR)} (${g.closed})`,
    );
    lines.push(`Per mesin: ${parts.join(" · ")}`);
    const bySymbol = groupStats(closed, (r) => r.symbol).map((g) => `${escape(g.key)} ${r1(g.totalR)}`);
    lines.push(`Per simbol: ${bySymbol.join(" · ")}`);
  }
  lines.push(`Masih berjalan: ${open[0]?.n ?? 0}`);
  const url = publicUrl();
  if (url) lines.push(`${url}/#/?dock=signals`);
  lines.push("<i>Hasil riset dan simulasi, bukan nasihat keuangan.</i>");
  return lines.join("\n");
}

/** Chats that get recaps: every enabled account with a Telegram chat that is an admin or watches a signal. */
async function recapChats(): Promise<string[]> {
  const rows = await db
    .select({ chat: users.telegramChatId, role: users.role, alerts: sql<number>`(select count(*)::int from ${signalAlerts} where ${signalAlerts.userId} = ${users.id})` })
    .from(users)
    .where(and(eq(users.disabled, false), isNotNull(users.telegramChatId)));
  return [...new Set(rows.filter((r) => r.chat && (r.role === "admin" || r.alerts > 0)).map((r) => r.chat!))];
}

/** Send a recap once per period: claimed in the database first, so two servers or a restart never double it. */
async function sendRecap(kind: "daily" | "weekly", period: string, title: string, from: Date, to: Date) {
  const [claimed] = await db.insert(ledgerRecaps).values({ kind, period }).onConflictDoNothing().returning();
  if (!claimed) return;
  const text = await recapText(title, from, to);
  for (const chat of await recapChats()) {
    const sent = await sendTelegram(chat, text);
    if (!sent.ok) console.error(`ledger recap ${kind} ${period}: ${sent.error}`);
  }
}

/** The daily recap for the last 24 hours, sent now to the admin's own chat, outside the schedule. */
ledgerApi.post("/ledger/recap-test", async (c) => {
  const user = c.get("user");
  if (!isAdmin(user)) return c.json({ error: "Khusus admin" }, 403);
  const now = new Date();
  const text = await recapText("Rekap sinyal harian (tes)", new Date(+now - 86_400_000), now);
  const sent = await sendTelegram(user.telegramChatId, text);
  return c.json({ ok: sent.ok, error: sent.error, text });
});

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((+t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

/** Daily recap at SIGNAL_RECAP_TIME WIB (after New York closes) for the last 24 hours; on Saturdays also the week. */
export function startLedgerRecaps() {
  const [h, m] = RECAP_TIME.split(":").map(Number);
  const tick = () => {
    const now = Date.now();
    const wib = new Date(now + WIB_MS);
    const due = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), h, m) - WIB_MS;
    // Within the hour after the due time: a server restarted later that day does not send a stale recap.
    if (now < due || now - due > 3_600_000) return;
    const day = wib.toISOString().slice(0, 10);
    const label = wib.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const to = new Date(due);
    sendRecap("daily", day, `Rekap sinyal harian · ${label}`, new Date(due - 86_400_000), to).catch((e) => console.error("ledger daily recap", e));
    if (wib.getUTCDay() === 6) {
      sendRecap("weekly", isoWeek(wib), `Rekap sinyal mingguan · s.d. ${label}`, new Date(due - 7 * 86_400_000), to).catch((e) =>
        console.error("ledger weekly recap", e),
      );
    }
  };
  setInterval(tick, 60_000);
}
