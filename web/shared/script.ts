// Custom indicator scripts: the user's own JavaScript, run in a QuickJS
// sandbox (WebAssembly) with no access to the network, files or the page.
// The same QuickJS build runs in the browser (chart) and on the server
// (Telegram alerts, the agent), and everything that decides a signal runs
// inside it (the ta.* functions below, the outcome tracking), so a script gives
// the same signals everywhere. Imported by web/client and web/server.
//
// A script sees the bars as arrays (index 0 = oldest) and calls:
//   input(name, default)            a setting the user can change
//   ta.sma/ema/rma/wma/rsi/atr/tr/stdev/highest/lowest/change/crossover/
//     crossunder/macd/bb/pivothigh/pivotlow   series helpers (NaN while warming up)
//   plot(series, title, color?)     a line on the chart
//   hline(price, title, color?)     a horizontal level
//   signal(i, "BUY"|"SELL", { sl, tp, entry?, label? })   a trade signal at bar i
// The newest bar may still be forming: signals on it are dropped.

export type ScriptBar = { time: string; open: number; high: number; low: number; close: number; volume: number };

export type ScriptSignal = {
  index: number;
  time: string;
  side: 'BUY' | 'SELL';
  label: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  outcome: 'win' | 'loss' | 'expired' | 'open';
  r: number | null;
  exitIndex: number | null;
};

export type ScriptResult = {
  signals: ScriptSignal[];
  plots: { title: string; color: string | null; values: (number | null)[] }[];
  hlines: { price: number; title: string; color: string | null }[];
  inputs: { name: string; value: number | boolean | string; default: number | boolean | string }[];
  stats: { count: number; wins: number; losses: number; expired: number; open: number; avgR: number | null };
};

export type ScriptRun = { ok: true; result: ScriptResult; ms: number } | { ok: false; error: string; ms: number };

/** What a QuickJS module offers (quickjs-emscripten-core's QuickJSWASMModule), so this file needs no import of its own. */
export type QuickJSLike = {
  evalCode(code: string, options?: { shouldInterrupt?: () => boolean; memoryLimitBytes?: number }): unknown;
};

export const SCRIPT_LIMITS = { timeMs: 3000, memoryBytes: 128 * 1024 * 1024, maxSignals: 2000, maxPlots: 8, maxCode: 40_000 };

