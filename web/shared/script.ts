// Custom indicator scripts: the user's own JavaScript, run in a QuickJS
// sandbox (WebAssembly) with no access to the network, files or the page.
// The same QuickJS build runs in the browser (chart) and on the server
// (Telegram alerts, the agent, the lab), and everything that decides a signal runs
// inside it (the ta.* functions below, the order and outcome tracking), so a script gives
// the same signals everywhere. Imported by web/client and web/server.
//
// The language stays close to Pine Script, so that a translated TradingView script keeps its
// meaning (ADR 0024): ta.* compute as Pine's do (rma, and so atr and rsi, seed with an SMA),
// an order can wait for its price, a signal can have two targets, and a script knows its
// timeframe, the time zone of its bars, a higher timeframe built from its own bars, and can draw.
//
// A script sees the bars as arrays (index 0 = oldest) and calls:
//   input(name, default)                                   a setting the user can change
//   ta.*                                                   series helpers (NaN while warming up)
//   plot(series, title, color?) · hline(price, title, color?)
//   line(x1, y1, x2, y2, opts?) · label(i, price, text, opts?), changed with lineSet / labelSet, removed with
//   lineDelete / labelDelete; past 500 the oldest goes, as Pine's max_lines_count
//   time, epoch, timeframe, mintick, hour/minute/dayofweek(i, tz?), session(spec, tz?), htf(minutes)
//   signal(i, "BUY"|"SELL", { sl, tp, entry?, wait?, size?, breakeven?, label?, exit?, maxBars?, exclusive? })
// The newest bar may still be forming: signals on it are dropped. SCRIPT_REFERENCE below is the
// language as the editor and the translating AI read it.
//
// A trade is counted only at prices the market traded (ADR 0023): an entry other than the close fills
// inside its bar or, with wait, on a later bar that reaches it; a bar that fills an order and reaches its
// stop is a loss there; a stop that a bar opens past fills at that open; a target never fills better
// than its own price.

export type ScriptBar = { time: string; open: number; high: number; low: number; close: number; volume: number };

export type ScriptSignal = {
  index: number;
  time: string;
  side: 'BUY' | 'SELL';
  label: string;
  entry: number;
  stopLoss: number;
  /** The last target: the only one, or the second of two. */
  takeProfit: number;
  /** Every target, one or two; the first of two closes part of the position. */
  targets: number[];
  /** market: at bar index's close; inside: inside that bar; stop / limit: a pending order that waits `wait` bars. */
  order: 'market' | 'inside' | 'stop' | 'limit';
  wait: number | null;
  /** The bar the position opened on; null while an order waits, or when it never filled. */
  fillIndex: number | null;
  /** The price it opened at: the entry, or the open of a bar that gapped past a stop order's price. */
  fill: number | null;
  /** The bar that reached the first of two targets; null with one target, or before it. */
  tp1Index: number | null;
  /** The part of the position the first of two targets closes; 1 with one target. */
  size: number;
  /** Whether reaching the first of two targets moves the stop to the fill price. */
  breakeven: boolean;
  /**
   * win = the last target, loss = the stop before any target, partial = the first of two targets and then the stop
   * or breakeven, exit = the script's exit condition, expired = the time limit, unfilled = an order that never filled.
   */
  outcome: 'win' | 'loss' | 'partial' | 'exit' | 'expired' | 'unfilled' | 'open';
  r: number | null;
  exitIndex: number | null;
};

export type ScriptLine = { x1: number; y1: number; x2: number; y2: number; color: string | null; style: 'solid' | 'dashed' | 'dotted'; width: number; extend: 'none' | 'right' };
export type ScriptLabel = { index: number; price: number; text: string; color: string | null; position: 'above' | 'below' };

export type ScriptResult = {
  signals: ScriptSignal[];
  plots: { title: string; color: string | null; values: (number | null)[] }[];
  hlines: { price: number; title: string; color: string | null }[];
  lines: ScriptLine[];
  labels: ScriptLabel[];
  inputs: { name: string; value: number | boolean | string; default: number | boolean | string }[];
  /**
   * wins and losses: closed with R above zero or not; tp, sl, partial, exits, expired: how they closed;
   * unfilled: orders that never filled, both the pending ones that ran out of time and entries their bar never traded.
   */
  stats: {
    count: number;
    wins: number;
    losses: number;
    tp: number;
    sl: number;
    partial: number;
    exits: number;
    expired: number;
    open: number;
    unfilled: number;
    avgR: number | null;
  };
};

export type ScriptRun = { ok: true; result: ScriptResult; ms: number } | { ok: false; error: string; ms: number };

/** What a QuickJS module offers (quickjs-emscripten-core's QuickJSWASMModule), so this file needs no import of its own. */
export type QuickJSLike = {
  evalCode(code: string, options?: { shouldInterrupt?: () => boolean; memoryLimitBytes?: number }): unknown;
};

