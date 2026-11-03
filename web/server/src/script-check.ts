// What an AI-written script must pass before a member sees it (scripts.ts translates, checks, and asks the AI to
// repair what failed): it runs in the sandbox on real bars, in the time the chart allows; it gives something to
// show; its entries are not mostly at prices their own bar never traded; and it never decides a bar from the bars
// after it. That last one is checked by replaying it on the bars up to some of its signals (and a few points
// between), with the next bar replaced by a flat one at the last close, as a bar that has only just opened: what it
// decides on the last closed bar, signals and plot values, must not change. Each problem is said in plain words,
// for the member and for the repair turn alike.
import { runScript, tickOf, type ScriptBar, type ScriptResult, type ScriptSignal } from "../../shared/script";
import { quickjs } from "./script-run";

export type ScriptCheck = {
  /** Whether it ran at all on the full series. */
  ran: boolean;
  problems: string[];
  bars: number;
  ms: number;
  stats: ScriptResult["stats"] | null;
  drawn: { plots: number; lines: number; labels: number };
};

type Context = { timeframe?: string; tz?: string | null };

/** The chart stops a script after 3 s; a draft slower than this on the server would fail there on a slower device. */
const SLOW_MS = 2_500;
/** Replays: at this many of the signals, and at this many points spread over the bars. */
const SIGNAL_CUTS = 6;
const SPREAD_CUTS = 3;
/** The closed bars before a replay's end whose signals and plot values are compared. */
const TAIL = 3;
/** Stop replaying once the replays alone have taken this long. */
const REPLAY_BUDGET_MS = 20_000;

const same = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const sameSignal = (a: ScriptSignal, b: ScriptSignal) =>
  a.index === b.index && a.side === b.side && same(a.entry, b.entry) && same(a.stopLoss, b.stopLoss) && a.targets.length === b.targets.length && a.targets.every((t, k) => same(t, b.targets[k]));

/** The last closed bar of each replay: some of the signals' bars, and points spread over the history. */
function replaysFor(r: ScriptResult, n: number): number[] {
  const at = new Set<number>();
  const signals = [...new Set(r.signals.map((s) => s.index))];
  const step = Math.max(1, Math.floor(signals.length / SIGNAL_CUTS));
  for (let k = signals.length - 1; k >= 0 && at.size < SIGNAL_CUTS; k -= step) at.add(signals[k]);
  for (let k = 1; k <= SPREAD_CUTS; k++) at.add(Math.floor((n * k) / (SPREAD_CUTS + 1)));
  return [...at].filter((j) => j > TAIL && j < n - 2).sort((a, b) => a - b);
}

/** The bars up to j, then bar j + 1 as it is the moment it opens: flat at j's close. */
function upTo(bars: ScriptBar[], j: number): ScriptBar[] {
  const c = bars[j].close;
  return [...bars.slice(0, j + 1), { ...bars[j + 1], open: c, high: c, low: c, close: c, volume: 0 }];
}

const timeOf = (bars: ScriptBar[], i: number) => bars[i]?.time ?? `#${i}`;

/** Runs the draft on these bars and says what is wrong with it, if anything. */
export async function checkScript(code: string, bars: ScriptBar[], context: Context = {}): Promise<ScriptCheck> {
  const qjs = await quickjs();
  // Every run reads the full series' price step: a shorter one could round to another, and change entries with it.
  const opts = { timeframe: context.timeframe, tz: context.tz, mintick: tickOf(bars), limits: { timeMs: 10_000 } };
  const started = performance.now();
  const full = runScript(qjs, code, bars, opts);
  const ms = Math.round(performance.now() - started);
  if (!full.ok) return { ran: false, problems: [`Skrip error: ${full.error}`], bars: bars.length, ms, stats: null, drawn: { plots: 0, lines: 0, labels: 0 } };
  const r = full.result;
  const problems: string[] = [];
  if (ms > SLOW_MS) {
    problems.push(`Skrip butuh ${ms} ms untuk ${bars.length} candle, padahal chart menghentikannya di 3 detik. Kurangi loop bersarang atau pencarian ulang di dalam loop.`);
  }
  if (!r.signals.length && !r.stats.unfilled && !r.plots.length && !r.hlines.length && !r.lines.length && !r.labels.length) {
    problems.push(`Skrip tidak menghasilkan sinyal, plot, garis atau label apa pun di ${bars.length} candle.`);
  }
  const dropped = r.stats.unfilled - r.signals.filter((s) => s.outcome === "unfilled").length;
  const placed = r.signals.length + dropped;
  if (dropped >= 3 && dropped >= 0.3 * placed) {
    problems.push(
      `${dropped} dari ${placed} sinyal memakai entry di luar candle sinyalnya tanpa wait, jadi tidak pernah terisi. Kalau Pine-nya memasang order stop atau limit (mis. entry di high + mintick), tulis wait: N di signal().`,
    );
  }

  const replayStart = performance.now();
  for (const j of replaysFor(r, bars.length)) {
    if (performance.now() - replayStart > REPLAY_BUDGET_MS) break;
    const part = runScript(qjs, code, upTo(bars, j), opts);
    if (!part.ok) {
      problems.push(`Skrip error saat candle terakhirnya ${timeOf(bars, j)}: ${part.error}`);
      break;
    }
    const near = (s: ScriptSignal) => s.index > j - TAIL && s.index <= j;
    const missing = r.signals.find((s) => near(s) && !part.result.signals.some((p) => sameSignal(p, s)));
    if (missing) {
      problems.push(
        `Sinyal ${missing.side} di candle ${timeOf(bars, missing.index)} hanya muncul kalau candle sesudahnya sudah diketahui: skrip membaca candle sesudah candle sinyal (mis. close[i + 1], pivot di candle pivotnya sendiri, atau nilai yang dihitung dari belakang).`,
      );
      break;
    }
    const extra = part.result.signals.find((p) => near(p) && !r.signals.some((s) => sameSignal(s, p)));
    if (extra) {
      problems.push(`Sinyal ${extra.side} di candle ${timeOf(bars, extra.index)} muncul lalu hilang setelah candle sesudahnya tutup: keputusan di candle itu bergantung pada candle sesudahnya.`);
      break;
    }
    const changed = r.plots.findIndex((plot, k) => {
      const shorter = part.result.plots[k]?.values ?? [];
      for (let i = j - TAIL + 1; i <= j; i++) {
        const a = plot.values[i];
        const b = shorter[i];
        if ((a == null) !== (b == null) || (a != null && b != null && !same(a, b))) return true;
      }
      return false;
    });
    if (changed >= 0) {
      problems.push(`Plot "${r.plots[changed].title}" di candle ${timeOf(bars, j)} berubah setelah candle sesudahnya tutup: plot itu membaca candle sesudahnya.`);
      break;
    }
  }
  return { ran: true, problems, bars: bars.length, ms, stats: r.stats, drawn: { plots: r.plots.length, lines: r.lines.length, labels: r.labels.length } };
}
