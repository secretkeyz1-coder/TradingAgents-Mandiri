// The workspace's shared state: which screen is open, which symbol is in focus, which
// analysis and backtest are open, and which tab each screen shows. Screens and panels read
// and change this; they never navigate themselves. The state lives in the URL hash so links
// can be shared and Back works:  #/riset?s=IDX:BBCA&run=<id>&dock=log&tf=4h
//
// Links from before the screens (#/?s=…&run=…, #/analyses/:id, #/backtests/:id,
// #/chart?symbol=…, #/markets?tab=…, #/?ticker=…) are read too, sent to the screen that now
// holds what they name, and rewritten to that form. A TradingView widget click arrives as
// ?tvwidgetsymbol=… and opens that symbol's chart.
import { INTERVALS, type Interval } from '../api';
import { acceptHandoffs } from '../tabs';
import { MARKET_TABS, toTradingView, toYahoo } from '../tv';
import { BacktestStream } from './backtest.svelte';
import { jobs } from './jobs.svelte';
import { RunStream } from './run.svelte';

export type Screen = 'beranda' | 'pasar' | 'riset' | 'pantau' | 'uji';
/** The screens that show the chart, with panels around it. */
export type ChartScreen = 'pasar' | 'riset';
export type DockTab = 'history' | 'report' | 'log' | 'backtest' | 'lab' | 'signals' | 'watch' | 'alerts' | 'screener';
export type DockSize = 'min' | 'normal' | 'max';
export type AiMode = 'chat' | 'analysis';
export type ChartView = 'tv' | 'ai';
/** On a phone a chart screen shows one thing at a time: the chart, its side panel, or one of its tabs. */
export type PhonePane = 'chart' | 'side' | 'dock';

const DOCK_TABS: DockTab[] = ['history', 'report', 'log', 'backtest', 'lab', 'signals', 'watch', 'alerts', 'screener'];

/** The AI panel's two tabs: ask the agent, or run a full analysis. */
export const AI_MODES: { key: AiMode; label: string }[] = [
  { key: 'chat', label: 'Tanya' },
  { key: 'analysis', label: 'Jalankan' },
];
/** What the market panel shows, named as a tab where Pasar is one column (a phone). */
export const MARKET_LIST_LABEL = 'Daftar harga';

/**
 * The app's screens, in the top bar's order, each with the tabs it holds: on Pasar and Riset
 * AI they fill the bottom panel under the chart, on Pantau and Uji strategi the whole page.
 */
export const SCREENS: { key: Screen; label: string; tabs: { key: DockTab; label: string }[] }[] = [
  { key: 'beranda', label: 'Beranda', tabs: [] },
  { key: 'pasar', label: 'Pasar', tabs: [{ key: 'screener', label: 'Screener' }] },
  {
    key: 'riset',
    label: 'Riset AI',
    tabs: [
      { key: 'history', label: 'Riwayat' },
      { key: 'report', label: 'Laporan' },
      { key: 'log', label: 'Log' },
    ],
  },
  {
    key: 'pantau',
    label: 'Pantau',
    tabs: [
      { key: 'watch', label: 'Analisa terjadwal' },
      { key: 'alerts', label: 'Alert' },
    ],
  },
  {
    key: 'uji',
    label: 'Uji strategi',
    tabs: [
      { key: 'backtest', label: 'Backtest' },
      { key: 'lab', label: 'Lab' },
      { key: 'signals', label: 'Strategi live' },
    ],
  },
];

/** The screen a tab belongs to. */
export const screenOf = (tab: DockTab): Screen => SCREENS.find((s) => s.tabs.some((t) => t.key === tab))?.key ?? 'riset';
export const isChartScreen = (s: Screen): s is ChartScreen => s === 'pasar' || s === 'riset';
const DEFAULT_TAB: Record<Exclude<Screen, 'beranda'>, DockTab> = { pasar: 'screener', riset: 'history', pantau: 'watch', uji: 'backtest' };
const SCREEN_PATH = /^\/(beranda|pasar|riset|pantau|uji)$/;
const DEFAULT_SYMBOL = 'IDX:COMPOSITE';
const ID = /^[0-9a-f-]{36}$/;