export const SCRIPT_LIMITS = { timeMs: 3000, memoryBytes: 128 * 1024 * 1024, maxSignals: 2000, maxPlots: 8, maxLines: 500, maxLabels: 500, maxCode: 40_000 };

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
const epoch = __in.epoch;
const timeframe = __in.timeframe == null ? NaN : __in.timeframe;
const mintick = __in.mintick;
const hl2 = high.map((h, i) => (h + low[i]) / 2);
const hlc3 = high.map((h, i) => (h + low[i] + close[i]) / 3);
const ohlc4 = high.map((h, i) => (open[i] + h + low[i] + close[i]) / 4);
const __plots = [];
const __hlines = [];
const __signals = [];
const __inputs = [];
// Drawings by id; a deleted one is null. Past the limit the oldest goes, as Pine's max_lines_count and max_labels_count do.
const __lines = [];
const __labels = [];
const __drawn = { lines: { first: 0, live: 0 }, labels: { first: 0, live: 0 } };
function __add(list, count, item, max) {
  if (count.live >= max) {
    while (list[count.first] === null) count.first++;
    list[count.first++] = null;
    count.live--;
  }
  list.push(item);
  count.live++;
  return list.length - 1;
}
function __drawing(list, id, what) {
  if (id === undefined || id === null || Number.isNaN(id)) return null; // Pine's na id: nothing to change
  if (!Number.isInteger(id) || id < 0 || id >= list.length) throw new Error(what + " " + id + " tidak ada");
  return list[id];
}
function __remove(list, count, id) {
  if (Number.isInteger(id) && list[id]) {
    list[id] = null;
    count.live--;
  }
}
const na = (v) => v === undefined || v === null || Number.isNaN(v);
function nz(v, r) {
  const d = r === undefined ? 0 : r;
  return Array.isArray(v) ? v.map((x) => (na(x) ? d : x)) : na(v) ? d : v;
}
const __map = (m, fn) => {
  const out = new Array(m);
  for (let i = 0; i < m; i++) out[i] = fn(i);
  return out;
};
// Minutes since 1970 of each bar on the wall clock its times are written in (the exchange's).
const __wallOf = (t) => Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), t.length > 10 ? +t.slice(11, 13) : 0, t.length > 10 ? +t.slice(14, 16) : 0) / 60000;
const __wall = time.map(__wallOf);

function input(name, def) {
  name = String(name);
  const given = __in.inputs[name];
  const value = given !== undefined && typeof given === typeof def ? given : def;
  if (!__inputs.some((x) => x.name === name)) __inputs.push({ name, value, default: def });
  return value;
}

const __chart = { open, high, low, close, volume, time };
const __b = (b) => b || __chart;
function __pivot(a, b, c, def, sign) {
  let src = def;
  let left;
  let right;
  if (Array.isArray(a)) {
    src = a;
    left = b;
    right = c;
  } else if (b === undefined) {
    left = a;
    right = a;
  } else {
    left = a;
    right = b;
  }
  // A pivot is known only right bars after it: the value sits at the bar where it becomes known.
  return __map(src.length, (i) => {
    const j = i - right;
    if (j - left < 0) return NaN;
    for (let k = j - left; k <= j + right; k++) if (k !== j && (sign > 0 ? src[k] >= src[j] : src[k] <= src[j])) return NaN;
    return src[j];
  });
}

