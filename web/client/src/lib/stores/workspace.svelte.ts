// The workspace's shared state: which screen is open, which symbol is in focus, which
// analysis and backtest are open, and which tab each screen shows. Screens and panels read
// and change this; they never navigate themselves. The state lives in the URL hash so links
// can be shared and Back works:  #/riset?s=IDX:BBCA&run=<id>&dock=log&tf=4h
//
// Pasar and Riset AI open at their start: Pasar's market board, Riset AI's asset picker. A
// symbol in the URL (s=) means the chart is open there; the top bar's buttons go back to the
// start. The symbols lately opened are kept in this browser, for Riset AI's quick switch.
//
// Links from before the screens (#/?s=…&run=…, #/analyses/:id, #/backtests/:id,
// #/chart?symbol=…, #/markets?tab=…, #/?ticker=…) are read too, sent to the screen that now
// holds what they name, and rewritten to that form, as is Indikator saya's tab from before it
// joined Uji indikator (dock=library). A TradingView widget click arrives as ?tvwidgetsymbol=…
// and opens that symbol's chart.
import { INTERVALS, type Interval } from '../api';
import { marketOf, symbolsOf } from '../assets';
import { acceptHandoffs } from '../tabs';
import { MARKET_TABS, toTradingView, toYahoo } from '../tv';
import { BacktestStream } from './backtest.svelte';
import { jobs } from './jobs.svelte';
import type { IconName } from '../workspace/icons';
import { lab } from './lab.svelte';
import { RunStream } from './run.svelte';
import { layoutOf, viewport } from './viewport.svelte';

export type Screen = 'beranda' | 'pasar' | 'riset' | 'pantau' | 'uji';
/** The screens that show the chart, with panels around it. */
export type ChartScreen = 'pasar' | 'riset';
export type DockTab = 'history' | 'report' | 'log' | 'backtest' | 'lab' | 'signals' | 'watch' | 'alerts' | 'journal' | 'screener';
export type DockSize = 'min' | 'normal' | 'max';
export type AiMode = 'chat' | 'analysis';
export type ChartView = 'tv' | 'ai';
/** On a phone a chart screen shows one thing at a time: the chart, its side panel, or one of its tabs. */
export type PhonePane = 'chart' | 'side' | 'dock';

const DOCK_TABS: DockTab[] = ['history', 'report', 'log', 'backtest', 'lab', 'signals', 'watch', 'alerts', 'journal', 'screener'];

/** The AI panel's two tabs: ask the agent, or run a full analysis. */
export const AI_MODES: { key: AiMode; label: string }[] = [
  { key: 'chat', label: 'Tanya' },
  { key: 'analysis', label: 'Analisa' },
];
/** What the market panel shows, named as a tab where Pasar is one column (a phone). */
export const MARKET_LIST_LABEL = 'Daftar harga';

/**
 * The app's screens, in the top bar's order, each with the tabs it holds: on Pasar and Riset
 * AI they fill the bottom panel under the chart, on Pantau and Uji strategi the whole page.
 */
export const SCREENS: {
  key: Screen;
  label: string;
  /** `hint` says what a tab is for, `short` names it on a phone, `apart` sets it off the screen's path, `icon` when not its key's. */
  tabs: { key: DockTab; label: string; hint?: string; short?: string; apart?: boolean; icon?: IconName }[];
}[] = [
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
      { key: 'watch', label: 'Pantauanku' },
      { key: 'alerts', label: 'Alert' },
      { key: 'journal', label: 'Jurnal' },
    ],
  },
  {
    key: 'uji',
    label: 'Uji strategi',
    // In the order a trader works: pick or write an indicator, see it on a chart and test it on
    // history (one tab, keyed 'lab' as Uji indikator was before Indikator saya joined it), then
    // follow its live record. Testing the AI's own calls is a path of its own, set apart.
    tabs: [
      { key: 'lab', label: 'Indikator', hint: 'Pilih, lihat di chart, lalu uji', short: 'Indikator', icon: 'library' },
      { key: 'signals', label: 'Rekam jejak live', hint: 'Sinyal nyata, setelah biaya', short: 'Live' },
      { key: 'backtest', label: 'Uji saran AI', hint: 'Seberapa sering AI benar', short: 'Saran AI', apart: true },
    ],
  },
];

