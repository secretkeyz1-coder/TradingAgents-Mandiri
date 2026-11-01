// Scalper Pro+, the user's Pine script ("AI Agent XAU Scalper PRO+"), on our
// own candles: a UT Bot trail whose crossings are filtered by the EMA trend,
// RSI and optionally a liquidity sweep, with an ATR stop, target and entry zone.
// Mirrors scalper_signal in web/worker/chart_agent.py; change both together so
// the chart and the agent find the same signal.
//
// Signals come only from closed bars: the newest bar may still be forming,
// which the script expresses with barstate.isconfirmed. The inputs and their
// defaults live in shared/scalper.ts, which the notifications read too.
import { scalperLength, type ScalperSettings } from '../../../../shared/scalper';
import type { Candle } from '../api';

export { SCALPER_DEFAULTS, type ScalperSettings } from '../../../../shared/scalper';

export type Side = 'BUY' | 'SELL';

export type Setup = {
  index: number;
  side: Side;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  zoneTop: number;
  zoneBottom: number;
};

export type Trendline = { from: number; to: number; fromPrice: number; slope: number };

export type ScalperResult = {
  trail: number[];
  emaFast: number[];
  emaSlow: number[];
  signals: { index: number; side: Side }[];
  setup: Setup | null;
  resistance: Trendline | null;
  support: Trendline | null;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  rsi: number;
  sweep: 'LOW SWEPT' | 'HIGH SWEPT' | 'NONE';
};

const rma = (values: number[], length: number) => {
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push((out[i - 1] * (length - 1) + values[i]) / length);
  return out;
};

const ema = (values: number[], length: number) => {
  const k = 2 / (length + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
};

/** null when there are too few bars for the slow EMA and the ATR to mean anything. */
export function scalper(candles: Candle[], s: ScalperSettings): ScalperResult | null {
  // A field cleared mid-edit arrives as null; draw nothing rather than NaN.
  const inputs = [s.sensitivity, s.atrPeriod, s.emaFast, s.emaSlow, s.rsiPeriod, s.pivotLen, s.atrRisk, s.slAtr, s.riskReward, s.entryZoneAtr];
  if (inputs.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)) return null;
  // Whole bars, rounded as the notifications round them (shared/scalper.ts).
  const atrLen = scalperLength(s.atrPeriod);
  const riskLen = scalperLength(s.atrRisk);
  const fastLen = scalperLength(s.emaFast);
  const slowLen = scalperLength(s.emaSlow);
  const rsiLen = scalperLength(s.rsiPeriod);
  const n = candles.length;
  if (n < Math.max(slowLen, riskLen) + 5) return null;
  const o = candles.map((c) => c.open);
  const h = candles.map((c) => c.high);
  const lo = candles.map((c) => c.low);
  const c = candles.map((x) => x.close);
  const src = s.useHeikinAshi ? candles.map((x) => (x.open + x.high + x.low + x.close) / 4) : c;

  const tr = h.map((_, i) => (i === 0 ? h[0] - lo[0] : Math.max(h[i] - lo[i], Math.abs(h[i] - c[i - 1]), Math.abs(lo[i] - c[i - 1]))));
  const atrUt = rma(tr, atrLen);
  const atrRisk = rma(tr, riskLen);
  const trail = [src[0] - s.sensitivity * atrUt[0]];
  for (let i = 1; i < n; i++) {
    const prev = trail[i - 1];
    const loss = s.sensitivity * atrUt[i];
    if (src[i] > prev && src[i - 1] > prev) trail.push(Math.max(prev, src[i] - loss));
    else if (src[i] < prev && src[i - 1] < prev) trail.push(Math.min(prev, src[i] + loss));
    else trail.push(src[i] > prev ? src[i] - loss : src[i] + loss);
  }
  const fast = ema(c, fastLen);
  const slow = ema(c, slowLen);
  const gain = rma(c.map((v, i) => (i ? Math.max(v - c[i - 1], 0) : 0)), rsiLen);
  const drop = rma(c.map((v, i) => (i ? Math.max(c[i - 1] - v, 0) : 0)), rsiLen);
  const rsi = gain.map((g, i) => (drop[i] === 0 ? 100 : 100 - 100 / (1 + g / drop[i])));
  const L = scalperLength(s.pivotLen, 2);

  const bull = (i: number) => fast[i] > slow[i] && c[i] > slow[i];
  const bear = (i: number) => fast[i] < slow[i] && c[i] < slow[i];
  const sweepLow = (i: number) => i >= L && lo[i] < Math.min(...lo.slice(i - L, i)) && Math.min(...lo.slice(i - L, i)) < c[i];
  const sweepHigh = (i: number) => i >= L && h[i] > Math.max(...h.slice(i - L, i)) && Math.max(...h.slice(i - L, i)) > c[i];

  const signals: { index: number; side: Side }[] = [];
  for (let i = 1; i < n - 1; i++) {
    const up = src[i] > trail[i] && src[i - 1] <= trail[i - 1];
    const down = src[i] < trail[i] && src[i - 1] >= trail[i - 1];
    if (up && (!s.useTrendFilter || bull(i)) && (!s.useRsiFilter || rsi[i] >= s.rsiBuyMin) && (!s.useSweep || sweepLow(i))) {
      signals.push({ index: i, side: 'BUY' });
    } else if (down && (!s.useTrendFilter || bear(i)) && (!s.useRsiFilter || rsi[i] <= s.rsiSellMax) && (!s.useSweep || sweepHigh(i))) {
      signals.push({ index: i, side: 'SELL' });
    }
  }

  let setup: Setup | null = null;
  const lastSignal = signals.at(-1);
  if (lastSignal) {
    const i = lastSignal.index;
    const risk = atrRisk[i] * s.slAtr;
    const half = atrRisk[i] * s.entryZoneAtr;
    const sign = lastSignal.side === 'BUY' ? 1 : -1;
    setup = {
      index: i,
      side: lastSignal.side,
      entry: c[i],
      stopLoss: c[i] - sign * risk,
      takeProfit: c[i] + sign * risk * s.riskReward,
      zoneTop: c[i] + half,
      zoneBottom: c[i] - half,
    };
  }

  const pivots = (values: number[], high: boolean) => {
    const out: number[] = [];
    for (let i = L; i < n - L; i++) {
      let ok = true;
      for (let j = i - L; j <= i + L && ok; j++) if (j !== i) ok = high ? values[i] > values[j] : values[i] < values[j];
      if (ok) out.push(i);
    }
    return out;
  };
  const line = (idx: number[], values: number[]): Trendline | null => {
    if (idx.length < 2) return null;
    const [a, b] = idx.slice(-2);
    return { from: a, to: b, fromPrice: values[a], slope: (values[b] - values[a]) / (b - a) };
  };

  const last = n - 1;
  return {
    trail,
    emaFast: fast,
    emaSlow: slow,
    signals,
    setup,
    resistance: line(pivots(h, true), h),
    support: line(pivots(lo, false), lo),
    trend: bull(last) ? 'BULLISH' : bear(last) ? 'BEARISH' : 'SIDEWAYS',
    rsi: rsi[last],
    sweep: sweepLow(last) ? 'LOW SWEPT' : sweepHigh(last) ? 'HIGH SWEPT' : 'NONE',
  };
}