const ta = {
  sma(src, len) {
    return __map(src.length, (i) => {
      if (i < len - 1) return NaN;
      let s = 0;
      for (let k = i - len + 1; k <= i; k++) s += src[k];
      return s / len;
    });
  },
  ema(src, len) {
    const k = 2 / (len + 1);
    const out = new Array(src.length).fill(NaN);
    for (let i = 0; i < src.length; i++) out[i] = i === 0 || na(out[i - 1]) ? src[i] : src[i] * k + out[i - 1] * (1 - k);
    return out;
  },
  // As Pine's: seeded with the SMA of its first len values, NaN before.
  rma(src, len) {
    const seed = ta.sma(src, len);
    const out = new Array(src.length).fill(NaN);
    for (let i = 0; i < src.length; i++) out[i] = i > 0 && !na(out[i - 1]) ? (src[i] + (len - 1) * out[i - 1]) / len : seed[i];
    return out;
  },
  wma(src, len) {
    const w = (len * (len + 1)) / 2;
    return __map(src.length, (i) => {
      if (i < len - 1) return NaN;
      let s = 0;
      for (let k = 0; k < len; k++) s += src[i - k] * (len - k);
      return s / w;
    });
  },
  vwma(src, len, vol) {
    const v = vol || volume;
    const pv = ta.sma(src.map((x, i) => x * v[i]), len);
    const vv = ta.sma(v.slice(0, src.length), len);
    return pv.map((x, i) => x / vv[i]);
  },
  hma(src, len) {
    const half = ta.wma(src, Math.floor(len / 2));
    const full = ta.wma(src, len);
    return ta.wma(half.map((h, i) => 2 * h - full[i]), Math.floor(Math.sqrt(len)));
  },
  rsi(src, len) {
    const up = ta.rma(src.map((v, i) => (i ? Math.max(v - src[i - 1], 0) : NaN)), len);
    const dn = ta.rma(src.map((v, i) => (i ? Math.max(src[i - 1] - v, 0) : NaN)), len);
    return up.map((u, i) => (na(u) || na(dn[i]) ? NaN : dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i])));
  },
  tr(b) {
    const x = __b(b);
    return __map(x.close.length, (i) => (i === 0 ? x.high[0] - x.low[0] : Math.max(x.high[i] - x.low[i], Math.abs(x.high[i] - x.close[i - 1]), Math.abs(x.low[i] - x.close[i - 1]))));
  },
  atr(len, b) {
    return ta.rma(ta.tr(b), len);
  },
  stdev(src, len) {
    const m = ta.sma(src, len);
    return __map(src.length, (i) => {
      if (i < len - 1) return NaN;
      let s = 0;
      for (let k = i - len + 1; k <= i; k++) s += (src[k] - m[i]) ** 2;
      return Math.sqrt(s / len);
    });
  },
  dev(src, len) {
    const m = ta.sma(src, len);
    return __map(src.length, (i) => {
      if (i < len - 1) return NaN;
      let s = 0;
      for (let k = i - len + 1; k <= i; k++) s += Math.abs(src[k] - m[i]);
      return s / len;
    });
  },
  highest(a, b) {
    const src = typeof a === "number" ? high : a;
    const len = typeof a === "number" ? a : b;
    return __map(src.length, (i) => (i < len - 1 ? NaN : Math.max(...src.slice(i - len + 1, i + 1))));
  },
  lowest(a, b) {
    const src = typeof a === "number" ? low : a;
    const len = typeof a === "number" ? a : b;
    return __map(src.length, (i) => (i < len - 1 ? NaN : Math.min(...src.slice(i - len + 1, i + 1))));
  },
  change(src, len = 1) {
    return __map(src.length, (i) => (i < len ? NaN : src[i] - src[i - len]));
  },
  mom(src, len) {
    return ta.change(src, len);
  },
  roc(src, len) {
    return __map(src.length, (i) => (i < len ? NaN : (100 * (src[i] - src[i - len])) / src[i - len]));
  },
  crossover(a, b) {
    const bv = (i) => (typeof b === "number" ? b : b[i]);
    return __map(a.length, (i) => i > 0 && a[i] > bv(i) && a[i - 1] <= bv(i - 1));
  },
  crossunder(a, b) {
    const bv = (i) => (typeof b === "number" ? b : b[i]);
    return __map(a.length, (i) => i > 0 && a[i] < bv(i) && a[i - 1] >= bv(i - 1));
  },
  cross(a, b) {
    const up = ta.crossover(a, b);
    const down = ta.crossunder(a, b);
    return up.map((x, i) => x || down[i]);
  },
  rising(src, len) {
    return __map(src.length, (i) => {
      if (i < len) return false;
      for (let k = i - len; k < i; k++) if (!(src[i] > src[k])) return false;
      return true;
    });
  },
  falling(src, len) {
    return __map(src.length, (i) => {
      if (i < len) return false;
      for (let k = i - len; k < i; k++) if (!(src[i] < src[k])) return false;
      return true;
    });
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
  stoch(src, h, l, len) {
    const hh = ta.highest(h, len);
    const ll = ta.lowest(l, len);
    return src.map((v, i) => (100 * (v - ll[i])) / (hh[i] - ll[i]));
  },
  cci(src, len) {
    const m = ta.sma(src, len);
    const d = ta.dev(src, len);
    return src.map((v, i) => (v - m[i]) / (0.015 * d[i]));
  },
  fixnan(src) {
    let last = NaN;
    return src.map((x) => (na(x) ? last : (last = x)));
  },
  dmi(diLen, adxLen, b) {
    const x = __b(b);
    const up = ta.change(x.high);
    const down = ta.change(x.low).map((v) => -v);
    const plusDM = up.map((u, i) => (na(u) ? NaN : u > down[i] && u > 0 ? u : 0));
    const minusDM = down.map((d, i) => (na(d) ? NaN : d > up[i] && d > 0 ? d : 0));
    const trur = ta.rma(ta.tr(b), diLen);
    const plus = ta.fixnan(ta.rma(plusDM, diLen).map((v, i) => (100 * v) / trur[i]));
    const minus = ta.fixnan(ta.rma(minusDM, diLen).map((v, i) => (100 * v) / trur[i]));
    const adx = ta.rma(plus.map((p, i) => Math.abs(p - minus[i]) / (p + minus[i] === 0 ? 1 : p + minus[i])), adxLen).map((v) => 100 * v);
    return { plus, minus, adx };
  },
  // As Pine's ta.supertrend: direction -1 while the trend is up (line below price), 1 while it is down.
  supertrend(factor, atrLen, b) {
    const x = __b(b);
    const c = x.close;
    const atr = ta.atr(atrLen, b);
    const line = new Array(c.length).fill(NaN);
    const direction = new Array(c.length).fill(NaN);
    let prevLower = NaN;
    let prevUpper = NaN;
    let prevLine = NaN;
    for (let i = 0; i < c.length; i++) {
      const mid = (x.high[i] + x.low[i]) / 2;
      const pl = na(prevLower) ? 0 : prevLower;
      const pu = na(prevUpper) ? 0 : prevUpper;
      let lower = mid - factor * atr[i];
      let upper = mid + factor * atr[i];
      lower = lower > pl || (i > 0 && c[i - 1] < pl) ? lower : pl;
      upper = upper < pu || (i > 0 && c[i - 1] > pu) ? upper : pu;
      let d;
      if (i === 0 || na(atr[i - 1])) d = 1;
      else if (prevLine === pu) d = c[i] > upper ? -1 : 1;
      else d = c[i] < lower ? 1 : -1;
      line[i] = d === -1 ? lower : upper;
      direction[i] = d;
      prevLower = lower;
      prevUpper = upper;
      prevLine = line[i];
    }
    return { line, direction };
  },
  pivothigh(a, b, c) {
    return __pivot(a, b, c, high, 1);
  },
  pivotlow(a, b, c) {
    return __pivot(a, b, c, low, -1);
  },
  barssince(cond) {
    let last = -1;
    return cond.map((x, i) => {
      if (x) last = i;
      return last < 0 ? NaN : i - last;
    });
  },
  valuewhen(cond, src, occurrence = 0) {
    const seen = [];
    return cond.map((x, i) => {
      if (x) seen.push(src[i]);
      return seen.length > occurrence ? seen[seen.length - 1 - occurrence] : NaN;
    });
  },
  cum(src) {
    let s = 0;
    return src.map((x) => (s += na(x) ? 0 : x));
  },
  linreg(src, len, offset = 0) {
    return __map(src.length, (i) => {
      if (i < len - 1) return NaN;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (let k = 0; k < len; k++) {
        const y = src[i - len + 1 + k];
        sx += k;
        sy += y;
        sxx += k * k;
        sxy += k * y;
      }
      const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx);
      return (sy - slope * sx) / len + slope * (len - 1 - offset);
    });
  },
  obv(b) {
    const x = __b(b);
    return ta.cum(x.close.map((c, i) => (i === 0 ? NaN : Math.sign(c - x.close[i - 1]) * x.volume[i])));
  },
  // Volume-weighted average price, started again each exchange day.
  vwap(src, b) {
    const x = __b(b);
    const s = src || x.high.map((h, i) => (h + x.low[i] + x.close[i]) / 3);
    let pv = 0;
    let vv = 0;
    let day = "";
    return s.map((v, i) => {
      const d = x.time[i].slice(0, 10);
      if (d !== day) {
        day = d;
        pv = 0;
        vv = 0;
      }
      pv += v * x.volume[i];
      vv += x.volume[i];
      return pv / vv;
    });
  },
};