/** The screen a tab belongs to. */
export const screenOf = (tab: DockTab): Screen => SCREENS.find((s) => s.tabs.some((t) => t.key === tab))?.key ?? 'riset';
export const isChartScreen = (s: Screen): s is ChartScreen => s === 'pasar' || s === 'riset';
const DEFAULT_TAB: Record<Exclude<Screen, 'beranda'>, DockTab> = { pasar: 'screener', riset: 'history', pantau: 'watch', uji: 'lab' };
const SCREEN_PATH = /^\/(beranda|pasar|riset|pantau|uji)$/;
/** The chart a browser that never opened an asset starts on: crypto trades all day, so it always moves. */
const DEFAULT_SYMBOL = 'BINANCE:BTCUSDT';
const ID = /^[0-9a-f-]{36}$/;
/** An asset as the engine spells it (BBCA.JK, BTC-USD, GC=F), for a link to one asset's calls. */
const YAHOO = /^[A-Z0-9.^=-]{1,20}$/;
/** On a wide screen Pasar is always split, its list beside a chart (ADR 0018); a phone starts at its board. */
const splitPasar = () => layoutOf(viewport) !== 'narrow';

class Workspace {
  screen = $state<Screen>('beranda');
  /** The symbol in focus, as TradingView spells it (IDX:BBCA). */
  symbol = $state(rememberedRecent()[0] ?? DEFAULT_SYMBOL);
  /** Whether each chart screen shows its chart, or its start: Pasar's market board, Riset AI's asset picker. */
  open = $state<Record<ChartScreen, boolean>>({ pasar: false, riset: false });
  /** Symbols lately opened on a chart, newest first, kept in this browser. */
  recent = $state<string[]>(rememberedRecent());
  /** The same symbol as the engine spells it (BBCA.JK), or null when it cannot be analysed. */
  yahoo = $derived(toYahoo(this.symbol));
  market = $state('idx');
  chartView = $state<ChartView>('ai');
  /** Candle timeframe of the AI chart; the engine itself only ever sees daily bars. */
  timeframe = $state<Interval>('1d');
  aiMode = $state<AiMode>('analysis');
  /** The tab the open screen shows (in its bottom panel, or as its page). */
  dock = $state<DockTab>('history');
  /**
   * Beranda shows Riwayat call in place of its summary (ADR 0021) while this is set: every call, or one
   * asset's, or those since a moment (the last visit, from "Sejak kamu terakhir buka").
   */
  calls = $state<{ symbol: string | null; since: string | null } | null>(null);
  /**
   * How far each chart screen's bottom panel is open. Both start folded to their tabs, one click
   * away, so the chart gets the height; Riset AI's opens by itself for an analysis (its report or
   * log) and for a link that names a tab.
   */
  #dockSizes = $state<Record<ChartScreen, DockSize>>({ pasar: 'min', riset: 'min' });
  get dockSize(): DockSize {
    return isChartScreen(this.screen) ? this.#dockSizes[this.screen] : 'normal';
  }
  set dockSize(size: DockSize) {
    if (isChartScreen(this.screen)) this.#dockSizes[this.screen] = size;
  }
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

  /** Open a screen as it was left; Pasar and Riset AI open at their start (on a wide screen Pasar's start is its chart: keepChart). */
  go(screen: Screen) {
    // Beranda in the menu is its summary, also from Riwayat call.
    if (screen === 'beranda') this.calls = null;
    if (screen !== 'beranda' && screenOf(this.dock) !== screen) this.dock = this.#resume(screen);
    if (isChartScreen(screen)) this.open[screen] = screen === 'pasar' && splitPasar();
    if (this.open.pasar && screen === 'pasar') this.market = marketOf(this.symbol) ?? this.market;
    this.screen = screen;
    this.#write('push');
  }

  /** Riwayat call on Beranda: every call of the member's notifications, or one asset's, or those since a moment. */
  openCalls(filter: { symbol?: string | null; since?: string | null } = {}) {
    this.screen = 'beranda';
    this.calls = { symbol: filter.symbol ?? null, since: filter.since ?? null };
    this.#write('push');
  }