class Workspace {
  screen = $state<Screen>('beranda');
  /** The symbol in focus, as TradingView spells it (IDX:BBCA). */
  symbol = $state(DEFAULT_SYMBOL);
  /** The same symbol as the engine spells it (BBCA.JK), or null when it cannot be analysed. */
  yahoo = $derived(toYahoo(this.symbol));
  market = $state('idx');
  chartView = $state<ChartView>('tv');
  /** Candle timeframe of the AI chart; the engine itself only ever sees daily bars. */
  timeframe = $state<Interval>('1d');
  aiMode = $state<AiMode>('analysis');
  /** The tab the open screen shows (in its bottom panel, or as its page). */
  dock = $state<DockTab>('history');
  dockSize = $state<DockSize>('normal');
  /** On a phone, what each chart screen shows; leaving and coming back finds it as it was. */
  phonePane = $state<Record<ChartScreen, PhonePane>>({ pasar: 'chart', riset: 'side' });
  run = $state<RunStream | null>(null);
  backtest = $state<BacktestStream | null>(null);
  /** Bumped when a run or backtest finishes, so decision markers reload. */
  decisionsVersion = $state(0);
  /** The tab each screen showed last, so going back to one finds it as it was left. */
  #lastTab = { ...DEFAULT_TAB };