// Time zones a script may name: fixed ones, and New York, Chicago and Europe with their daylight saving rules.
const __FIXED = {
  UTC: 0, "Etc/UTC": 0, GMT: 0, "Asia/Jakarta": 420, "Asia/Bangkok": 420, "Asia/Ho_Chi_Minh": 420, "Asia/Pontianak": 420,
  "Asia/Makassar": 480, "Asia/Singapore": 480, "Asia/Kuala_Lumpur": 480, "Asia/Hong_Kong": 480, "Asia/Shanghai": 480,
  "Asia/Taipei": 480, "Asia/Manila": 480, "Australia/Perth": 480, "Asia/Jayapura": 540, "Asia/Tokyo": 540, "Asia/Seoul": 540,
  "Asia/Kolkata": 330, "Asia/Dubai": 240,
};
const __DST = {
  "America/New_York": [-300, "us"], "America/Chicago": [-360, "us"], "Europe/London": [0, "eu"], "Europe/Berlin": [60, "eu"],
  "Europe/Paris": [60, "eu"], "Europe/Amsterdam": [60, "eu"], "Europe/Zurich": [60, "eu"], "Europe/Madrid": [60, "eu"],
};
function __offset(ms, tz) {
  if (Object.prototype.hasOwnProperty.call(__FIXED, tz)) return __FIXED[tz];
  const m = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(tz);
  if (m) return (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0));
  const d = __DST[tz];
  if (!d) throw new Error("zona waktu tidak dikenal: " + tz + ". Pakai misalnya Asia/Jakarta, UTC, UTC+7, America/New_York atau Europe/London.");
  const y = new Date(ms).getUTCFullYear();
  let start;
  let end;
  if (d[1] === "us") {
    // From the second Sunday of March 02:00 to the first Sunday of November 02:00, local time.
    start = Date.UTC(y, 2, 8 + ((7 - new Date(Date.UTC(y, 2, 8)).getUTCDay()) % 7), 2) - d[0] * 60000;
    end = Date.UTC(y, 10, 1 + ((7 - new Date(Date.UTC(y, 10, 1)).getUTCDay()) % 7), 2) - (d[0] + 60) * 60000;
  } else {
    // From the last Sunday of March to the last Sunday of October, 01:00 UTC.
    const lastSunday = (mo) => {
      const e = new Date(Date.UTC(y, mo + 1, 0));
      return Date.UTC(y, mo, e.getUTCDate() - e.getUTCDay(), 1);
    };
    start = lastSunday(2);
    end = lastSunday(9);
  }
  return d[0] + (ms >= start && ms < end ? 60 : 0);
}
// A bar's open on the wall clock of a zone, in ms; no zone = the zone its times are written in.
function __local(i, tz) {
  if (tz === undefined || tz === null || tz === "") return __wall[i] * 60000;
  return epoch[i] + __offset(epoch[i], String(tz)) * 60000;
}
function hour(i, tz) {
  return new Date(__local(i, tz)).getUTCHours();
}
function minute(i, tz) {
  return new Date(__local(i, tz)).getUTCMinutes();
}
// 1 = Sunday ... 7 = Saturday, as Pine's dayofweek.
function dayofweek(i, tz) {
  return new Date(__local(i, tz)).getUTCDay() + 1;
}
// Pine's session strings: "HHMM-HHMM", the end left out, optionally ":1234567" for the days (1 = Sunday).
function session(spec, tz) {
  const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})(?::([1-7]+))?$/.exec(String(spec).trim());
  if (!m) throw new Error('session(): tulis jamnya "HHMM-HHMM", misalnya session("1500-1900", "Asia/Jakarta")');
  const a = +m[1] * 60 + +m[2];
  const b = +m[3] * 60 + +m[4];
  const days = m[5] ? m[5].split("").map(Number) : null;
  return __map(n, (i) => {
    const d = new Date(__local(i, tz));
    const t = d.getUTCHours() * 60 + d.getUTCMinutes();
    const inside = a < b ? t >= a && t < b : t >= a || t < b;
    return inside && (!days || days.includes(d.getUTCDay() + 1));
  });
}

// A higher timeframe built from these bars, on the exchange's clock (weeks start on Monday).
function htf(minutes) {
  minutes = Number(minutes);
  if (!(minutes >= 1)) throw new Error("htf(): isi menit timeframe yang lebih tinggi, misalnya htf(60) atau htf(240)");
  if (Number.isFinite(timeframe) && minutes < timeframe) throw new Error("htf(" + minutes + "): harus sama atau lebih tinggi dari timeframe chart (" + timeframe + " menit)");
  const bucket = (m) => (minutes >= 10080 ? Math.floor((Math.floor(m / 1440) + 3) / 7) : Math.floor(m / minutes));
  const o = [];
  const h = [];
  const l = [];
  const c = [];
  const v = [];
  const t = [];
  const start = [];
  const index = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || bucket(__wall[i]) !== bucket(__wall[i - 1])) {
      o.push(open[i]);
      h.push(high[i]);
      l.push(low[i]);
      c.push(close[i]);
      v.push(volume[i]);
      t.push(time[i]);
      start.push(i);
    } else {
      const k = c.length - 1;
      h[k] = Math.max(h[k], high[i]);
      l[k] = Math.min(l[k], low[i]);
      c[k] = close[i];
      v[k] += volume[i];
    }
    index[i] = c.length - 1;
  }
  // The chart bar that ends a higher bar, known from the clock: the next slot falls in a new one.
  const ends = __wall.map((m) => Number.isFinite(timeframe) && bucket(m + timeframe) !== bucket(m));
  return {
    n: c.length, open: o, high: h, low: l, close: c, volume: v, time: t, start, index,
    // request.security(..., expr[1], lookahead_on): the last closed higher bar, never the one still forming.
    closed(series) {
      return index.map((k) => (k > 0 ? series[k - 1] : NaN));
    },
    // request.security(..., expr): a higher bar's value from the chart bar that ends it, the one before until then.
    value(series) {
      return index.map((k, i) => (ends[i] ? series[k] : k > 0 ? series[k - 1] : NaN));
    },
  };
}