/** The runtime the script runs on top of, evaluated inside the sandbox. */
const PRELUDE = String.raw`
"use strict";
const __in = __INPUT__;
const time = __in.bars.map((b) => b.time);
const open = __in.bars.map((b) => b.open);
const high = __in.bars.map((b) => b.high);
const low = __in.bars.map((b) => b.low);
const close = __in.bars.map((b) => b.close);
const volume = __in.bars.map((b) => b.volume);
const n = close.length;
const __plots = [];
const __hlines = [];
const __signals = [];
const __inputs = [];
const na = (v) => v === undefined || v === null || Number.isNaN(v);

function input(name, def) {
  name = String(name);
  const given = __in.inputs[name];
  const value = given !== undefined && typeof given === typeof def ? given : def;
  if (!__inputs.some((x) => x.name === name)) __inputs.push({ name, value, default: def });
  return value;
}

function __series(len, fn) {
  const out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) out[i] = fn(i);
  return out;
}

const ta = {
  sma(src, len) {
    return __series(n, (i) => {
      if (i < len - 1) return NaN;
      let s = 0;
      for (let k = i - len + 1; k <= i; k++) s += src[k];
      return s / len;
    });
  },
  ema(src, len) {
    const k = 2 / (len + 1);
    const out = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) out[i] = i === 0 || na(out[i - 1]) ? src[i] : src[i] * k + out[i - 1] * (1 - k);
    return out;
  },
  rma(src, len) {
    const out = new Array(n).fill(NaN);
    for (let i = 0; i < n; i++) out[i] = i === 0 || na(out[i - 1]) ? src[i] : (out[i - 1] * (len - 1) + src[i]) / len;
    return out;
  },
  wma(src, len) {
    const w = (len * (len + 1)) / 2;
    return __series(n, (i) => {
      if (i < len - 1) return NaN;
      let s = 0;
      for (let k = 0; k < len; k++) s += src[i - k] * (len - k);
      return s / w;
    });
  },
  tr() {
    return __series(n, (i) => (i === 0 ? high[0] - low[0] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
  },
  atr(len) {
    return ta.rma(ta.tr(), len);
  },
  rsi(src, len) {
    const up = ta.rma(src.map((v, i) => (i ? Math.max(v - src[i - 1], 0) : 0)), len);
    const dn = ta.rma(src.map((v, i) => (i ? Math.max(src[i - 1] - v, 0) : 0)), len);
    return up.map((u, i) => (dn[i] === 0 ? 100 : 100 - 100 / (1 + u / dn[i])));
  },
  stdev(src, len) {
    const m = ta.sma(src, len);
    return __series(n, (i) => {
      if (i < len - 1) return NaN;
      let s = 0;
      for (let k = i - len + 1; k <= i; k++) s += (src[k] - m[i]) ** 2;
      return Math.sqrt(s / len);
    });
  },
  highest(src, len) {
    return __series(n, (i) => (i < len - 1 ? NaN : Math.max(...src.slice(i - len + 1, i + 1))));
  },
  lowest(src, len) {
    return __series(n, (i) => (i < len - 1 ? NaN : Math.min(...src.slice(i - len + 1, i + 1))));
  },
  change(src, len = 1) {
    return __series(n, (i) => (i < len ? NaN : src[i] - src[i - len]));
  },
  crossover(a, b) {
    const bv = (i) => (typeof b === "number" ? b : b[i]);
    return __series(n, (i) => i > 0 && a[i] > bv(i) && a[i - 1] <= bv(i - 1));
  },
  crossunder(a, b) {
    const bv = (i) => (typeof b === "number" ? b : b[i]);
    return __series(n, (i) => i > 0 && a[i] < bv(i) && a[i - 1] >= bv(i - 1));
  },
  macd(src, fast = 12, slow = 26, sig = 9) {
    const f = ta.ema(src, fast);
    const s = ta.ema(src, slow);
    const line = f.map((v, i) => v - s[i]);
    const signal = ta.ema(line, sig);
    return { macd: line, signal, hist: line.map((v, i) => v - signal[i]) };
  },
  bb(src, len = 20, mult = 2) {
    const mid = ta.sma(src, len);
    const sd = ta.stdev(src, len);
    return { mid, upper: mid.map((v, i) => v + mult * sd[i]), lower: mid.map((v, i) => v - mult * sd[i]) };
  },
  // A pivot is known only len bars after it: the value sits at the bar where it becomes known.
  pivothigh(len) {
    return __series(n, (i) => {
      const j = i - len;
      if (j - len < 0) return NaN;
      for (let k = j - len; k <= j + len; k++) if (k !== j && high[k] >= high[j]) return NaN;
      return high[j];
    });
  },
  pivotlow(len) {
    return __series(n, (i) => {
      const j = i - len;
      if (j - len < 0) return NaN;
      for (let k = j - len; k <= j + len; k++) if (k !== j && low[k] <= low[j]) return NaN;
      return low[j];
    });
  },
};

function plot(series, title, color) {
  if (__plots.length >= __in.limits.maxPlots) throw new Error("terlalu banyak plot (maks " + __in.limits.maxPlots + ")");
  if (!Array.isArray(series) || series.length !== n) throw new Error("plot(): series harus array sepanjang jumlah candle");
  __plots.push({ title: String(title ?? "plot " + (__plots.length + 1)), color: color ? String(color) : null, values: series.map((v) => (na(v) ? null : Number(v))) });
}

function hline(price, title, color) {
  if (na(price)) return;
  __hlines.push({ price: Number(price), title: String(title ?? ""), color: color ? String(color) : null });
}

function signal(i, side, opts) {
  opts = opts || {};
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error("signal(): index candle tidak valid: " + i);
  if (side !== "BUY" && side !== "SELL") throw new Error('signal(): side harus "BUY" atau "SELL"');
  if (i >= n - 1) return; // the newest bar may still be forming
  const entry = na(opts.entry) ? close[i] : Number(opts.entry);
  const sl = Number(opts.sl);
  const tp = Number(opts.tp);
  if (na(sl) || na(tp)) throw new Error("signal(): sl dan tp wajib diisi");
  const dir = side === "BUY" ? 1 : -1;
  if ((entry - sl) * dir <= 0 || (tp - entry) * dir <= 0) throw new Error("signal(): untuk BUY harus sl < entry < tp, untuk SELL tp < entry < sl (candle " + time[i] + ")");
  if (__signals.length >= __in.limits.maxSignals) throw new Error("terlalu banyak sinyal (maks " + __in.limits.maxSignals + ")");
  __signals.push({ index: i, time: time[i], side, label: side + (opts.label ? " · " + String(opts.label).slice(0, 40) : ""), entry, stopLoss: sl, takeProfit: tp });
}
`;

