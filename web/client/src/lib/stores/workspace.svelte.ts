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

export type DockTab = 'history' | 'report' | 'log' | 'backtest' | 'watch' | 'signals' | 'alerts' | 'lab' | 'screener';
export type DockSize = 'min' | 'normal' | 'max';
export type AiMode = 'chat' | 'analysis';
export type ChartView = 'tv' | 'ai';
export type Destination = 'pasar' | 'riset' | 'pantau' | 'uji';
/** A phone shows one screen at a time: the chart, or one destination. */
export type MobileTab = 'chart' | Destination;

const DOCK_TABS: DockTab[] = ['history', 'report', 'log', 'backtest', 'watch', 'signals', 'alerts', 'lab', 'screener'];

/** The AI panel's two tabs: ask the agent, or run a full analysis. */
export const AI_MODES: { key: AiMode; label: string }[] = [
  { key: 'chat', label: 'Tanya' },
  { key: 'analysis', label: 'Jalankan' },
];
/** What the market panel shows, named as a tab where Pasar is one screen (a phone). */
export const MARKET_LIST_LABEL = 'Daftar harga';

/**
 * Where the rail goes, named for the work done there. A destination opens its side panel, if
 * it has one, and the bottom panel on its tabs; on a phone it is one screen holding both.
 */
export const DESTINATIONS: { key: Destination; label: string; panel: 'market' | 'ai' | null; tabs: { key: DockTab; label: string }[] }[] = [
  { key: 'pasar', label: 'Pasar', panel: 'market', tabs: [{ key: 'screener', label: 'Screener' }] },
  {
    key: 'riset',
    label: 'Riset AI',
    panel: 'ai',
    tabs: [
      { key: 'history', label: 'Riwayat' },
      { key: 'report', label: 'Laporan' },
      { key: 'log', label: 'Log' },
    ],
  },
  {
    key: 'pantau',
    label: 'Pantau & alert',
    panel: null,
    tabs: [
      { key: 'watch', label: 'Analisa terjadwal' },
      { key: 'signals', label: 'Sinyal' },
      { key: 'alerts', label: 'Alert' },
    ],
  },
  {
    key: 'uji',
    label: 'Uji strategi',
    panel: null,
    tabs: [
      { key: 'backtest', label: 'Backtest' },
      { key: 'lab', label: 'Lab' },
    ],
  },
];

/** The destination a bottom-panel tab belongs to. */
export const destinationOf = (tab: DockTab) => DESTINATIONS.find((d) => d.tabs.some((t) => t.key === tab)) ?? DESTINATIONS[1];
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
  /** On a phone, whether a destination's screen shows its side panel (the market list, the AI) or a bottom-panel tab. */
  phonePane = $state<Record<Destination, 'side' | 'dock'>>({ pasar: 'side', riset: 'side', pantau: 'dock', uji: 'dock' });
  marketDrawer = $state(false);
  run = $state<RunStream | null>(null);
  backtest = $state<BacktestStream | null>(null);
  /** Bumped when a run or backtest finishes, so decision markers reload. */
  decisionsVersion = $state(0);
  /** The tab each destination showed last, so going back to one finds it as it was left. */
  #lastTab: Record<Destination, DockTab> = { pasar: 'screener', riset: 'history', pantau: 'watch', uji: 'backtest' };

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
    // On a phone a symbol picked from any list opens its chart; Riset AI stays, to ask about it.
    if (this.mobileTab !== 'riset') this.mobileTab = 'chart';
    if (!next || next === this.symbol) return;
    this.symbol = next;
    this.#write('push');
  }

  /** Open an analysis; `symbol` also brings its ticker into focus in the same history entry. */
  openRun(id: string, { show = true, symbol = '' } = {}) {
    if (symbol) this.symbol = symbol.toUpperCase();
    if (this.run?.id !== id) this.#replaceRun(id, false);
    this.aiMode = 'analysis';
    if (show) this.#show(this.dock === 'log' ? 'log' : 'report');
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
    if (show) this.#show('backtest');
    this.#write('push');
  }

  /** Back to the Backtest tab's list and form. */
  closeBacktest() {
    this.backtest?.destroy();
    this.backtest = null;
    this.#write('push');
  }

  setDock(tab: DockTab) {
    this.#show(tab);
    this.#write('replace');
  }

  /** Open a destination's tabs in the bottom panel, on the tab it showed last. */
  openDestination(key: Destination) {
    this.#lastTab[destinationOf(this.dock).key] = this.dock;
    this.setDock(this.#resume(key));
  }

  /** A phone's tab bar: the chart, or a destination's screen as it was left. */
  goPhone(tab: MobileTab) {
    const from = destinationOf(this.dock).key;
    if (tab !== 'chart' && tab !== from) {
      this.#lastTab[from] = this.dock;
      this.dock = this.#resume(tab);
      this.#write('replace');
    }
    this.mobileTab = tab;
  }

  /** Where a destination was left, except a report or log whose analysis has since closed: that would be empty. */
  #resume(key: Destination): DockTab {
    const tab = this.#lastTab[key];
    return (tab === 'report' || tab === 'log') && !this.run ? 'history' : tab;
  }

  /** A bottom-panel tab whose job is still running. */
  live(tab: DockTab) {
    return (tab === 'report' && !!this.run?.live) || (tab === 'backtest' && !!this.backtest?.live);
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
    this.phonePane.riset = 'side';
    this.#write('replace');
  }

  /** Bring a bottom-panel tab into view; a phone moves to the screen that holds it. */
  #show(tab: DockTab) {
    this.dock = tab;
    if (this.dockSize === 'min') this.dockSize = 'normal';
    if (this.mobileTab === 'chart') return;
    const key = destinationOf(tab).key;
    this.mobileTab = key;
    this.phonePane[key] = 'dock';
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
    else if (path === '/backtests') q.set('dock', 'backtest');
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
      if (this.mobileTab !== 'riset') this.mobileTab = 'chart';
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
    // Backtests used to open in the AI panel; their tab is under Uji strategi now.
    if (q.get('ai') === 'backtest' || q.get('mode') === 'backtest') {
      legacy = true;
      if (!q.has('dock')) q.set('dock', 'backtest');
    }
    const ai = q.get('ai') ?? (path.startsWith('/analyses/') ? 'analysis' : null);
    if (ai === 'chat' || ai === 'analysis') this.aiMode = ai;
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
