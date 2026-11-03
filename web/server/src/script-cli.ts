// For the Python worker, which has neither the server's candle loader nor the chart's script
// sandbox. One JSON job on stdin, one JSON line out (the last line: the loader may log before it):
//   {"code", "symbol", "timeframe"}: one user script on one symbol, summarized for the chart agent
//     (web/worker/chart_agent.py, tool custom_script);
//   {"mode": "bars", "symbol", "timeframe", "days"}: the strategy lab's long history (market.ts
//     getLabCandles), for the indicators an analysis reads (web/worker/readings.py);
//   {"mode": "script", "code", "timeframe", "bars", "cuts": [{"day", "start", "end"}]}: one script on
//     slices of those bars, summarized per analysis date, so a reading on a past date sees nothing after it.
//   echo '{"code": "...", "symbol": "GC=F", "timeframe": "1h"}' | bun web/server/src/script-cli.ts
import { getLabCandles, type Interval } from "./market";
import { quickjs, runOnSymbol, SCRIPT_TIMEFRAMES, type ScriptTimeframe } from "./script-run";
import { runScript, toScriptBars, type ScriptBar, type ScriptResult } from "../../shared/script";

type Job =
  | { mode?: undefined; code: string; symbol: string; timeframe: string }
  | { mode: "bars"; symbol: string; timeframe: string; days: number }
  | { mode: "script"; code: string; timeframe: string; tz?: string | null; bars: ScriptBar[]; cuts: { day: string; start: number; end: number }[] };

/** What the model reads of a script's run: its settings, latest values, signals and a tally over the bars it ran on. */
function summary(r: ScriptResult, bars: { time: string }[], timeframe: string) {
  return {
    timeframe,
    bars: bars.length,
    last_bar: bars[bars.length - 1]?.time,
    inputs: r.inputs,
    plots_latest: r.plots.map((p) => ({ title: p.title, value: p.values.findLast((v) => v != null) ?? null })),
    hlines: r.hlines,
    active_signal: r.signals.findLast((s) => s.outcome === "open") ?? null,
    recent_signals: r.signals.slice(-5).map((s) => ({
      time: s.time,
      label: s.label,
      entry: s.entry,
      stop_loss: s.stopLoss,
      take_profit: s.takeProfit,
      // Both targets of two, and an order that waits for its price (stop, limit) rather than filling at the close.
      targets: s.targets,
      order: s.order,
      outcome: s.outcome,
      r: s.r,
    })),
    tally_on_loaded_bars: r.stats,
    note: "Tally = uji asap pada candle yang dimuat, tanpa biaya; bukan backtest. Sinyal hanya dari candle tutup.",
  };
}

const timeframeOf = (value: string): ScriptTimeframe => ((SCRIPT_TIMEFRAMES as readonly string[]).includes(value) ? (value as ScriptTimeframe) : "1d");

async function answer(job: Job): Promise<unknown> {
  if (job.mode === "bars") {
    const series = await getLabCandles(job.symbol, timeframeOf(job.timeframe) as Interval, job.days);
    // The zone the bars' times are written in, which a script's sessions read (shared/script.ts).
    return { ok: true, source: series.source, tz: series.exchangeTimezone, bars: toScriptBars(series.candles) };
  }
  if (job.mode === "script") {
    const at: Record<string, unknown> = {};
    for (const cut of job.cuts) {
      const bars = job.bars.slice(cut.start, cut.end);
      // Up to a year of hourly bars per cut, like the lab's long runs.
      const run = runScript(await quickjs(), job.code, bars, { limits: { timeMs: 30_000 }, timeframe: job.timeframe, tz: job.tz });
      at[cut.day] = run.ok ? summary(run.result, bars, job.timeframe) : { error: run.error };
    }
    return { ok: true, at };
  }
  const timeframe = timeframeOf(job.timeframe);
  const run = await runOnSymbol(job.code, job.symbol, timeframe);
  return run.ok ? { ok: true, ...summary(run.result, run.bars, timeframe) } : { ok: false, error: run.error };
}

try {
  console.log(JSON.stringify(await answer(JSON.parse(await Bun.stdin.text()) as Job)));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: (e as Error).message }));
}