/** Follows every signal on closed bars to its stop (first when both are touched), its target or expiry, and tallies them. */
const EPILOGUE = String.raw`
;(() => {
  const expiry = __in.expiry;
  const sigs = __signals.slice().sort((a, b) => a.index - b.index);
  for (const s of sigs) {
    const dir = s.side === "BUY" ? 1 : -1;
    const risk = Math.abs(s.entry - s.stopLoss);
    s.outcome = "open"; s.r = null; s.exitIndex = null;
    for (let k = s.index + 1; k <= n - 2; k++) {
      if (dir === 1 ? low[k] <= s.stopLoss : high[k] >= s.stopLoss) { s.outcome = "loss"; s.r = -1; s.exitIndex = k; break; }
      if (dir === 1 ? high[k] >= s.takeProfit : low[k] <= s.takeProfit) { s.outcome = "win"; s.r = Math.abs(s.takeProfit - s.entry) / risk; s.exitIndex = k; break; }
      if (k - s.index >= expiry) { s.outcome = "expired"; s.r = ((close[k] - s.entry) * dir) / risk; s.exitIndex = k; break; }
    }
  }
  const closed = sigs.filter((s) => s.r !== null);
  return {
    signals: sigs,
    plots: __plots,
    hlines: __hlines,
    inputs: __inputs,
    stats: {
      count: sigs.length,
      wins: sigs.filter((s) => s.outcome === "win").length,
      losses: sigs.filter((s) => s.outcome === "loss").length,
      expired: sigs.filter((s) => s.outcome === "expired").length,
      open: sigs.filter((s) => s.outcome === "open").length,
      avgR: closed.length ? closed.reduce((a, s) => a + s.r, 0) / closed.length : null,
    },
  };
})();
`;

/** Run a script on bars in the given sandbox. Never throws: errors come back as text. */
export function runScript(
  quickjs: QuickJSLike,
  code: string,
  bars: ScriptBar[],
  opts: { inputs?: Record<string, number | boolean | string>; expiry?: number } = {},
): ScriptRun {
  const started = Date.now();
  if (code.length > SCRIPT_LIMITS.maxCode) return { ok: false, error: `Skrip terlalu panjang (maks ${SCRIPT_LIMITS.maxCode} karakter)`, ms: 0 };
  const input = JSON.stringify({ bars, inputs: opts.inputs ?? {}, expiry: opts.expiry ?? 96, limits: SCRIPT_LIMITS });
  // The user's code runs in its own block, so its names cannot replace the runtime's.
  // A function replacement: a "$" in the data must not be read as a replacement pattern.
  const source = `${PRELUDE.replace('__INPUT__', () => input)}\n{\n${code}\n}\n${EPILOGUE}`;
  const deadline = started + SCRIPT_LIMITS.timeMs;
  try {
    const result = quickjs.evalCode(source, { shouldInterrupt: () => Date.now() > deadline, memoryLimitBytes: SCRIPT_LIMITS.memoryBytes }) as ScriptResult;
    return { ok: true, result, ms: Date.now() - started };
  } catch (e) {
    const err = e as { name?: string; message?: string; stack?: string } | string;
    const text = typeof err === 'string' ? err : `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`;
    const interrupted = Date.now() > deadline || /interrupted/i.test(text);
    return { ok: false, error: interrupted ? `Skrip melewati batas waktu ${SCRIPT_LIMITS.timeMs / 1000} detik` : text.slice(0, 500), ms: Date.now() - started };
  }
}

