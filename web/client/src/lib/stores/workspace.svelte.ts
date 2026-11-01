// The workspace's shared state: which symbol is in focus, which analysis and
// backtest are open, and how the panels are arranged. Panels read and change
// this; they never navigate. The state lives in the URL hash so links can be
// shared and Back works:  #/?s=IDX:BBCA&run=<id>&bt=<id>&dock=log&m=crypto&tf=4h
//
// Old page links (#/analyses/:id, #/backtests/:id, #/chart?symbol=…,
// #/markets?tab=…, #/?ticker=…) are read too, then rewritten to that form.
// A TradingView widget click arrives as ?tvwidgetsymbol=… and only changes the symbol.
import { INTERVALS, type Interval } from '../api';
import { acceptHandoffs } from '../tabs';
import { MARKET_TABS, toTradingView, toYahoo } from '../tv';
import { BacktestStream } from './backtest.svelte';
import { jobs } from './jobs.svelte';
import { RunStream } from './run.svelte';

export type DockTab = 'history' | 'report' | 'log' | 'backtest' | 'watch' | 'signals' | 'lab' | 'screener';
export type DockSize = 'min' | 'normal' | 'max';
export type AiMode = 'chat' | 'analysis' | 'backtest';
export type ChartView = 'tv' | 'ai';
export type MobileTab = 'market' | 'chart' | 'ai' | 'dock';

const DOCK_TABS: DockTab[] = ['history', 'report', 'log', 'backtest', 'watch', 'signals', 'lab', 'screener'];
const DEFAULT_SYMBOL = 'IDX:COMPOSITE';
const ID = /^[0-9a-f-]{36}$/;

class Workspace {
  /** The symbol in focus, as TradingView spells it (IDX:BBCA). */
  symbol = $state(DEFAULT_SYMBOL);
  /** The same symbol as the engine spells it (BBCA.JK), or null when it cannot be analysed. */
  yahoo = $derived(toYahoo(this.symbol));
  market = $state('idx');
  chartView = $state<ChartView>('tv');
  /** Candle timeframe of the AI chart; the engine itself only ever sees daily bars. */
  timeframe = $state<Interval>('1d');
  aiMode = $state<AiMode>('analysis');
  dock = $state<DockTab>('history');
  dockSize = $state<DockSize>('normal');
  mobileTab = $state<MobileTab>('chart');
  marketDrawer = $state(false);
  run = $state<RunStream | null>(null);
  backtest = $state<BacktestStream | null>(null);
  /** Bumped when a run or backtest finishes, so decision markers reload. */
  decisionsVersion = $state(0);

  constructor() {
    this.#read(location.hash);
    // Back/Forward between pushState entries; a widget click or a typed URL fires hashchange.
    // Reading twice is harmless: #read only assigns what the URL names.
    window.addEventListener('popstate', () => this.#read(location.hash));
    window.addEventListener('hashchange', () => this.#read(location.hash));
    // A symbol clicked in a TradingView widget opens a new tab, which hands it here instead.
    acceptHandoffs((symbol) => this.setSymbol(symbol));
  }

  setSymbol(tv: string) {
    const next = tv.trim().toUpperCase();
    this.marketDrawer = false;
    if (this.mobileTab === 'market') this.mobileTab = 'chart';
    if (!next || next === this.symbol) return;
    this.symbol = next;
    this.#write('push');
  }

  /** Open an analysis; `symbol` also brings its ticker into focus in the same history entry. */
  openRun(id: string, { show = true, symbol = '' } = {}) {
    if (symbol) this.symbol = symbol.toUpperCase();
    if (this.run?.id !== id) this.#replaceRun(id, false);
    this.aiMode = 'analysis';
    if (show && this.dock !== 'log') this.dock = 'report';
    if (show && this.dockSize === 'min') this.dockSize = 'normal';
    this.#write('push');
  }

  closeRun() {
    this.run?.destroy();
    this.run = null;
    if (this.dock === 'report' || this.dock === 'log') this.dock = 'history';
    this.#write('push');
  }

  openBacktest(id: string, { show = true, symbol = '' } = {}) {
    if (symbol) this.symbol = symbol.toUpperCase();
    if (this.backtest?.id !== id) {
      this.backtest?.destroy();
      this.backtest = new BacktestStream(id, () => this.#finished());
    }
    this.aiMode = 'backtest';
    if (show) {
      this.dock = 'backtest';
      if (this.dockSize === 'min') this.dockSize = 'normal';
    }
    this.#write('push');
  }

  closeBacktest() {
    this.backtest?.destroy();
    this.backtest = null;
    if (this.dock === 'backtest') this.dock = 'history';
    this.#write('push');
  }

  setDock(tab: DockTab) {
    this.dock = tab;
    if (this.dockSize === 'min') this.dockSize = 'normal';
    this.#write('replace');
  }

  setMarket(key: string) {
    this.market = key;
    this.#write('replace');
  }

  setChartView(view: ChartView) {
    this.chartView = view;
    this.#write('replace');
  }

  setTimeframe(tf: Interval) {
    this.timeframe = tf;
    this.#write('replace');
  }

  setAiMode(mode: AiMode) {
    this.aiMode = mode;
    this.#write('replace');
  }

  #finished() {
    jobs.refresh();
    this.decisionsVersion++;
  }

  /** Swap the open analysis; an old link carries no symbol, so the run's own ticker becomes the focus. */
  #replaceRun(id: string, adoptSymbol: boolean) {
    this.run?.destroy();
    const stream = new RunStream(id, () => this.#finished());
    this.run = stream;
    if (!adoptSymbol) return;
    stream.ready.then(() => {
      if (this.run === stream && stream.ticker) {
        this.symbol = toTradingView(stream.ticker);
        this.#write('replace');
      }
    });
  }

  #read(hash: string) {
    const raw = hash.replace(/^#/, '') || '/';
    const at = raw.indexOf('?');
    const path = at < 0 ? raw : raw.slice(0, at) || '/';
    // The admin console (App.svelte) owns #/admin; the workspace leaves that address alone.
    if (path === '/admin' || path.startsWith('/admin/')) return;
    const q = new URLSearchParams(at < 0 ? '' : raw.slice(at + 1));

    let legacy = path !== '/';
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/analyses\/([0-9a-f-]{36})$/))) q.set('run', m[1]);
    else if ((m = path.match(/^\/backtests\/([0-9a-f-]{36})$/))) q.set('bt', m[1]);
    else if (path === '/backtests') q.set('dock', 'history');
    else if (path === '/markets' && q.get('tab')) q.set('m', q.get('tab')!);

