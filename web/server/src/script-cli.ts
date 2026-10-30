// For the chart agent (web/worker/chart_agent.py, tool custom_script): runs one
// user script on one symbol and prints a compact summary as JSON.
//   echo '{"code": "...", "symbol": "GC=F", "timeframe": "1h"}' | bun web/server/src/script-cli.ts
import { runOnSymbol, SCRIPT_TIMEFRAMES, type ScriptTimeframe } from "./script-run";

const job = JSON.parse(await Bun.stdin.text()) as { code: string; symbol: string; timeframe: string };
const timeframe = (SCRIPT_TIMEFRAMES as readonly string[]).includes(job.timeframe) ? (job.timeframe as ScriptTimeframe) : "1d";
try {
  const run = await runOnSymbol(job.code, job.symbol, timeframe);
  if (!run.ok) {
    console.log(JSON.stringify({ ok: false, error: run.error }));
  } else {
    const r = run.result;
    const last = run.bars.length - 1;
    console.log(
      JSON.stringify({
        ok: true,
        timeframe,
        bars: run.bars.length,
        last_bar: run.bars[last]?.time,
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
          outcome: s.outcome,
          r: s.r,
        })),
        tally_on_loaded_bars: r.stats,
        note: "Tally = uji asap pada candle yang dimuat, tanpa biaya; bukan backtest. Sinyal hanya dari candle tutup.",
      }),
    );
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: (e as Error).message }));
}