function plot(series, title, color) {
  if (__plots.length >= __in.limits.maxPlots) throw new Error("terlalu banyak plot (maks " + __in.limits.maxPlots + ")");
  if (!Array.isArray(series) || series.length !== n) throw new Error("plot(): series harus array sepanjang jumlah candle (pakai h.closed() untuk data htf)");
  __plots.push({ title: String(title ?? "plot " + (__plots.length + 1)), color: color ? String(color) : null, values: series.map((v) => (na(v) ? null : Number(v))) });
}

function hline(price, title, color) {
  if (na(price)) return;
  __hlines.push({ price: Number(price), title: String(title ?? ""), color: color ? String(color) : null });
}

function __lineProps(l, p) {
  for (const k of ["x1", "y1", "x2", "y2"]) if (p[k] !== undefined) l[k] = Number(p[k]);
  if (!Number.isInteger(l.x1) || !Number.isInteger(l.x2) || l.x1 < 0 || l.x2 < 0) throw new Error("line(): x1 dan x2 harus nomor candle (bilangan bulat, 0 atau lebih)");
  if (na(l.y1) || na(l.y2)) throw new Error("line(): y1 dan y2 harus harga");
  if (p.color !== undefined) l.color = p.color ? String(p.color).slice(0, 32) : null;
  if (p.style !== undefined) {
    if (p.style !== "solid" && p.style !== "dashed" && p.style !== "dotted") throw new Error('line(): style harus "solid", "dashed" atau "dotted"');
    l.style = p.style;
  }
  if (p.width !== undefined) l.width = Math.max(1, Math.min(4, Math.round(Number(p.width)) || 1));
  if (p.extend !== undefined) l.extend = p.extend === "right" ? "right" : "none";
  return l;
}
function line(x1, y1, x2, y2, opts) {
  return __add(__lines, __drawn.lines, __lineProps({ x1, y1, x2, y2, color: null, style: "solid", width: 1, extend: "none" }, opts || {}), __in.limits.maxLines);
}
function lineSet(id, props) {
  const l = __drawing(__lines, id, "lineSet(): garis");
  if (l) __lineProps(l, props || {});
}
function lineDelete(id) {
  __remove(__lines, __drawn.lines, id);
}
function __labelProps(l, p) {
  if (p.index !== undefined) l.index = Number(p.index);
  if (p.price !== undefined) l.price = Number(p.price);
  if (p.text !== undefined) l.text = String(p.text).slice(0, 80);
  if (p.color !== undefined) l.color = p.color ? String(p.color).slice(0, 32) : null;
  if (p.position !== undefined) l.position = p.position === "below" ? "below" : "above";
  if (!Number.isInteger(l.index) || l.index < 0 || l.index >= n) throw new Error("label(): nomor candle tidak valid: " + l.index);
  if (na(l.price)) throw new Error("label(): harga wajib diisi");
  return l;
}
function label(i, price, text, opts) {
  return __add(__labels, __drawn.labels, __labelProps({ index: i, price, text: String(text ?? "").slice(0, 80), color: null, position: "above" }, opts || {}), __in.limits.maxLabels);
}
function labelSet(id, props) {
  const l = __drawing(__labels, id, "labelSet(): label");
  if (l) __labelProps(l, props || {});
}
function labelDelete(id) {
  __remove(__labels, __drawn.labels, id);
}

