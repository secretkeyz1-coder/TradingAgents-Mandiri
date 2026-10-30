// The watchlist the server analyses each trading day (web/server/src/watch.ts).
import { api, type Watchlist } from '../api';
import { jobs } from './jobs.svelte';
import { usage } from './usage.svelte';

class WatchStore {
  value = $state<Watchlist | null>(null);
  busy = $state(false);
  error = $state('');
  notice = $state('');

  async load() {
    try {
      this.value = await api.watchlist();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  has(symbol: string | null) {
    return !!symbol && !!this.value?.items.some((w) => w.symbol === symbol);
  }

  async toggle(symbol: string, tvSymbol: string) {
    this.error = '';
    try {
      if (this.has(symbol)) await api.watchRemove(symbol);
      else await api.watchAdd(symbol, tvSymbol);
    } catch (e) {
      this.error = (e as Error).message;
    }
    await this.load();
  }

  async runNow() {
    await this.#act(async () => {
      const { ids, skipped } = await api.watchRun();
      this.notice = `${ids.length} analisa masuk antrean${skipped.length ? `; ${skipped.length} dilewati karena kuota` : ''}.`;
      jobs.refresh();
      usage.refresh();
    });
  }

  async test() {
    await this.#act(async () => {
      await api.watchTest();
      this.notice = 'Pesan tes terkirim ke Telegram.';
    });
  }

  async #act(fn: () => Promise<void>) {
    this.busy = true;
    this.error = '';
    this.notice = '';
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
      this.load();
    }
  }
}

export const watch = new WatchStore();
