import { api, type AnalysisSummary, type BacktestSummary } from '../api';

const POLL_MS = 4000;

/** The analysis and backtest history, refreshed while anything is still running. */
class JobsStore {
  analyses = $state<AnalysisSummary[]>([]);
  backtests = $state<BacktestSummary[]>([]);
  loaded = $state(false);
  error = $state('');
  #timer: ReturnType<typeof setInterval> | undefined;

  live = $derived(
    [...this.analyses, ...this.backtests].some((j) => j.status === 'queued' || j.status === 'running'),
  );

  async refresh() {
    try {
      const [analyses, backtests] = await Promise.all([api.list(), api.listBacktests()]);
      this.analyses = analyses;
      this.backtests = backtests;
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loaded = true;
    }
  }

  start() {
    if (this.#timer) return;
    this.refresh();
    this.#timer = setInterval(() => {
      if (this.live) this.refresh();
    }, POLL_MS);
  }
}

export const jobs = new JobsStore();