function signal(i, side, opts) {
  opts = opts || {};
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error("signal(): index candle tidak valid: " + i);
  if (side !== "BUY" && side !== "SELL") throw new Error('signal(): side harus "BUY" atau "SELL"');
  if (i >= n - 1) return; // the newest bar may still be forming
  const entry = na(opts.entry) ? close[i] : Number(opts.entry);
  const sl = Number(opts.sl);
  const targets = (Array.isArray(opts.tp) ? opts.tp : [opts.tp]).map(Number);
  if (na(sl) || targets.length < 1 || targets.length > 2 || targets.some(na)) throw new Error("signal(): sl dan tp wajib diisi (tp boleh dua target: [tp1, tp2])");
  const dir = side === "BUY" ? 1 : -1;
  if ((entry - sl) * dir <= 0 || (targets[0] - entry) * dir <= 0 || (targets.length === 2 && (targets[1] - targets[0]) * dir < 0)) {
    throw new Error("signal(): untuk BUY harus sl < entry < tp1 <= tp2, untuk SELL tp2 <= tp1 < entry < sl (candle " + time[i] + ")");
  }
  const wait = opts.wait === undefined || opts.wait === null ? null : Number(opts.wait);
  if (wait !== null && !(Number.isInteger(wait) && wait >= 1 && wait <= 500)) throw new Error("signal(): wait harus bilangan bulat 1 sampai 500 (berapa candle order menunggu)");
  const size = opts.size === undefined ? 0.5 : Number(opts.size);
  if (targets.length === 2 && !(size > 0 && size < 1)) throw new Error("signal(): size (bagian yang ditutup di tp1) harus di antara 0 dan 1, misalnya 0.5");
  if (opts.exit !== undefined && (!Array.isArray(opts.exit) || opts.exit.length !== n)) throw new Error("signal(): exit harus array sepanjang jumlah candle");
  const maxBars = opts.maxBars === undefined ? null : Number(opts.maxBars);
  if (maxBars !== null && !(Number.isInteger(maxBars) && maxBars >= 1 && maxBars <= 2000)) throw new Error("signal(): maxBars harus bilangan bulat 1 sampai 2000");
  if (__signals.length >= __in.limits.maxSignals) throw new Error("terlalu banyak sinyal (maks " + __in.limits.maxSignals + ")");
  const order = entry === close[i] ? "market" : wait === null ? "inside" : (entry - close[i]) * dir > 0 ? "stop" : "limit";
  __signals.push({
    index: i, time: time[i], side, label: side + (opts.label ? " · " + String(opts.label).slice(0, 40) : ""), entry, stopLoss: sl, targets,
    size: targets.length === 2 ? size : 1, breakeven: opts.breakeven !== false, order, wait: order === "stop" || order === "limit" ? wait : null,
    exit: opts.exit || null, maxBars, exclusive: opts.exclusive === true,
  });
}
`;

/**
 * Follows every signal on closed bars. An order fills first: a market order at its bar's close, an entry
 * inside its bar where that bar traded it (or not at all), a pending order on the first bar of its wait that
 * reaches it (a stop at the open when a bar opens past it, a limit at its own price). From the fill, in a bar's
 * order: the stop (first when the stop and a target are both touched; breakeven from the bar after the first of
 * two targets), the targets, the exit condition at the close, the time limit at the close. A bar that fills an
 * order and reaches its stop is a loss there, since the order within a bar is unknown; a bar that fills a stop
 * order and reaches a target counts it, since price passed the entry first, while a limit order's fill bar may
 * have reached the target before the entry and does not. A stop that a bar opens past fills at that open; a
 * target never fills better than its own price. An exclusive signal is skipped while the previous one is open or
 * still waiting to fill, as Pine's one position at a time. Then tallies them.
 */
const EPILOGUE = String.raw`
;(() => {
  const sigs = __signals.slice().sort((a, b) => a.index - b.index);
  const kept = [];
  let freeFrom = 0;
  let unfilled = 0;
  const out = (s, outcome, r, exitIndex, fillIndex, fill, tp1Index) => ({
    index: s.index, time: s.time, side: s.side, label: s.label, entry: s.entry, stopLoss: s.stopLoss,
    takeProfit: s.targets[s.targets.length - 1], targets: s.targets, order: s.order, wait: s.wait, fillIndex,
    fill: fillIndex === null ? null : fill, tp1Index, size: s.size, breakeven: s.breakeven, outcome, r, exitIndex,
  });
  for (const s of sigs) {
    if (s.exclusive && s.index < freeFrom) continue;
    const i = s.index;
    const dir = s.side === "BUY" ? 1 : -1;
    const risk = Math.abs(s.entry - s.stopLoss);
    const life = s.maxBars === null ? __in.expiry : s.maxBars;
    const last = s.targets[s.targets.length - 1];
    let fillIndex = null;
    let fill = NaN;
    if (s.order === "market") {
      fillIndex = i;
      fill = s.entry;
    } else if (s.order === "inside") {
      if (s.entry > high[i] || s.entry < low[i]) {
        unfilled++;
        continue;
      }
      fillIndex = i;
      fill = s.entry;
    } else {
      const lastBar = Math.min(i + s.wait, n - 2);
      for (let k = i + 1; k <= lastBar; k++) {
        const hit = s.order === "stop" ? (dir === 1 ? high[k] >= s.entry : low[k] <= s.entry) : dir === 1 ? low[k] <= s.entry : high[k] >= s.entry;
        if (!hit) continue;
        fillIndex = k;
        fill = s.order === "stop" ? (dir === 1 ? Math.max(open[k], s.entry) : Math.min(open[k], s.entry)) : s.entry;
        break;
      }
      if (fillIndex === null) {
        const expired = i + s.wait <= n - 2;
        if (expired) unfilled++;
        freeFrom = expired ? i + s.wait + 1 : Infinity;
        kept.push(out(s, expired ? "unfilled" : "open", null, expired ? i + s.wait : null, null, NaN, null));
        continue;
      }
    }
    const share = s.targets.length === 2 ? s.size : 1;
    const rAt = (price) => ((price - fill) * dir) / risk;
    let outcome = "open";
    let r = null;
    let exitIndex = null;
    let firstHit = false;
    let tp1Index = null;
    let realized = 0;
    if (s.order !== "market" && (dir === 1 ? low[fillIndex] <= s.stopLoss : high[fillIndex] >= s.stopLoss)) {
      outcome = "loss";
      r = rAt(s.stopLoss);
      exitIndex = fillIndex;
    }
    // A stop order's fill bar: price went through the entry on its way to anything beyond it, so a target that bar
    // reached was reached after the fill (breakeven starts on the next bar, as a strategy moves its stop at the close).
    // A limit order's fill bar may have reached the target before it came back to the entry, so that one waits.
    const reach = (k, price) => (dir === 1 ? high[k] >= price : low[k] <= price);
    if (outcome === "open" && s.order === "stop" && (s.targets[0] - fill) * dir > 0 && reach(fillIndex, s.targets[0])) {
      if (s.targets.length === 2) {
        firstHit = true;
        tp1Index = fillIndex;
        realized = share * rAt(s.targets[0]);
      }
      if (s.targets.length === 1 || reach(fillIndex, last)) {
        r = realized + (1 - (s.targets.length === 2 ? share : 0)) * rAt(last);
        outcome = "win";
        exitIndex = fillIndex;
      }
    }
    for (let k = fillIndex + 1; outcome === "open" && k <= n - 2; k++) {
      const left = 1 - (firstHit ? share : 0);
      const stop = firstHit && s.breakeven ? fill : s.stopLoss;
      if (dir === 1 ? low[k] <= stop : high[k] >= stop) {
        r = realized + left * rAt(dir === 1 ? Math.min(open[k], stop) : Math.max(open[k], stop));
        outcome = firstHit ? "partial" : "loss";
        exitIndex = k;
        break;
      }
      if (!firstHit && (dir === 1 ? high[k] >= s.targets[0] : low[k] <= s.targets[0])) {
        if (s.targets.length === 1) {
          r = rAt(s.targets[0]);
          outcome = "win";
          exitIndex = k;
          break;
        }
        firstHit = true;
        tp1Index = k;
        realized = share * rAt(s.targets[0]);
      }
      if (firstHit && (dir === 1 ? high[k] >= last : low[k] <= last)) {
        r = realized + (1 - share) * rAt(last);
        outcome = "win";
        exitIndex = k;
        break;
      }
      const rest = 1 - (firstHit ? share : 0);
      if (s.exit && s.exit[k]) {
        r = realized + rest * rAt(close[k]);
        outcome = "exit";
        exitIndex = k;
        break;
      }
      if (k - fillIndex >= life) {
        r = realized + rest * rAt(close[k]);
        outcome = "expired";
        exitIndex = k;
        break;
      }
    }
    freeFrom = exitIndex === null ? Infinity : exitIndex;
    kept.push(out(s, outcome, r, exitIndex, fillIndex, fill, tp1Index));
  }
  const closed = kept.filter((s) => s.r !== null);
  const count = (outcome) => kept.filter((s) => s.outcome === outcome).length;
  return {
    signals: kept,
    plots: __plots,
    hlines: __hlines,
    lines: __lines.filter(Boolean),
    labels: __labels.filter(Boolean),
    inputs: __inputs,
    stats: {
      count: kept.length,
      wins: closed.filter((s) => s.r > 0).length,
      losses: closed.filter((s) => s.r <= 0).length,
      tp: count("win"),
      sl: count("loss"),
      partial: count("partial"),
      exits: count("exit"),
      expired: count("expired"),
      open: count("open"),
      unfilled,
      avgR: closed.length ? closed.reduce((a, s) => a + s.r, 0) / closed.length : null,
    },
  };
})();
`;

/** Minutes per bar of the timeframes the app uses. */
const TF_MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1wk': 10080, '1mo': 43200 };

/** Minutes per bar: the timeframe given, else the commonest gap between the bars. */
function minutesOf(timeframe: string | number | undefined, epochs: number[]): number | null {
  if (typeof timeframe === 'number' && timeframe > 0) return timeframe;
  if (typeof timeframe === 'string' && TF_MINUTES[timeframe]) return TF_MINUTES[timeframe];
  const gaps = new Map<number, number>();
  for (let i = 1; i < Math.min(epochs.length, 300); i++) {
    const g = Math.round((epochs[i] - epochs[i - 1]) / 60000);
    if (g > 0) gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 0;
  for (const [g, c] of gaps) {
    if (c > most || (c === most && best !== null && g < best)) {
      best = g;
      most = c;
    }
  }
  return best;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
/** Minutes a zone is ahead of UTC at an instant, from the host's own zone data. */
function zoneOffset(ms: number, tz: string): number {
  let f = zoneFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    zoneFormats.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - ms) / 60000);
}

const wallOf = (t: string) =>
  Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), t.length > 10 ? +t.slice(11, 13) : 0, t.length > 10 ? +t.slice(14, 16) : 0);

/** Each bar's open in UTC milliseconds, from its wall-clock time in the zone the bars are written in (UTC when unknown). */
export function barEpochs(times: string[], tz?: string | null): number[] {
  const wall = times.map(wallOf);
  if (!tz || tz === 'UTC' || tz === 'Etc/UTC') return wall;
  try {
    zoneOffset(0, tz);
  } catch {
    return wall;
  }
  // The offset changes only at a daylight saving switch, so once an hour is enough.
  const byHour = new Map<string, number>();
  return wall.map((w, i) => {
    const key = times[i].slice(0, 13);
    let off = byHour.get(key);
    if (off === undefined) {
      off = zoneOffset(w - zoneOffset(w, tz) * 60000, tz);
      byHour.set(key, off);
    }
    return w - off * 60000;
  });
}

/** The price step the bars move in: the fewest decimals that write every recent price (at most 8). */
export function tickOf(bars: ScriptBar[]): number {
  const recent = bars.slice(-300);
  for (let d = 0; d <= 8; d++) {
    const f = 10 ** d;
    if (recent.every((b) => [b.open, b.high, b.low, b.close].every((x) => Math.abs(x * f - Math.round(x * f)) < 1e-6))) return 1 / f;
  }
  return 1e-8;
}

/**
 * Run a script on bars in the given sandbox. Never throws: errors come back as text. `timeframe` ("15m", "1h", …)
 * and `tz` (the series' exchangeTimezone) tell the script its timeframe and the zone its bars' times are written in.
 */
export function runScript(
  quickjs: QuickJSLike,
  code: string,
  bars: ScriptBar[],
  opts: {
    inputs?: Record<string, number | boolean | string>;
    expiry?: number;
    limits?: Partial<typeof SCRIPT_LIMITS>;
    timeframe?: string | number;
    tz?: string | null;
    /** The price step, when it must not follow these bars (a check replaying a longer series' first part). */
    mintick?: number;
  } = {},
): ScriptRun {
  const started = Date.now();
  // The strategy lab runs on years of bars: it may raise the time and signal limits for its own runs.
  const limits = { ...SCRIPT_LIMITS, ...opts.limits };
  if (code.length > limits.maxCode) return { ok: false, error: `Skrip terlalu panjang (maks ${limits.maxCode} karakter)`, ms: 0 };
  const epoch = barEpochs(
    bars.map((b) => b.time),
    opts.tz,
  );
  const input = JSON.stringify({ bars, inputs: opts.inputs ?? {}, expiry: opts.expiry ?? 96, limits, epoch, timeframe: minutesOf(opts.timeframe, epoch), mintick: opts.mintick ?? tickOf(bars) });
  // The user's code runs in its own block, so its names cannot replace the runtime's.
  // A function replacement: a "$" in the data must not be read as a replacement pattern.
  const source = `${PRELUDE.replace('__INPUT__', () => input)}\n{\n${code}\n}\n${EPILOGUE}`;
  const deadline = started + limits.timeMs;
  try {
    const result = quickjs.evalCode(source, { shouldInterrupt: () => Date.now() > deadline, memoryLimitBytes: limits.memoryBytes }) as ScriptResult;
    return { ok: true, result, ms: Date.now() - started };
  } catch (e) {
    const err = e as { name?: string; message?: string; stack?: string } | string;
    const text = typeof err === 'string' ? err : `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`;
    const interrupted = Date.now() > deadline || /interrupted/i.test(text);
    return { ok: false, error: interrupted ? `Skrip melewati batas waktu ${limits.timeMs / 1000} detik` : text.slice(0, 500), ms: Date.now() - started };
  }
}

/** Bars from the app's candles: time as "YYYY-MM-DD HH:MM" (intraday) or "YYYY-MM-DD", the same on every side. */
export const toScriptBars = (candles: { time: string; open: number; high: number; low: number; close: number; volume: number }[]): ScriptBar[] =>
  candles.map((c) => ({ time: c.time.slice(0, 16).replace('T', ' '), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));

/** The script language in brief: shown in the editor and given to the AI that translates Pine. */
export const SCRIPT_REFERENCE = `Data (array, indeks 0 = candle tertua, n = jumlah candle): open, high, low, close, volume, hl2, hlc3, ohlc4,
  time (teks "YYYY-MM-DD HH:MM", jam bursa candle), epoch (milidetik UTC), timeframe (menit per candle), mintick (langkah harga).
