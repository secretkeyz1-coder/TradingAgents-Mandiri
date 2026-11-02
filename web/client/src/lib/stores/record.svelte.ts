// The signal ledger's live record per engine and timeframe (server/src/ledger.ts, GET /api/ledger/record),
// shown where a trader chooses: beside each engine in the chart's Indikator and Notifikasi menus and on
// the trading plan card (chart/RecordLine). Loaded on first use and again after ten minutes, since the
// record moves slowly; a failed load leaves the lines out and the next menu opened tries again.
import { api, type LedgerBrief, type LedgerRecord } from '../api';

/** Fewer closed signals than this say little: the line says so instead of giving a win rate. */
export const ENOUGH = 10;

const NAMES: Record<string, string> = { 'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum', 'GC=F': 'emas' };
/** A tracked symbol as people say it. */
export const ledgerName = (symbol: string) => NAMES[symbol] ?? symbol;

class RecordStore {
  value = $state<LedgerRecord | null>(null);
  #at = 0;
  #loading = false;

  /** Fetches the record unless it is fresh or already on its way. */
  load() {
    if (this.#loading || Date.now() - this.#at < 600_000) return;
    this.#loading = true;
    api
      .ledgerRecord()
      .then((r) => {
        this.value = r;
        this.#at = Date.now();
      })
      .catch(() => {})
      .finally(() => (this.#loading = false));
  }

  /**
   * An engine's record on a timeframe (unless `exact`, on its only tracked one when the ledger does
   * not follow that timeframe): on this symbol when the ledger follows it with enough closed
   * signals, else on every tracked symbol together; null when the ledger does not follow the engine there.
   */
  of(source: string, timeframe: string, symbol?: string | null, exact = false): { brief: LedgerBrief; scope: string; timeframe: string } | null {
    const items = this.value?.items.filter((i) => i.source === source) ?? [];
    const item = items.find((i) => i.timeframe === timeframe) ?? (!exact && items.length === 1 ? items[0] : null);
    if (!item) return null;
    const own = symbol ? item.bySymbol[symbol] : undefined;
    return own && own.closed >= ENOUGH ? { brief: own, scope: symbol!, timeframe: item.timeframe } : { brief: item.all, scope: '', timeframe: item.timeframe };
  }

  /** The symbols the record covers, in words ("Bitcoin, Ethereum, dan emas"). */
  get covered(): string {
    const names = (this.value?.symbols ?? []).map(ledgerName);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')}, dan ${names.at(-1)}` : (names[0] ?? '');
  }

  /** What every line rests on, for the foot of a menu; empty until the record has loaded. */
  get note(): string {
    if (!this.value) return '';
    return `Rekam jejak: sinyal live ${this.value.days} hari terakhir di ${this.covered}, setelah biaya. R adalah risiko satu trade (jarak entry ke SL): rata-rata +0,20R berarti tiap sinyal rata-rata menghasilkan 0,2 kali risikonya.`;
  }
}

export const record = new RecordStore();
