// Indicator tests' state (server/src/lab.ts), kept here rather than in a view so a running test, the
// open result and a half-filled form survive leaving the tab: the server finishes and saves the run
// either way, and the page that comes back finds it. The form's strategy is also the indicator picked
// on Uji strategi → Indikator. Rekam jejak live reads the same history for each engine's latest test.
// A deleted run leaves the list at once and is deleted on the server a few seconds later, so
// "Urungkan" can bring it back.
import { api, type LabConfig, type LabRun, type LabRunSummary } from '../api';
import type { IconName } from '../workspace/icons';
import { announcer } from './announcer.svelte';
import { usage } from './usage.svelte';

export type LabMeta = Awaited<ReturnType<typeof api.lab>>;
const UNDO_MS = 6000;

/** The form's strategy key ("engine:fib", "catalog:<id>", "script:<id>") of a run's settings. */
export const strategyKey = (s: LabConfig['strategy']) => (s.kind === 'engine' ? `engine:${s.name}` : `${s.kind}:${s.id}`);

export const LAB_TIMEFRAMES: { value: LabConfig['timeframe']; label: string }[] = [
  { value: '15m', label: '15 menit' },
  { value: '1h', label: '1 jam' },
  { value: '4h', label: '4 jam' },
  { value: '1d', label: 'Harian' },
];
/** The history each timeframe may test, in days (the server caps it per timeframe). */
export const LAB_PERIODS: Record<LabConfig['timeframe'], number[]> = { '15m': [30, 90, 180, 365], '1h': [90, 180, 365, 730, 1095], '4h': [365, 730, 1095, 1825], '1d': [365, 730, 1095, 1825] };
export const periodLabel = (d: number) => (d < 365 ? `${d} hari` : `${d / 365} tahun`);
export const timeframeLabel = (tf: string) => LAB_TIMEFRAMES.find((t) => t.value === tf)?.label ?? tf;
/** `days` when the timeframe allows it, else the longest it allows below it (or its shortest). */
export const fitDays = (tf: LabConfig['timeframe'], days: number) => (LAB_PERIODS[tf].includes(days) ? days : ([...LAB_PERIODS[tf]].reverse().find((d) => d < days) ?? LAB_PERIODS[tf][0]));

/** A run's verdict in a word, in the server's order (server/src/lab.ts): passed, too few trades in the test data, or not passed. */
export function verdictOf(run: Pick<LabRunSummary, 'verdict' | 'total'>): { word: string; badge: string; icon: IconName } {
  if (run.verdict?.pass) return { word: 'Lolos', badge: 'badge-success', icon: 'check' };
  if ((run.total?.oos.n ?? 0) < 30) return { word: 'Belum cukup data', badge: 'badge-info', icon: 'info' };
  return { word: 'Tidak lolos', badge: 'badge-warning', icon: 'alert' };
}

class Lab {
  meta = $state<LabMeta | null>(null);
  runs = $state<LabRunSummary[]>([]);
  loaded = $state(false);
  /** The run on show: the one just run, or one opened from the history. */
  result = $state<LabRun | null>(null);
  busy = $state(false);
  /** What the running test is, for its row in the history and the status line. */
  running = $state<{ name: string; config: LabConfig } | null>(null);
  error = $state('');
  /** A run hidden from the history until its delete goes out. */
  deleting = $state<LabRunSummary | null>(null);
  #undo: ReturnType<typeof setTimeout> | undefined;

  // The form, in the order its steps are filled.
  strategy = $state('engine:fib');
  symbols = $state<string[]>(['BTC-USD', 'ETH-USD', 'GC=F']);
  timeframe = $state<LabConfig['timeframe']>('1h');
  days = $state(365);
  costs = $state<LabConfig['costs']>('taker');
  split = $state(0.7);
  expiry = $state(96);
  /** For crypto symbols: whose bars to test on. */
  venue = $state('binance');
  /** Said above the form when a result put its settings there. */
  note = $state('');

  shown = $derived(this.runs.filter((r) => r.id !== this.deleting?.id));

  async load() {
    try {
      [this.meta, this.runs] = await Promise.all([api.lab(), api.labRuns()]);
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loaded = true;
    }
  }

  /** The newest run of a strategy, for "Uji terakhir" elsewhere. */
  latest(key: string): LabRunSummary | undefined {
    return this.shown.find((r) => strategyKey(r.config.strategy) === key);
  }

  /** The form as the server takes it. */
  config(): LabConfig {
    const [kind, id] = this.strategy.split(':') as ['engine' | 'script' | 'catalog', string];
    return {
      strategy: kind === 'engine' ? { kind, name: id } : { kind, id },
      symbols: [...this.symbols],
      timeframe: this.timeframe,
      days: this.days,
      costs: this.costs,
      split: this.split,
      expiry: this.expiry,
      venue: this.venue === 'binance' ? undefined : this.venue,
    };
  }

  async run(name: string) {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.note = '';
    const config = this.config();
    this.running = { name, config };
    announcer.say(`Menguji ${name}…`);
    try {
      this.result = await api.labRun(config);
      this.runs = await api.labRuns();
      announcer.say(`Hasil uji ${name}: ${this.result.verdict.pass ? 'lolos' : 'tidak lolos'}.`);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
      this.running = null;
      usage.refresh();
    }
  }

  async open(id: string) {
    this.error = '';
    try {
      this.result = await api.labRunGet(id);
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /** Put a run's settings into the form, with `change` applied, and say so above it. */
  reuse(config: LabConfig, change: Partial<Pick<LabConfig, 'timeframe' | 'days' | 'symbols'>>, note: string) {
    this.strategy = strategyKey(config.strategy);
    this.symbols = [...(change.symbols ?? config.symbols)];
    this.timeframe = change.timeframe ?? config.timeframe;
    this.days = change.days ?? config.days;
    this.costs = config.costs;
    this.split = config.split;
    this.expiry = config.expiry;
    this.venue = config.venue ?? 'binance';
    this.note = note;
  }

  remove(run: LabRunSummary) {
    this.#commit();
    this.deleting = run;
    if (this.result?.id === run.id) this.result = null;
    this.#undo = setTimeout(() => this.#commit(), UNDO_MS);
    announcer.say(`Uji ${run.name} dihapus. Tombol Urungkan bisa mengembalikannya beberapa detik.`);
  }

  undo() {
    clearTimeout(this.#undo);
    this.deleting = null;
  }

  /** Send the waiting delete now (also when another one starts). */
  async #commit() {
    clearTimeout(this.#undo);
    const run = this.deleting;
    if (!run) return;
    this.deleting = null;
    try {
      await api.labRunDelete(run.id);
      this.runs = this.runs.filter((r) => r.id !== run.id);
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
}

export const lab = new Lab();