Pengaturan: input(nama, default) -> angka/boolean/teks yang bisa diubah pengguna.
Series ta.* (array, NaN selama pemanasan, hitungannya sama dengan Pine; rma, atr dan rsi diawali SMA):
  sma ema rma wma vwma hma (src, len) · rsi(src, len) · tr(b?) · atr(len, b?) · stdev dev (src, len) · highest lowest (src?, len)
  change mom roc (src, len) · crossover crossunder cross (a, b; b boleh angka) -> array boolean · rising falling (src, len)
  macd(src, fast, slow, signal) -> {macd, signal, hist} · bb(src, len, mult) -> {mid, upper, lower} · stoch(src, high, low, len) · cci(src, len)
  dmi(diLen, adxLen, b?) -> {plus, minus, adx} · supertrend(faktor, atrLen, b?) -> {line, direction} (direction -1 = tren naik, 1 = turun)
  pivothigh / pivotlow (len) atau (kiri, kanan) atau (src, kiri, kanan): harga pivot diletakkan di candle saat pivot terkonfirmasi
  (kanan candle sesudah pivot), NaN di tempat lain · barssince(cond) · valuewhen(cond, src, ke) · cum(src) · linreg(src, len, offset)
  obv(b?) · vwap(src?, b?) (mulai ulang tiap hari bursa) · fixnan(src) · nz(x, pengganti?). b = candle timeframe lain dari htf().