  constructor() {
    this.#read(location.hash);
    // Back/Forward between pushState entries; a widget click or a typed URL fires hashchange.
    // Reading twice is harmless: #read only assigns what the URL names.
    window.addEventListener('popstate', () => this.#read(location.hash));
    window.addEventListener('hashchange', () => this.#read(location.hash));
    // A symbol clicked in a TradingView widget opens a new tab, which hands it here instead.
    acceptHandoffs((symbol) => this.setSymbol(symbol));
  }

  /** Open a screen as it was left. */
  go(screen: Screen) {
    if (screen !== 'beranda' && screenOf(this.dock) !== screen) this.dock = this.#resume(screen);
    this.screen = screen;
    this.#write('push');
  }

  /** A symbol picked from a list: its chart opens, on Pasar unless Riset AI is open (to ask about it). */
  setSymbol(tv: string) {
    const next = tv.trim().toUpperCase();
    const moved = this.#toChart();
    if (!next || next === this.symbol) {
      if (moved) this.#write('push');
      return;
    }
    this.symbol = next;
    this.#write('push');
  }

  /** The chart of the symbol in focus, opened from a screen without one. */
  showChart() {
    this.#toChart();
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

  /** Show a tab; one that belongs to another screen opens that screen. */
  setDock(tab: DockTab) {
    const from = this.screen;
    this.#show(tab);
    this.#write(from === this.screen ? 'replace' : 'push');
  }

  /** A phone's tab row on a chart screen: the chart or the side panel (setDock covers the tabs). */
  setPhonePane(screen: ChartScreen, pane: Exclude<PhonePane, 'dock'>) {
    this.phonePane[screen] = pane;
  }

  /** A tab whose job is still running. */
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

  /** Where a screen was left, except a report or log whose analysis has since closed: that would be empty. */
  #resume(screen: Exclude<Screen, 'beranda'>): DockTab {
    const tab = this.#lastTab[screen];
    return (tab === 'report' || tab === 'log') && !this.run ? 'history' : tab;
  }

  #show(tab: DockTab) {
    this.dock = tab;
    const screen = screenOf(tab);
    this.screen = screen;
    if (screen !== 'beranda') this.#lastTab[screen] = tab;
    if (this.dockSize === 'min') this.dockSize = 'normal';
    if (isChartScreen(screen)) this.phonePane[screen] = 'dock';
  }

  /** Make the chart visible; true when that meant leaving the screen. */
  #toChart(): boolean {
    const target: ChartScreen = this.screen === 'riset' ? 'riset' : 'pasar';
    const moved = this.screen !== target;
    if (moved && screenOf(this.dock) !== target) this.dock = this.#resume(target);
    this.screen = target;
    this.phonePane[target] = 'chart';
    return moved;
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
    const named = path.match(SCREEN_PATH)?.[1] as Screen | undefined;

    // Anything but a screen path is a link from before the screens.
    let legacy = !named;
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/analyses\/([0-9a-f-]{36})$/))) q.set('run', m[1]);
    else if ((m = path.match(/^\/backtests\/([0-9a-f-]{36})$/))) q.set('bt', m[1]);
    else if (path === '/backtests') q.set('dock', 'backtest');
    else if (path === '/markets' && q.get('tab')) q.set('m', q.get('tab')!);
    // Backtests used to open in the AI panel; they have their own tab under Uji strategi now.
    if (q.get('ai') === 'backtest' || q.get('mode') === 'backtest') {
      legacy = true;
      if (!q.has('dock')) q.set('dock', 'backtest');
    }

    // A canonical URL (one this class wrote) states the whole state; anything
    // else (a widget click, an old link) only changes what it names.
    const canonical = q.has('s') && !legacy;
    const ticker = q.get('ticker');
    const symbol = q.get('s') ?? q.get('symbol') ?? q.get('tvwidgetsymbol') ?? (ticker ? toTradingView(ticker) : null);
    if (symbol) this.symbol = symbol.toUpperCase();
    if (q.has('tvwidgetsymbol') || q.has('symbol') || ticker) legacy = true;

    const dockParam = q.get('dock') as DockTab | null;
    const dock = dockParam && DOCK_TABS.includes(dockParam) ? dockParam : null;
    if (named) this.screen = named;
    else if (q.has('tvwidgetsymbol')) this.#toChart();
    else if (dock) this.screen = screenOf(dock);
    else if (q.has('run')) this.screen = 'riset';
    else if (q.has('bt')) this.screen = 'uji';
    else if (q.has('ai')) this.screen = 'riset';
    else if (symbol || path === '/chart' || path === '/markets') this.screen = 'pasar';
    else if (path === '/') this.screen = 'beranda';

    const market = q.get('m');
    if (market && MARKET_TABS.some((t) => t.key === market)) this.market = market;
    else if (canonical) this.market = 'idx';
    const view = q.get('v');
    if (view === 'ai' || view === 'tv') this.chartView = view;
    else if (canonical) this.chartView = 'tv';
    const tf = q.get('tf') as Interval | null;
    if (tf && INTERVALS.includes(tf)) this.timeframe = tf;
    else if (canonical) this.timeframe = '1d';
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

    const screen = this.screen;
    if (screen !== 'beranda') {
      // A canonical URL leaves out the screen's default tab; an old link to an analysis opens
      // its report; a bare screen path (the top bar, a typed URL) finds the screen as it was left.
      if (dock && screenOf(dock) === screen) this.dock = dock;
      else if (legacy && screen === 'riset' && run) this.dock = 'report';
      else if (canonical) this.dock = DEFAULT_TAB[screen];
      else if (screenOf(this.dock) !== screen) this.dock = this.#resume(screen);
      this.#lastTab[screen] = this.dock;
    }

    if (legacy || !canonical) this.#write('replace');
  }

  #write(mode: 'push' | 'replace') {
    const q = new URLSearchParams();
    q.set('s', this.symbol);
    if (this.run) q.set('run', this.run.id);
    if (this.backtest) q.set('bt', this.backtest.id);
    if (this.screen !== 'beranda' && this.dock !== DEFAULT_TAB[this.screen]) q.set('dock', this.dock);
    if (this.market !== 'idx') q.set('m', this.market);
    if (this.chartView !== 'tv') q.set('v', this.chartView);
    if (this.timeframe !== '1d') q.set('tf', this.timeframe);
    if (this.aiMode !== 'analysis') q.set('ai', this.aiMode);
    const hash = `#/${this.screen}?${q}`;
    if (location.hash === hash) return;
    // pushState/replaceState do not fire hashchange, so this never loops back into #read.
    history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', hash);
  }
}

export const ws = new Workspace();
