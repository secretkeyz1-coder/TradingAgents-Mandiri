import { api, type Backtest, type BacktestProgress, type Decision } from '../api';
import { formatDuration, RATING_DIRECTION } from '../format';

/** One backtest sweep: its stored state, then its progress stream until it ends. */
export class BacktestStream {
  readonly id: string;
  readonly ready: Promise<void>;

  backtest = $state<Backtest | null>(null);
  loadError = $state('');
  progress = $state<BacktestProgress | null>(null);
  error = $state<string | null>(null);
  busy = $state(false);
  now = $state(Date.now());

  live = $derived(this.backtest?.status === 'queued' || this.backtest?.status === 'running');
  result = $derived(this.backtest?.result ?? null);
  tickers = $derived(this.backtest ? this.backtest.ticker.split(',') : []);
  /** Directional calls scored on the engine's alpha, across every ticker. */
  directional = $derived(
    (this.result?.cells ?? []).filter((c) => !c.pending && c.alpha != null && (RATING_DIRECTION[c.rating] ?? 0) !== 0),
  );
  hitRate = $derived(
    this.directional.length
      ? this.directional.filter((c) => c.alpha! * RATING_DIRECTION[c.rating] > 0).length / this.directional.length
      : null,
  );
  elapsed = $derived.by(() => {
    void this.now;
    return formatDuration(this.backtest?.startedAt ?? null, this.live ? null : (this.backtest?.finishedAt ?? null));
  });

  #source: EventSource | null = null;
  #clock: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  #onEnd?: (run: BacktestStream) => void;

  constructor(id: string, onEnd?: (run: BacktestStream) => void) {
    this.id = id;
    this.#onEnd = onEnd;
    this.ready = this.#start();
  }

  decisionsFor(ticker: string): Decision[] {
    return (this.result?.cells ?? [])
      .filter((c) => c.ticker === ticker)
      .map((c) => ({ source: 'backtest', id: this.id, date: c.date, rating: c.rating, return: c.return, alpha: c.alpha, pending: c.pending }));
  }

  async #start() {
    try {
      await this.refresh();
    } catch (e) {
      this.loadError = (e as Error).message;
      return;
    }
    if (this.#closed || !this.live) return;
    this.#connect();
    this.#clock = setInterval(() => (this.now = Date.now()), 1000);
  }

  async refresh() {
    const b = await api.getBacktest(this.id);
    this.backtest = b;
    this.progress = b.progress;
    this.error = b.error;
  }

  #connect() {
    const source = (this.#source = new EventSource(api.eventsUrl(this.id)));
    const on = (type: string, handle: (data: any) => void) =>
      source.addEventListener(type, (e) => {
        if (!(e instanceof MessageEvent) || !e.data) return;
        handle(JSON.parse(e.data));
      });
    on('started', () => {
      if (!this.backtest) return;
      this.backtest.status = 'running';
      this.backtest.startedAt ??= new Date().toISOString();
    });
    on('progress', (d) => (this.progress = { done: d.done, total: d.total, ticker: d.ticker, date: d.date }));
    on('error', (d) => (this.error = d.message));
    on('end', async () => {
      source.close();
      this.#source = null;
      clearInterval(this.#clock);
      await this.refresh().catch(() => {});
      if (!this.#closed) this.#onEnd?.(this);
    });
  }

  async cancel() {
    this.busy = true;
    try {
      await api.cancel(this.id);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  /** The same sweep under the same run id: done cells are skipped, pending ones settled. Returns the new id. */
  async resume(): Promise<string | null> {
    if (!this.backtest || !this.result) return null;
    this.busy = true;
    try {
      return (await api.createBacktest({ ...this.backtest.request, runId: this.result.runId })).id;
    } catch (e) {
      this.error = (e as Error).message;
      return null;
    } finally {
      this.busy = false;
    }
  }

  async remove(): Promise<boolean> {
    if (!confirm(`Hapus backtest ${this.tickers.join(', ')}?`)) return false;
    this.busy = true;
    try {
      await api.remove(this.id);
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    } finally {
      this.busy = false;
    }
  }

  destroy() {
    this.#closed = true;
    this.#source?.close();
    this.#source = null;
    clearInterval(this.#clock);
  }
}
