// Scalper Pro+ inputs, shared by the chart (client/src/lib/indicators/scalper.ts draws
// with them) and the signal notifications (server/src/alerts.ts hands a user's own to
// chart_agent.scalper_signal through web/worker/signals.py). One set of defaults on both
// sides, and one reading of what a user saved: the notifications pass on only the inputs
// that change signals and differ from the defaults, with lengths already whole, rounded
// as both engines round them (scalperLength here, _length in chart_agent.py).

export type ScalperSettings = {
  sensitivity: number;
  atrPeriod: number;
  useHeikinAshi: boolean;
  useTrendFilter: boolean;
  useRsiFilter: boolean;
  useSweep: boolean;
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiBuyMin: number;
  rsiSellMax: number;
  pivotLen: number;
  atrRisk: number;
  slAtr: number;
  riskReward: number;
  extendBars: number;
  entryZoneAtr: number;
  showTrail: boolean;
  showEmas: boolean;
  showZone: boolean;
  showTrendlines: boolean;
  showDashboard: boolean;
};

/** The script's own defaults. */
export const SCALPER_DEFAULTS: ScalperSettings = {
  sensitivity: 1,
  atrPeriod: 10,
  useHeikinAshi: false,
  useTrendFilter: true,
  useRsiFilter: true,
  useSweep: false,
  emaFast: 20,
  emaSlow: 50,
  rsiPeriod: 14,
  rsiBuyMin: 50,
  rsiSellMax: 50,
  pivotLen: 5,
  atrRisk: 14,
  slAtr: 1.5,
  riskReward: 2,
  extendBars: 20,
  entryZoneAtr: 0.25,
  showTrail: true,
  showEmas: true,
  showZone: true,
  showTrendlines: true,
  showDashboard: true,
};

/** The inputs that change the signals; the others only change the drawing. */
export const SCALPER_SIGNAL_KEYS = [
  "sensitivity",
  "atrPeriod",
  "useHeikinAshi",
  "useTrendFilter",
  "useRsiFilter",
  "useSweep",
  "emaFast",
  "emaSlow",
  "rsiPeriod",
  "rsiBuyMin",
  "rsiSellMax",
  "pivotLen",
  "atrRisk",
  "slAtr",
  "riskReward",
  "entryZoneAtr",
] as const satisfies readonly (keyof ScalperSettings)[];

/** A user's signal inputs, where they differ from the defaults. */
export type ScalperSignalSettings = Partial<Pick<ScalperSettings, (typeof SCALPER_SIGNAL_KEYS)[number]>>;

/** Inputs counted in bars, with the least each engine accepts. */
const LENGTHS: Partial<Record<keyof ScalperSettings, number>> = { atrPeriod: 1, emaFast: 1, emaSlow: 1, rsiPeriod: 1, pivotLen: 2, atrRisk: 1 };

/** Inputs the chart needs above zero: with any of them at zero or below it draws nothing. */
const POSITIVE = new Set<keyof ScalperSettings>(["sensitivity", "atrPeriod", "emaFast", "emaSlow", "rsiPeriod", "pivotLen", "atrRisk", "slAtr", "riskReward", "entryZoneAtr"]);

/** A length in bars as both engines read it: rounded half up, and at least `least`. */
export const scalperLength = (value: number, least = 1) => Math.max(least, Math.round(value));

/**
 * The inputs the notifications run for what a user saved on the chart: each valid signal
 * input that differs from its default, lengths rounded; null when none differs. An invalid
 * value falls back to its default.
 */
export function scalperSignalSettings(saved: unknown): ScalperSignalSettings | null {
  if (!saved || typeof saved !== "object") return null;
  const out: Record<string, number | boolean> = {};
  for (const key of SCALPER_SIGNAL_KEYS) {
    const fallback = SCALPER_DEFAULTS[key];
    let value = (saved as Record<string, unknown>)[key];
    if (typeof value !== typeof fallback) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || (POSITIVE.has(key) && value <= 0)) continue;
      const least = LENGTHS[key];
      if (least !== undefined) value = scalperLength(value, least);
    }
    if (value !== fallback) out[key] = value as number | boolean;
  }
  return Object.keys(out).length ? (out as ScalperSignalSettings) : null;
}