    // A canonical URL (one this class wrote) states the whole state; anything
    // else (a widget click, an old link) only changes what it names.
    const canonical = q.has('s') && !legacy;
    const ticker = q.get('ticker');
    const symbol = q.get('s') ?? q.get('symbol') ?? q.get('tvwidgetsymbol') ?? (ticker ? toTradingView(ticker) : null);
    if (symbol) this.symbol = symbol.toUpperCase();
    if (q.has('tvwidgetsymbol') || q.has('symbol') || ticker) legacy = true;
    if (q.has('tvwidgetsymbol')) {
      // Picked in a widget: show the chart, as setSymbol() does for our own lists.
      this.marketDrawer = false;
      if (this.mobileTab === 'market') this.mobileTab = 'chart';
    }

    const market = q.get('m');
    if (market && MARKET_TABS.some((t) => t.key === market)) this.market = market;
    else if (canonical) this.market = 'idx';
    const view = q.get('v');
    if (view === 'ai' || view === 'tv') this.chartView = view;
    else if (canonical) this.chartView = 'tv';
    const tf = q.get('tf') as Interval | null;
    if (tf && INTERVALS.includes(tf)) this.timeframe = tf;
    else if (canonical) this.timeframe = '1d';
    // An old link to one analysis or backtest also shows it in the AI panel.
    const ai =
      q.get('ai') ??
      (q.get('mode') === 'backtest' || path.startsWith('/backtests/')
        ? 'backtest'
        : path.startsWith('/analyses/')
          ? 'analysis'
          : null);
    if (ai === 'chat' || ai === 'analysis' || ai === 'backtest') this.aiMode = ai;
    else if (canonical) this.aiMode = 'analysis';

    const run = q.get('run');
    if (run && ID.test(run)) {
      if (this.run?.id !== run) this.#replaceRun(run, !symbol);
    } else if (canonical && this.run) {
      this.run.destroy();
      this.run = null;
    }

    const bt = q.get('bt');
    if (bt && ID.test(bt)) {
      if (this.backtest?.id !== bt) {
        this.backtest?.destroy();
        this.backtest = new BacktestStream(bt, () => this.#finished());
      }
    } else if (canonical && this.backtest) {
      this.backtest.destroy();
      this.backtest = null;
    }

    const dock = q.get('dock') as DockTab | null;
    if (dock && DOCK_TABS.includes(dock)) this.dock = dock;
    else if (path.startsWith('/analyses/')) this.dock = 'report';
    else if (path.startsWith('/backtests/')) this.dock = 'backtest';
    else if (canonical) this.dock = 'history';

    if (legacy || !canonical) this.#write('replace');
  }

  #write(mode: 'push' | 'replace') {
    const q = new URLSearchParams();
    q.set('s', this.symbol);
    if (this.run) q.set('run', this.run.id);
    if (this.backtest) q.set('bt', this.backtest.id);
    if (this.dock !== 'history') q.set('dock', this.dock);
    if (this.market !== 'idx') q.set('m', this.market);
    if (this.chartView !== 'tv') q.set('v', this.chartView);
    if (this.timeframe !== '1d') q.set('tf', this.timeframe);
    if (this.aiMode !== 'analysis') q.set('ai', this.aiMode);
    const hash = `#/?${q}`;
    if (location.hash === hash) return;
    // pushState/replaceState do not fire hashchange, so this never loops back into #read.
    history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', hash);
  }
}

export const ws = new Workspace();