/** Bars from the app's candles: time as "YYYY-MM-DD HH:MM" (intraday) or "YYYY-MM-DD", the same on every side. */
export const toScriptBars = (candles: { time: string; open: number; high: number; low: number; close: number; volume: number }[]): ScriptBar[] =>
  candles.map((c) => ({ time: c.time.slice(0, 16).replace('T', ' '), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));

/** The script language in brief: shown in the editor and given to the AI that translates Pine. */
export const SCRIPT_REFERENCE = `Data (array, indeks 0 = candle tertua, n = jumlah candle): open, high, low, close, volume, time (teks "YYYY-MM-DD HH:MM").
Pengaturan: input(nama, default) -> angka/boolean/teks yang bisa diubah pengguna.
Series (array sepanjang n, NaN selama pemanasan): ta.sma(src,len) ta.ema(src,len) ta.rma(src,len) ta.wma(src,len) ta.rsi(src,len)
  ta.tr() ta.atr(len) ta.stdev(src,len) ta.highest(src,len) ta.lowest(src,len) ta.change(src,len=1)
  ta.crossover(a,b) ta.crossunder(a,b) (b boleh angka) -> array boolean
  ta.macd(src,fast=12,slow=26,signal=9) -> {macd,signal,hist}   ta.bb(src,len=20,mult=2) -> {mid,upper,lower}
  ta.pivothigh(len) ta.pivotlow(len) -> harga pivot, diletakkan di candle saat pivot baru terkonfirmasi (len candle sesudahnya), NaN di tempat lain
Gambar: plot(series, judul, warna?) (maks 8)   hline(harga, judul, warna?)
Sinyal: signal(i, "BUY"|"SELL", { sl, tp, entry?, label? }) -- entry default close[i]; BUY: sl < entry < tp, SELL: tp < entry < sl.
Aturan: sinyal di candle terakhir (masih berjalan) diabaikan; TP/SL/kedaluwarsa (96 candle) dilacak otomatis; tidak ada akses jaringan,
file atau halaman; batas 3 detik dan 128 MB. Bahasa: JavaScript biasa (const, let, for, if, Math.*).`;

export const SCRIPT_TEMPLATES: { name: string; code: string }[] = [
  {
    name: 'EMA cross + ATR',
    code: `// BUY saat EMA cepat memotong ke atas EMA lambat, SELL sebaliknya.
const fastLen = input("EMA cepat", 20);
const slowLen = input("EMA lambat", 50);
const rr = input("Risk reward", 2);
const fast = ta.ema(close, fastLen);
const slow = ta.ema(close, slowLen);
const atr = ta.atr(14);
plot(fast, "EMA cepat", "orange");
plot(slow, "EMA lambat", "royalblue");
const up = ta.crossover(fast, slow);
const down = ta.crossunder(fast, slow);
for (let i = slowLen; i < n; i++) {
  const risk = 1.5 * atr[i];
  if (up[i]) signal(i, "BUY", { sl: close[i] - risk, tp: close[i] + risk * rr, label: "EMA cross" });
  if (down[i]) signal(i, "SELL", { sl: close[i] + risk, tp: close[i] - risk * rr, label: "EMA cross" });
}`,
  },
  {
    name: 'RSI keluar oversold/overbought',
    code: `// BUY saat RSI naik keluar dari bawah 30, SELL saat turun keluar dari atas 70.
const len = input("RSI", 14);
const lo = input("Oversold", 30);
const hi = input("Overbought", 70);
const rsi = ta.rsi(close, len);
const atr = ta.atr(14);
for (let i = len + 1; i < n; i++) {
  if (rsi[i - 1] < lo && rsi[i] >= lo) signal(i, "BUY", { sl: low[i] - atr[i], tp: close[i] + 2 * atr[i], label: "RSI " + rsi[i].toFixed(0) });
  if (rsi[i - 1] > hi && rsi[i] <= hi) signal(i, "SELL", { sl: high[i] + atr[i], tp: close[i] - 2 * atr[i], label: "RSI " + rsi[i].toFixed(0) });
}`,
  },
  {
    name: 'Bollinger breakout',
    code: `// BUY saat close menembus band atas, SELL saat menembus band bawah.
const band = ta.bb(close, input("Panjang BB", 20), input("Kelipatan", 2));
plot(band.upper, "BB atas", "gray");
plot(band.mid, "BB tengah", "gray");
plot(band.lower, "BB bawah", "gray");
for (let i = 21; i < n; i++) {
  if (close[i] > band.upper[i] && close[i - 1] <= band.upper[i - 1]) signal(i, "BUY", { sl: band.mid[i], tp: close[i] + 2 * (close[i] - band.mid[i]) });
  if (close[i] < band.lower[i] && close[i - 1] >= band.lower[i - 1]) signal(i, "SELL", { sl: band.mid[i], tp: close[i] - 2 * (band.mid[i] - close[i]) });
}`,
  },
];
