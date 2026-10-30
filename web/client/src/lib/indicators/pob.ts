// PoB BYSTRA gold setups as a deterministic engine, built from the spec
// "Spesifikasi Indikator PoB BYSTRA Gold" with its proposed defaults. Five
// building blocks (swings/structure, base zones, strong A/V, trendlines, HTF
// engulfing) feed six setups (SNR V1/V2, QM Continuation, QM Reversal,
// QM Failed, Manipulation) plus the CK2/CK3 labels; one signal per bar at
// most, levels frozen at the signal bar, and every signal followed to its
// outcome so the chart can show a quick per-setup tally.
//
// Bars are walked once, oldest first, and only closed bars are used: the
// newest bar may still be forming. Mirrors web/worker/pob.py; change both.
import type { Candle } from '../api';

export const POB_DEFAULTS = {
  pivotLen: 3,
  breakAtr: 0.1,
  chochMoveAtr: 1.5,
  reversalWindow: 60,
  impulseBody: 0.6,
  impulseAtr: 0.7,
  baseBody: 0.5,
  baseAtr: 0.35,
  maxBase: 3,
  legOutAtr: 1.0,
  legOutBars: 3,
  maxTouches: 2,
  strongReactionAtr: 2.0,
  strongReactionBars: 10,
  alignAtr: 0.3,
  touchAtr: 0.15,
  touchGap: 5,
  touchAwayAtr: 0.5,
  lineMaxAge: 200,
  tlBreakAtr: 0.2,
  engulfAtr: 0.8,
  engulfLife: 3,
  slBufferAtr: 0.2,
  riskReward: 2,
  cooldown: 3,
  expiryBars: 96,
  failedMemory: 3,
  failedLife: 200,
  warmup: 30,
};
export type PobSettings = typeof POB_DEFAULTS;

export type SetupId = 'SNR1' | 'SNR2' | 'QMC' | 'QMR' | 'QMF' | 'MANIP';
export const SETUPS: { id: SetupId; name: string; risk: 'Low' | 'High' }[] = [
  { id: 'SNR1', name: 'SNR Continuation V1', risk: 'Low' },
  { id: 'SNR2', name: 'SNR Continuation V2', risk: 'Low' },
  { id: 'QMC', name: 'QM Continuation', risk: 'Low' },
  { id: 'QMR', name: 'QM Reversal', risk: 'High' },
  { id: 'QMF', name: 'QM Failed', risk: 'High' },
  { id: 'MANIP', name: 'Manipulation', risk: 'High' },
];

export type PobSignal = {
  index: number;
  side: 'BUY' | 'SELL';
  setup: SetupId;
  /** QM Reversal/Failed with a valid HTF engulfing ("setup terbaik"). */
  plus: boolean;
  ck2: boolean;
  ck3: boolean;
  label: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  zoneTop: number | null;
  zoneBottom: number | null;
  outcome: 'win' | 'loss' | 'expired' | 'open';
  /** Result in R (risk units), once closed. */
  r: number | null;
  exitIndex: number | null;
};

export type PobStat = { setup: SetupId; count: number; wins: number; losses: number; expired: number; open: number; avgR: number | null };

export type PobResult = {
  signals: PobSignal[];
  stats: PobStat[];
  trend: 'up' | 'down' | 'none';
  /** The HTF candles were built by grouping bars by this key (hour for 15m, 4 hours for 1h). */
  htf: string;
};

type Swing = { idx: number; price: number; kind: 'H' | 'L'; broken: boolean };
type Zone = {
  dir: 1 | -1;
  kind: 'RBR' | 'DBR' | 'DBD' | 'RBD';
  top: number;
  bottom: number;
  legOut: number;
  readyBy: number;
  readyAt: number;
  touches: number;
  inside: boolean;
  dead: boolean;
};
type Reversal = { dir: 1 | -1; idx: number; point: number; strong: boolean; top: number; bottom: number; zoneValid: boolean };
type Engulf = { dir: 1 | -1; high: number; low: number; start: number; known: number; h1Index: number; valid: boolean };
type Armed = { dir: 1 | -1; idx: number; refIdx: number; refPrice: number };
type Qmc = { dir: 1 | -1; rev: number; t1: Swing | null; t2: Swing | null; t2Known: number; away: boolean; done: boolean };
type Failed = { dir: 1 | -1; top: number; bottom: number; idx: number };