Waktu: hour(i, tz?) minute(i, tz?) dayofweek(i, tz?) (1 = Minggu) · session("HHMM-HHMM", tz?) -> array boolean (jam akhir tidak termasuk;
  boleh ":1234567" untuk hari). tz misalnya "Asia/Jakarta", "UTC", "UTC+7", "America/New_York", "Europe/London"; tanpa tz = jam bursa.
Timeframe lebih tinggi: const h = htf(menit) membangun h.open/high/low/close/volume/time (panjang h.n) dari candle ini. Hitung series di h
  (misalnya ta.ema(h.close, 20)), lalu bawa ke candle chart dengan h.closed(series) (candle tinggi yang sudah tutup sebelumnya, sama
  dengan request.security(..., expr[1], lookahead_on)) atau h.value(series) (berganti di candle yang menutup candle tinggi).
Gambar: plot(series, judul, warna?) (maks 8) · hline(harga, judul, warna?) · line(x1, y1, x2, y2, {color, style: "solid"|"dashed"|"dotted",
  width, extend: "right"}) -> id, lineSet(id, {x2, y2, color, style, extend}) · label(i, harga, teks, {color, position: "above"|"below"}) -> id,
  labelSet(id, {...}) · lineDelete(id) · labelDelete(id). x dan i adalah nomor candle; teks label boleh beberapa baris ("\\n").
  Lebih dari 500 garis atau 500 label: yang paling lama dihapus, seperti max_lines_count di Pine; id yang sudah dihapus
  atau NaN diabaikan oleh lineSet/labelSet.
Sinyal: signal(i, "BUY"|"SELL", { sl, tp, entry?, wait?, size?, breakeven?, label?, exit?, maxBars?, exclusive? }); BUY: sl < entry < tp1 <= tp2.
  - Tanpa entry: masuk di close candle i.
  - entry tanpa wait: terisi di dalam candle i, jadi harus di antara low[i] dan high[i]; kalau tidak, sinyalnya dibuang (tidak terisi).
  - entry dengan wait: N = order tunggu yang dipasang sesudah candle i tutup: di atas close untuk BUY (di bawah untuk SELL) = order stop,
    sebaliknya = order limit. Terisi di candle pertama sesudah i yang menyentuh entry, paling lama N candle; kalau tidak, hasilnya
    "tidak terisi". Order stop yang dilompati harga terisi di harga buka.
  - tp boleh dua target: tp: [tp1, tp2]; size = bagian yang ditutup di tp1 (bawaan 0,5); breakeven (bawaan true) = SL pindah ke harga
    masuk sesudah tp1 kena.
  - exit: array boolean, posisi ditutup di close candle pertama sesudah masuk yang bernilai true (dicek sesudah SL dan TP);
    maxBars: ditutup di close sesudah sekian candle sejak masuk (bawaan 96).
  - exclusive: true = satu posisi sekaligus, termasuk order yang masih menunggu; sinyal di candle tempat posisi sebelumnya
    ditutup boleh masuk.
  Hasil: win = target terakhir, loss = SL, partial = tp1 lalu SL/BE, exit = kondisi, expired = batas waktu, unfilled = order tidak terisi.
  R dihitung dari jarak entry ke SL, mulai dari harga isi. SL yang dilompati harga dicatat di harga buka; candle yang mengisi order
  sekaligus menyentuh SL dihitung rugi; TP yang tersentuh di candle pengisi order stop ikut dihitung (harga lewat entry dulu), di
  candle pengisi order limit tidak; titik impas berlaku mulai candle sesudah tp1; TP tidak pernah terisi lebih baik dari harganya.
Aturan: jangan baca candle sesudah i untuk memutuskan sinyal di i (misalnya close[i + 1]); sinyal di candle terakhir (masih berjalan)
  diabaikan; tidak ada akses jaringan, file atau halaman; batas 3 detik dan 128 MB. Bahasa: JavaScript biasa (const, let, for, if, Math.*).`;

export { SCRIPT_TEMPLATES } from './script-templates';