  /** Riwayat call narrowed or widened in place: Back still leaves it in one step. */
  filterCalls(filter: { symbol?: string | null; since?: string | null }) {
    if (!this.calls) return;
    this.calls = { ...this.calls, ...filter };
    this.#write('replace');
  }

  /** Back from Riwayat call to Beranda's summary. */
  closeCalls() {
    this.calls = null;
    this.#write('push');
  }

  /** A symbol picked from a list: its chart opens, on Pasar unless Riset AI is open (to ask about it). */
  setSymbol(tv: string) {
    const next = tv.trim().toUpperCase();
    if (!next) return;
    const shown = isChartScreen(this.screen) && this.open[this.screen];
    const moved = this.#toChart();
    if (next === this.symbol && shown && !moved) return;
    this.#focus(next);
    this.#write('push');
  }

  /** Riset AI on a symbol, from the Pasar chart: it opens there without being picked again. */
  research(tv = this.symbol) {
    if (screenOf(this.dock) !== 'riset') this.dock = this.#resume('riset');
    this.screen = 'riset';
    this.open.riset = true;
    this.phonePane.riset = 'chart';
    this.#focus(tv.trim().toUpperCase());
    this.#write('push');
  }

  /**
   * Riset AI's start (ADR 0019): a symbol picked in its list is shown beside it. No chart opens, and the recent
   * list keeps its order, so the rows do not move under the pointer while the user looks around.
   */
  preview(tv: string) {
    const next = tv.trim().toUpperCase();
    if (!next) return;
    this.symbol = next;
    this.market = marketOf(next) ?? this.market;
  }

  /** Pasar on a wide screen always shows a chart beside its list (ADR 0018): the symbol in focus, with no history entry of its own. */
  keepChart() {
    if (this.screen !== 'pasar' || this.open.pasar) return;
    this.open.pasar = true;
    // The list opens on the chart's market, so the two never show different markets.
    this.market = marketOf(this.symbol) ?? this.market;
    this.#write('replace');
  }

  /** From a chart back to its screen's start: Pasar's market board (on a phone), Riset AI's asset picker. */
  closeChart() {
    if (!isChartScreen(this.screen) || (this.screen === 'pasar' && splitPasar())) return;
    this.open[this.screen] = false;
    this.#write('push');
  }

  /** The next or previous asset in the open symbol's market list (Alt+↑/↓), without a history entry each. */
  step(by: 1 | -1) {
    if (!isChartScreen(this.screen) || !this.open[this.screen]) return;
    const list = symbolsOf(marketOf(this.symbol) ?? this.market);
    if (!list.length) return;
    const at = list.indexOf(this.symbol);
    this.#focus(list[at < 0 ? 0 : (at + by + list.length) % list.length]);
    this.#write('replace');
  }

  /** The chart of the symbol in focus, opened from a screen without one. */
  showChart() {
    this.#toChart();
    this.#write('push');
  }

  /** Open an analysis; `symbol` also brings its ticker into focus in the same history entry. */
  openRun(id: string, { show = true, symbol = '' } = {}) {
    if (symbol) this.#focus(symbol.toUpperCase());
    this.open.riset = true;
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
    return (tab === 'report' && !!this.run?.live) || (tab === 'backtest' && !!this.backtest?.live) || (tab === 'lab' && lab.busy);
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
    this.open[target] = true;
    this.phonePane[target] = 'chart';
    return moved;
  }

