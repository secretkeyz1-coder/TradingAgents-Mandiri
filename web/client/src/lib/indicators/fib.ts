// Fibonacci golden zone pullback. An impulse leg in the trend's direction
// (swing low to a higher high, at least 3 ATR) is retraced into the 0.5-0.618
// zone; a candle that closes back out of the zone in the leg's direction is the
// signal. Stop beyond 0.786, target the leg's end (or the -0.272 extension
// when that end is closer than 1R). A close beyond 0.786 kills the leg; each
// leg gives at most one signal. Closed bars only; every signal is followed to
// its outcome. Mirrors web/worker/fib.py; change both together.
import type { Candle } from '../api';

export const FIB_DEFAULTS = {
  pivotLen: 3,
  minLegAtr: 3,
  zoneTop: 0.5,
  zoneBottom: 0.618,
  invalid: 0.786,
  extension: 0.272,
  slBufferAtr: 0.1,
  expiryBars: 96,
  warmup: 30,
};
export type FibSettings = typeof FIB_DEFAULTS;

export type FibLeg = { dir: 1 | -1; from: number; to: number; fromPrice: number; toPrice: number; known: number; dead: boolean; fired: boolean };

export type FibSignal = {
  index: number;
  side: 'BUY' | 'SELL';
  label: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  /** The leg the signal came from: its start and end prices. */
  legFrom: number;
  legTo: number;
  outcome: 'win' | 'loss' | 'expired' | 'open';
  r: number | null;
  exitIndex: number | null;
};

export type FibResult = {
  signals: FibSignal[];
  /** The newest leg still waiting for its pullback, if any. */
  active: FibLeg | null;
  stats: { count: number; wins: number; losses: number; expired: number; open: number; avgR: number | null };
};

/** Price at a retracement ratio of a leg (0 = its end, 1 = its start, negative = beyond its end). */
export const fibLevel = (leg: { fromPrice: number; toPrice: number }, ratio: number) => leg.toPrice - (leg.toPrice - leg.fromPrice) * ratio;

const rmaNext = (prev: number | null, value: number, length: number) => (prev == null ? value : (prev * (length - 1) + value) / length);

export function fib(candles: Candle[], s: FibSettings = FIB_DEFAULTS): FibResult | null {
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

  const L = s.pivotLen;
  const swings: { idx: number; price: number; kind: 'H' | 'L' }[] = [];
  const legs: Record<string, FibLeg | null> = { '1': null, '-1': null };
  const signals: FibSignal[] = [];

  for (let i = 1; i <= n - 2; i++) {
    // Outcomes first (stop first when both are touched on one bar).
    for (const sig of signals) {
      if (sig.outcome !== 'open' || sig.index >= i) continue;
      const buy = sig.side === 'BUY';
      const risk = Math.abs(sig.entry - sig.stopLoss);
      if (buy ? l[i] <= sig.stopLoss : h[i] >= sig.stopLoss) Object.assign(sig, { outcome: 'loss', r: -1, exitIndex: i });
      else if (buy ? h[i] >= sig.takeProfit : l[i] <= sig.takeProfit) Object.assign(sig, { outcome: 'win', r: Math.abs(sig.takeProfit - sig.entry) / risk, exitIndex: i });
      else if (i - sig.index >= s.expiryBars) Object.assign(sig, { outcome: 'expired', r: ((c[i] - sig.entry) * (buy ? 1 : -1)) / risk, exitIndex: i });
    }

    // A swing is confirmed L bars after it; highs and lows alternate.
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
        if (last && last.kind === kind) {
          if (kind === 'H' ? price <= last.price : price >= last.price) continue;
          swings[swings.length - 1] = { idx: j, price, kind };
        } else {
          swings.push({ idx: j, price, kind });
        }
        // A new leg: from the opposite swing before it to this one, a trend extreme (HH or LL), big enough.
        const dir = kind === 'H' ? 1 : -1;
        const start = [...swings].reverse().find((sw) => sw.kind !== kind && sw.idx < j);
        const prevSame = [...swings].reverse().find((sw) => sw.kind === kind && sw.idx < j);
        if (!start || !prevSame) continue;
        const extreme = dir === 1 ? price > prevSame.price : price < prevSame.price;
        if (extreme && Math.abs(price - start.price) >= s.minLegAtr * atr[j]) {
          legs[String(dir)] = { dir, from: start.idx, to: j, fromPrice: start.price, toPrice: price, known: i, dead: false, fired: false };
        }
      }
    }

    if (i < s.warmup) continue;
    for (const dir of [1, -1] as const) {
      const leg = legs[String(dir)];
      if (!leg || leg.dead || leg.fired || i <= leg.known) continue;
      const top = fibLevel(leg, s.zoneTop);
      const bottom = fibLevel(leg, s.zoneBottom);
      const invalid = fibLevel(leg, s.invalid);
      // A close beyond 0.786, or past the leg's own end, ends the leg.
      if ((c[i] - invalid) * dir < 0 || (c[i] - leg.toPrice) * dir > 0) {
        leg.dead = true;
        continue;
      }
      const touched = dir === 1 ? l[i] <= top : h[i] >= top;
      const rejects = dir === 1 ? c[i] > o[i] && c[i] > top : c[i] < o[i] && c[i] < top;
      if (!touched || !rejects) continue;
      const entry = c[i];
      const stop = invalid - dir * s.slBufferAtr * atr[i];
      const risk = Math.abs(entry - stop);
      const target = (leg.toPrice - entry) * dir >= risk ? leg.toPrice : fibLevel(leg, -s.extension);
      const deepest = dir === 1 ? l[i] <= bottom : h[i] >= bottom;
      const side = dir === 1 ? 'BUY' : 'SELL';
      signals.push({
        index: i,
        side,
        label: `${side} · Fib ${deepest ? '0,618' : '0,5'}`,
        entry,
        stopLoss: stop,
        takeProfit: target,
        legFrom: leg.fromPrice,
        legTo: leg.toPrice,
        outcome: 'open',
        r: null,
        exitIndex: null,
      });
      leg.fired = true;
    }
  }

  const closed = signals.filter((x) => x.r != null);
  const newest = [legs['1'], legs['-1']].filter((x): x is FibLeg => !!x && !x.dead && !x.fired).sort((a, b) => b.to - a.to)[0] ?? null;
  return {
    signals,
    active: newest,
    stats: {
      count: signals.length,
      wins: signals.filter((x) => x.outcome === 'win').length,
      losses: signals.filter((x) => x.outcome === 'loss').length,
      expired: signals.filter((x) => x.outcome === 'expired').length,
      open: signals.filter((x) => x.outcome === 'open').length,
      avgR: closed.length ? closed.reduce((sum, x) => sum + x.r!, 0) / closed.length : null,
    },
  };
}