/** HTF bucket of a bar: the hour for 15-minute bars, a 4-hour block for hourly bars. */
export function htfKey(time: string, timeframe: '15m' | '1h'): string {
  if (timeframe === '15m') return time.slice(0, 13);
  return `${time.slice(0, 10)}/${Math.floor(Number(time.slice(11, 13)) / 4)}`;
}

const rmaNext = (prev: number | null, value: number, length: number) => (prev == null ? value : (prev * (length - 1) + value) / length);

export function pob(candles: Candle[], timeframe: '15m' | '1h', s: PobSettings = POB_DEFAULTS): PobResult | null {
  const n = candles.length;
  if (n < 60) return null;
  const o = candles.map((c) => c.open);
  const h = candles.map((c) => c.high);
  const l = candles.map((c) => c.low);
  const c = candles.map((x) => x.close);
  const atr: number[] = [];
  for (let i = 0; i < n; i++) {
    const tr = i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    atr.push(rmaNext(i === 0 ? null : atr[i - 1], tr, 14));
  }
  const body = (k: number) => Math.abs(c[k] - o[k]);
  const range = (k: number) => h[k] - l[k];
  const isImpulse = (k: number) => body(k) >= s.impulseBody * range(k) && body(k) >= s.impulseAtr * atr[k] && c[k] !== o[k];
  const isBase = (k: number) => range(k) === 0 || body(k) <= s.baseBody * range(k) || body(k) <= s.baseAtr * atr[k];

  const L = s.pivotLen;
  const swings: Swing[] = [];
  let lastH: Swing | null = null;
  let lastL: Swing | null = null;
  let trend: 'up' | 'down' | 'none' = 'none';
  let bos = 0;
  let rev: Reversal | null = null;
  let zones: Zone[] = [];
  const h1: { o: number; h: number; l: number; c: number; start: number }[] = [];
  let h1Atr: number | null = null;
  let acc: { o: number; h: number; l: number; c: number; start: number } | null = null;
  const engulf: Record<string, Engulf | null> = { '1': null, '-1': null };
  const armed: Record<string, Armed | null> = { '1': null, '-1': null };
  /** The trendline (by its newest swing) each direction last armed on: one arming per line. */
  const armedLine: Record<string, number> = { '1': -1, '-1': -1 };
  let qmc: Qmc | null = null;
  const failed: Failed[] = [];
  const signals: PobSignal[] = [];
  const lastSide: Record<string, number> = { '1': -1e9, '-1': -1e9 };

  const engulfValid = (dir: 1 | -1) => {
    const e = engulf[String(dir)];
    return !!e && e.valid && h1.length - 1 - e.h1Index <= s.engulfLife;
  };
  const near = (z: { top: number; bottom: number }, lo: number, hi: number, tol: number) => Math.max(lo - z.top, z.bottom - hi, 0) <= tol;

  // Two broken opposite swings close to the entry band = CK2 (spec: SR flip).
  const ck2At = (dir: 1 | -1, lo: number, hi: number, i: number) => {
    let count = 0;
    for (let k = swings.length - 1; k >= 0 && k >= swings.length - 60; k--) {
      const sw = swings[k];
      if (sw.idx >= i || sw.kind !== (dir === 1 ? 'H' : 'L')) continue;
      if (Math.max(lo - sw.price, sw.price - hi, 0) > s.alignAtr * atr[i]) continue;
      let flipped = false;
      for (let j = sw.idx + 1; j <= i && !flipped; j++) flipped = dir === 1 ? c[j] > sw.price : c[j] < sw.price;
      if (flipped) count++;
      if (count >= 2) return true;
    }
    return false;
  };

  const takeProfit = (dir: 1 | -1, entry: number, risk: number, i: number) => {
    let tp = entry + dir * risk * s.riskReward;
    for (const sw of swings) {
      if (sw.idx >= i || sw.kind !== (dir === 1 ? 'H' : 'L')) continue;
      const dist = (sw.price - entry) * dir;
      if (dist >= risk && dist < (tp - entry) * dir) tp = sw.price;
    }
    return tp;
  };

  for (let i = 1; i <= n - 2; i++) {
    // 1. Outcomes of open signals on this bar (stop first when both are touched).
    for (const sig of signals) {
      if (sig.outcome !== 'open' || sig.index >= i) continue;
      const buy = sig.side === 'BUY';
      const risk = Math.abs(sig.entry - sig.stopLoss);
      if (buy ? l[i] <= sig.stopLoss : h[i] >= sig.stopLoss) {
        Object.assign(sig, { outcome: 'loss', r: -1, exitIndex: i });
        if (sig.setup === 'QMR' || sig.setup === 'QMF') {
          failed.push({ dir: buy ? 1 : -1, top: sig.zoneTop!, bottom: sig.zoneBottom!, idx: i });
          if (failed.length > s.failedMemory) failed.shift();
        }
      } else if (buy ? h[i] >= sig.takeProfit : l[i] <= sig.takeProfit) {
        Object.assign(sig, { outcome: 'win', r: Math.abs(sig.takeProfit - sig.entry) / risk, exitIndex: i });
      } else if (i - sig.index >= s.expiryBars) {
        Object.assign(sig, { outcome: 'expired', r: ((c[i] - sig.entry) * (buy ? 1 : -1)) / risk, exitIndex: i });
      }
    }

    // 2. HTF candles: a bucket is closed once a bar of the next bucket arrives.
    const key = htfKey(candles[i].time, timeframe);
    if (!acc) acc = { o: o[i - 1], h: h[i - 1], l: l[i - 1], c: c[i - 1], start: i - 1 };
    if (key !== htfKey(candles[i - 1].time, timeframe)) {
      const prevClose = h1.length ? h1[h1.length - 1].c : null;
      const tr = prevClose == null ? acc.h - acc.l : Math.max(acc.h - acc.l, Math.abs(acc.h - prevClose), Math.abs(acc.l - prevClose));
      h1Atr = rmaNext(h1Atr, tr, 14);
      h1.push(acc);
      const m = h1.length - 1;
      if (m >= 1) {
        const p = h1[m - 1];
        const cur = h1[m];
        const big = Math.abs(cur.c - cur.o) >= s.engulfAtr * h1Atr;
        if (big && cur.c > cur.o && p.c < p.o && cur.o <= p.c && cur.c >= p.o) {
          engulf['1'] = { dir: 1, high: cur.h, low: cur.l, start: cur.start, known: i, h1Index: m, valid: true };
        } else if (big && cur.c < cur.o && p.c > p.o && cur.o >= p.c && cur.c <= p.o) {
          engulf['-1'] = { dir: -1, high: cur.h, low: cur.l, start: cur.start, known: i, h1Index: m, valid: true };
        }
      }
      acc = { o: o[i], h: h[i], l: l[i], c: c[i], start: i };
    } else {
      acc = { o: acc.o, h: Math.max(acc.h, h[i]), l: Math.min(acc.l, l[i]), c: c[i], start: acc.start };
    }
    // An engulfing range is spent once price closes beyond it the other way.
    if (engulf['1'] && c[i] < engulf['1'].low) engulf['1'].valid = false;
    if (engulf['-1'] && c[i] > engulf['-1'].high) engulf['-1'].valid = false;

    // 3. Swing confirmed L bars after it; highs and lows alternate.
    const j = i - L;
    if (j >= L) {
      let isH = true;
      let isL = true;
      for (let k = j - L; k <= j + L; k++) {
        if (k === j) continue;
        if (h[k] >= h[j]) isH = false;
        if (l[k] <= l[j]) isL = false;
      }
      for (const [ok, kind, price] of [
        [isH, 'H', h[j]],
        [isL, 'L', l[j]],
      ] as const) {
        if (!ok) continue;
        const last = swings.at(-1);
        const sw: Swing = { idx: j, price, kind, broken: false };
        if (last && last.kind === kind) {
          if (kind === 'H' ? price <= last.price : price >= last.price) continue;
          swings[swings.length - 1] = sw;
        } else {
          swings.push(sw);
        }
        if (kind === 'H') lastH = sw;
        else lastL = sw;
        // QM Continuation touches 1 and 2: swings after the reversal, in its direction.
        if (qmc && !qmc.done && kind === (qmc.dir === 1 ? 'L' : 'H') && j > qmc.rev) {
          if (!qmc.t1) qmc.t1 = sw;
          else if (!qmc.t2 && (price - qmc.t1.price) * qmc.dir > 0 && j - qmc.t1.idx >= s.touchGap) {
            const slope = (price - qmc.t1.price) / (j - qmc.t1.idx);
            let clean = true;
            for (let k = qmc.t1.idx + 1; k < j && clean; k++) {
              const line = qmc.t1.price + slope * (k - qmc.t1.idx);
              clean = qmc.dir === 1 ? c[k] >= line : c[k] <= line;
            }
            if (clean) {
              qmc.t2 = sw;
              qmc.t2Known = i;
            }
          }
        }
      }
    }

    // 4. QM Reversal arming: a mature trend's trendline breaks (trend as of the previous bar).
    for (const dir of [1, -1] as const) {
      const against = dir === 1 ? 'down' : 'up';
      if (trend !== against || bos < 2) continue;
      const kind = dir === 1 ? 'H' : 'L';
      const pts = swings.filter((sw) => sw.kind === kind).slice(-2);
      if (pts.length < 2) continue;
      const [a, b] = pts;
      if ((b.price - a.price) * dir >= 0 || i - a.idx > s.lineMaxAge) continue;
      const line = a.price + ((b.price - a.price) / (b.idx - a.idx)) * (i - a.idx);
      if ((c[i] - line) * dir > s.tlBreakAtr * atr[i]) {
        const ref = dir === 1 ? lastL : lastH;
        if (ref && armedLine[String(dir)] !== b.idx) {
          armed[String(dir)] = { dir, idx: i, refIdx: ref.idx, refPrice: ref.price };
          armedLine[String(dir)] = b.idx;
        }
      }
    }

    // 5. Structure: BOS continues a trend; CHoCH (with a 1.5 ATR leg) reverses it.
    for (const dir of [1, -1] as const) {
      const sw = dir === 1 ? lastH : lastL;
      if (!sw || sw.broken || (c[i] - sw.price) * dir <= s.breakAtr * atr[i]) continue;
      if (trend === (dir === 1 ? 'down' : 'up')) {
        let p = sw.idx;
        for (let k = sw.idx; k <= i; k++) if (dir === 1 ? l[k] < l[p] : h[k] > h[p]) p = k;
        const move = dir === 1 ? c[i] - l[p] : h[p] - c[i];
        if (move < s.chochMoveAtr * atr[i]) continue;
        sw.broken = true;
        trend = dir === 1 ? 'up' : 'down';
        bos = 0;
        let reaction = 0;
        for (let k = p + 1; k <= Math.min(p + s.strongReactionBars, i); k++) reaction = Math.max(reaction, dir === 1 ? h[k] - l[p] : h[p] - l[k]);
        const wick = dir === 1 ? Math.min(o[p], c[p]) - l[p] : h[p] - Math.max(o[p], c[p]);
        const engulfs =
          p + 1 <= i &&
          (dir === 1
            ? c[p + 1] > o[p + 1] && o[p] > c[p] && c[p + 1] >= o[p] && o[p + 1] <= c[p]
            : c[p + 1] < o[p + 1] && o[p] < c[p] && c[p + 1] <= o[p] && o[p + 1] >= c[p]);
        const score = 1 + (reaction >= s.strongReactionAtr * atr[p] ? 1 : 0) + (wick >= 0.5 * range(p) || engulfs ? 1 : 0);
        const ks = [p - 1, p, p + 1].filter((k) => k >= 0 && k <= i);
        let top: number;
        let bottom: number;
        if (dir === 1) {
          bottom = l[p];
          top = Math.min(...ks.map((k) => Math.min(o[k], c[k])));
          top = Math.min(Math.max(top, bottom), bottom + atr[p]);
        } else {
          top = h[p];
          bottom = Math.max(...ks.map((k) => Math.max(o[k], c[k])));
          bottom = Math.max(Math.min(bottom, top), top - atr[p]);
        }
        rev = { dir, idx: i, point: p, strong: score >= 2, top, bottom, zoneValid: true };
        qmc = { dir, rev: i, t1: null, t2: null, t2Known: -1, away: false, done: false };
      } else {
        sw.broken = true;
        bos = trend === (dir === 1 ? 'up' : 'down') ? bos + 1 : 1;
        trend = dir === 1 ? 'up' : 'down';
      }
    }
    if (rev && rev.zoneValid && (rev.dir === 1 ? c[i] < rev.bottom : c[i] > rev.top)) rev.zoneValid = false;

    // 6. Base zones: impulse in, 1-3 base bars, impulse out beyond the base.
    if (isImpulse(i)) {
      const d = c[i] > o[i] ? 1 : -1;
      const base: number[] = [];
      let k = i - 1;
      while (k >= 0 && base.length < s.maxBase && isBase(k)) base.push(k--);
      if (base.length && k >= 0 && isImpulse(k)) {
        const din = c[k] > o[k] ? 1 : -1;
        const bh = Math.max(...base.map((b) => h[b]));
        const bl = Math.min(...base.map((b) => l[b]));
        if (d === 1 ? c[i] > bh : c[i] < bl) {
          const kind = din === 1 ? (d === 1 ? 'RBR' : 'RBD') : d === 1 ? 'DBR' : 'DBD';
          const top = d === 1 ? Math.max(...base.map((b) => Math.max(o[b], c[b]))) : bh;
          const bottom = d === 1 ? bl : Math.min(...base.map((b) => Math.min(o[b], c[b])));
          zones.push({ dir: d, kind, top, bottom, legOut: i, readyBy: i + s.legOutBars - 1, readyAt: -1, touches: 0, inside: false, dead: false });
          if (zones.length > 40) zones = zones.slice(-40);
        }
      }
    }
    const confirming: Zone[] = [];
    for (const z of zones) {
      if (z.dead) continue;
      if (z.readyAt < 0) {
        if ((z.dir === 1 ? h[i] - z.top : z.bottom - l[i]) >= s.legOutAtr * atr[z.legOut]) z.readyAt = i;
        else if (i >= z.readyBy) z.dead = true;
        continue;
      }
      if (i <= z.readyAt) continue;
      if (z.dir === 1 ? c[i] < z.bottom : c[i] > z.top) {
        z.dead = true;
        continue;
      }
      const touched = z.dir === 1 ? l[i] <= z.top : h[i] >= z.bottom;
      if (touched && !z.inside) z.touches++;
      if ((touched || z.inside) && z.touches <= s.maxTouches && (z.dir === 1 ? c[i] > z.top : c[i] < z.bottom)) confirming.push(z);
      z.inside = z.dir === 1 ? c[i] <= z.top : c[i] >= z.bottom;
    }

    // 7. Setups, in priority order; at most one signal per bar.
    if (i < s.warmup) continue;
    type Cand = { setup: SetupId; dir: 1 | -1; plus: boolean; sl: number; zone: Zone | null; band: [number, number] };
    const cands: Cand[] = [];
    const buf = s.slBufferAtr * atr[i];
    const revOn = rev && i > rev.idx && i <= rev.idx + s.reversalWindow ? rev : null;

    for (const z of confirming) {
      const dir = z.dir;
      const sl = dir === 1 ? z.bottom - buf : z.top + buf;
      if (revOn && revOn.dir === dir && revOn.strong && revOn.zoneValid && z.legOut >= revOn.point && near(z, revOn.bottom, revOn.top, s.alignAtr * atr[i])) {
        const setup = (dir === 1 ? z.kind === 'RBR' : z.kind === 'DBD') ? 'SNR1' : (dir === 1 ? z.kind === 'DBR' : z.kind === 'RBD') ? 'SNR2' : null;
        if (setup) {
          const slSnr = dir === 1 ? Math.min(z.bottom, revOn.bottom) - buf : Math.max(z.top, revOn.top) + buf;
          cands.push({ setup, dir, plus: false, sl: slSnr, zone: z, band: [z.bottom, z.top] });
        }
      }
      const a = armed[String(dir)];
      const continuation = dir === 1 ? z.kind === 'RBR' : z.kind === 'DBD';
      if (a && i > a.idx && i <= a.idx + s.reversalWindow && continuation && z.legOut >= a.refIdx) {
        if (near(z, a.refPrice, a.refPrice, s.alignAtr * atr[i])) {
          cands.push({ setup: 'QMR', dir, plus: engulfValid(dir), sl, zone: z, band: [z.bottom, z.top] });
        } else if (failed.some((f) => f.dir === dir && i - f.idx <= s.failedLife && near(z, f.bottom, f.top, s.alignAtr * atr[i]))) {
          cands.push({ setup: 'QMF', dir, plus: engulfValid(dir), sl, zone: z, band: [z.bottom, z.top] });
        }
      }
      const e = engulf[String(dir)];
      if (revOn && revOn.dir === dir && continuation && e && e.valid && e.known >= revOn.idx && z.legOut > e.start && z.bottom >= e.low && z.top <= e.high) {
        cands.push({ setup: 'MANIP', dir, plus: false, sl, zone: z, band: [z.bottom, z.top] });
      }
    }

    if (qmc && !qmc.done && qmc.t1 && qmc.t2 && i > qmc.t2Known) {
      const q = qmc;
      const slope = (q.t2!.price - q.t1!.price) / (q.t2!.idx - q.t1!.idx);
      const line = q.t1!.price + slope * (i - q.t1!.idx);
      if (i - q.rev > s.reversalWindow || i - q.t1!.idx > s.lineMaxAge || (c[i] - line) * q.dir < -s.tlBreakAtr * atr[i]) {
        q.done = true;
      } else {
        const gap = q.dir === 1 ? l[i] - line : line - h[i];
        const touch = gap <= s.touchAtr * atr[i] && (c[i] - line) * q.dir > 0;
        if (touch && q.away && i - q.t2!.idx >= s.touchGap) {
          const sl = q.dir === 1 ? l[i] - buf : h[i] + buf;
          cands.push({ setup: 'QMC', dir: q.dir, plus: false, sl, zone: null, band: [line, line] });
        }
        if (gap >= s.touchAwayAtr * atr[i]) q.away = true;
      }
    }

    const order: SetupId[] = ['SNR1', 'SNR2', 'QMC', 'QMR', 'QMF', 'MANIP'];
    cands.sort((x, y) => order.indexOf(x.setup) - order.indexOf(y.setup) || (x.setup === 'QMR' ? Number(y.plus) - Number(x.plus) : 0));
    const pick = cands.find((x) => i - lastSide[String(x.dir)] >= s.cooldown && (x.dir === 1 ? x.sl < c[i] : x.sl > c[i]));
    if (!pick) continue;

    const entry = c[i];
    const risk = Math.abs(entry - pick.sl);
    const ckUsed = pick.setup === 'SNR1' || pick.setup === 'SNR2' || pick.setup === 'QMC' || pick.setup === 'MANIP';
    const ck2 = ckUsed && ck2At(pick.dir, pick.band[0], pick.band[1], i);
    const ck3 = ck2 && engulfValid(pick.dir);
    const side = pick.dir === 1 ? 'BUY' : 'SELL';
    const meta = SETUPS.find((x) => x.id === pick.setup)!;
    signals.push({
      index: i,
      side,
      setup: pick.setup,
      plus: pick.plus,
      ck2,
      ck3,
      label: `${side} · ${pick.setup}${pick.plus ? '+' : ''}${ck3 ? ' · CK3' : ck2 ? ' · CK2' : ''} · ${meta.risk} Risk`,
      entry,
      stopLoss: pick.sl,
      takeProfit: takeProfit(pick.dir, entry, risk, i),
      zoneTop: pick.zone ? pick.zone.top : null,
      zoneBottom: pick.zone ? pick.zone.bottom : null,
      outcome: 'open',
      r: null,
      exitIndex: null,
    });
    lastSide[String(pick.dir)] = i;
    if (pick.zone) pick.zone.dead = true;
    if (pick.setup === 'QMC') qmc!.done = true;
    if (pick.setup === 'QMR' || pick.setup === 'QMF') armed[String(pick.dir)] = null;
  }

  const stats: PobStat[] = SETUPS.map(({ id }) => {
    const mine = signals.filter((x) => x.setup === id);
    const closed = mine.filter((x) => x.r != null);
    return {
      setup: id,
      count: mine.length,
      wins: mine.filter((x) => x.outcome === 'win').length,
      losses: mine.filter((x) => x.outcome === 'loss').length,
      expired: mine.filter((x) => x.outcome === 'expired').length,
      open: mine.filter((x) => x.outcome === 'open').length,
      avgR: closed.length ? closed.reduce((sum, x) => sum + x.r!, 0) / closed.length : null,
    };
  });
  return { signals, stats, trend, htf: timeframe === '15m' ? 'H1' : 'H4' };
}