  /** Bring a symbol into focus: the market list turns to its market, and it heads the recent ones. */
  #focus(tv: string) {
    this.symbol = tv;
    const market = marketOf(tv);
    if (market) this.market = market;
    this.recent = [tv, ...this.recent.filter((s) => s !== tv)].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    } catch {
      /* remembering is a convenience */
    }
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
    // Indikator saya had a tab of its own until it joined Uji indikator.
    if (q.get('dock') === 'library') {
      legacy = true;
      q.set('dock', 'lab');
    }

    // A canonical URL (one this class wrote: a screen path) states the whole state; anything
    // else (a widget click, an old link) only changes what it names.
    const ticker = q.get('ticker');
    const symbol = q.get('s') ?? q.get('symbol') ?? q.get('tvwidgetsymbol') ?? (ticker ? toTradingView(ticker) : null);
    if (symbol) this.#focus(symbol.toUpperCase());
    if (q.has('tvwidgetsymbol') || q.has('symbol') || ticker) legacy = true;
    const canonical = !legacy;

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

    // A chart screen shows its chart when the URL names a symbol (or, on Riset AI, an analysis).
    // A wide Pasar shows the chart of the symbol in focus even when the URL names none.
    if (isChartScreen(this.screen)) this.open[this.screen] = Boolean(symbol) || (this.screen === 'riset' && q.has('run')) || (this.screen === 'pasar' && splitPasar());
    const filled = this.screen === 'pasar' && this.open.pasar && !symbol;

    const market = q.get('m');
    if (market && MARKET_TABS.some((t) => t.key === market)) this.market = market;
    else if (canonical) this.market = marketOf((symbol ?? (filled ? this.symbol : '')).toUpperCase()) || 'idx';
    const view = q.get('v');
    // The AI chart is the default: the app's own indicators, signals and notifications live there.
    if (view === 'ai' || view === 'tv') this.chartView = view;
    else if (canonical) this.chartView = 'ai';
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
    // Riwayat call is Beranda's own view; a link names it, and the asset or moment it was opened for.
    if (screen !== 'beranda') this.calls = null;
    else if (q.get('view') === 'calls') {
      const asset = q.get('asset')?.toUpperCase() ?? null;
      const since = q.get('since');
      this.calls = { symbol: asset && YAHOO.test(asset) ? asset : null, since: since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null };
    } else if (canonical) this.calls = null;
    // A link to an analysis, or one naming a bottom tab, shows that panel open.
    if (isChartScreen(screen) && ((screen === 'riset' && this.run) || (dock && screenOf(dock) === screen))) this.#dockSizes[screen] = 'normal';
    if (screen !== 'beranda') {
      // A canonical URL leaves out the screen's default tab; an old link to an analysis opens
      // its report; a bare screen path (the top bar, a typed URL) finds the screen as it was left.
      if (dock && screenOf(dock) === screen) this.dock = dock;
      else if (legacy && screen === 'riset' && run) this.dock = 'report';
      // A link to a backtest from before Uji indikator led the screen names no tab.
      else if (screen === 'uji' && q.has('bt')) this.dock = 'backtest';
      else if (canonical) this.dock = DEFAULT_TAB[screen];
      else if (screenOf(this.dock) !== screen) this.dock = this.#resume(screen);
      this.#lastTab[screen] = this.dock;
    }

    if (legacy || !canonical || filled) this.#write('replace');
  }

  #write(mode: 'push' | 'replace') {
    const q = new URLSearchParams();
    if (isChartScreen(this.screen) && this.open[this.screen]) q.set('s', this.symbol);
    if (this.run) q.set('run', this.run.id);
    if (this.backtest) q.set('bt', this.backtest.id);
    if (this.screen !== 'beranda' && this.dock !== DEFAULT_TAB[this.screen]) q.set('dock', this.dock);
    if (this.screen === 'beranda' && this.calls) {
      q.set('view', 'calls');
      if (this.calls.symbol) q.set('asset', this.calls.symbol);
      if (this.calls.since) q.set('since', this.calls.since);
    }
    if (this.market !== 'idx') q.set('m', this.market);
    if (this.chartView !== 'ai') q.set('v', this.chartView);
    if (this.timeframe !== '1d') q.set('tf', this.timeframe);
    if (this.aiMode !== 'analysis') q.set('ai', this.aiMode);
    const query = q.toString();
    const hash = `#/${this.screen}${query ? `?${query}` : ''}`;
    if (location.hash === hash) return;
    // pushState/replaceState do not fire hashchange, so this never loops back into #read.
    history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', hash);
  }
}

const RECENT_KEY = 'ta.recent';
const RECENT_MAX = 6;

/** The symbols this browser opened lately, newest first. */
function rememberedRecent(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && /^[A-Z0-9_.:!=^&-]{1,40}$/.test(s)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export const ws = new Workspace();
