// Runs a user's indicator script on a symbol's candles on the server: the same
// QuickJS sandbox and runtime (web/shared/script.ts) as the chart, on the same
// Yahoo candles the chart loads. No database here, so the agent's CLI can use it.
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { runScript, toScriptBars, type QuickJSLike, type ScriptRun } from "../../shared/script";
import { getCandles, type Interval } from "./market";

export const SCRIPT_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;
export type ScriptTimeframe = (typeof SCRIPT_TIMEFRAMES)[number];

let module: Promise<QuickJSLike> | null = null;
export const quickjs = () => (module ??= newQuickJSWASMModuleFromVariant(variant) as Promise<QuickJSLike>);

/**
 * The chart's own default window: a year of bars (15m: the month Yahoo keeps).
 * Alerts and the agent read the same window, so their signals match the chart's.
 */
export async function runOnSymbol(
  code: string,
  symbol: string,
  timeframe: ScriptTimeframe,
  inputs?: Record<string, number | boolean | string>,
): Promise<ScriptRun & { bars: { time: string }[] }> {
  const series = await getCandles(symbol, "1y", timeframe as Interval);
  const bars = toScriptBars(series.candles);
  return { ...runScript(await quickjs(), code, bars, { inputs }), bars };
}
