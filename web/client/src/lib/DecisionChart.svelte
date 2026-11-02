<script lang="ts">
  // Candles (Yahoo, the engine's own source) with every AI decision on the
  // ticker marked where it was made, and how price moved over the next five
  // trading days. The TradingView widgets cannot take our markers; this can.
  // Timeframes other than daily are only for looking: the engine, the markers
  // and the agent's drawings are all made from daily bars, so here a date is
  // placed on the first bar of its day.
  import {
    CandlestickSeries,
    ColorType,
    createChart,
    createSeriesMarkers,
    HistogramSeries,
    LineSeries,
    LineStyle,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type SeriesMarker,
    type Time,
    type UTCTimestamp,
  } from 'lightweight-charts';
  import { onMount } from 'svelte';
  import { api, type Candle, type Decision, type Drawing, type Interval } from './api';
  import AlertsMenu from './chart/AlertsMenu.svelte';
  import IndicatorsMenu from './chart/IndicatorsMenu.svelte';
  import TradePlan, { type Plan } from './chart/TradePlan.svelte';
  import IndicatorPanel from './chart/IndicatorPanel.svelte';
  import ScriptsMenu from './chart/ScriptsMenu.svelte';
  import { runInSandbox } from './indicators/script-host';
  import { scripts } from './stores/scripts.svelte';
  import { toScriptBars, type ScriptRun } from '../../../shared/script';
  import Navigator from './chart/Navigator.svelte';
  import { BandPrimitive } from './chart/rectangle';
  import { ShapesPrimitive, type Shape } from './chart/shapes';
  import { formatPercent, ratingBadge, RATING_DIRECTION } from './format';
  import { assetCode, CRYPTO_VENUES, cryptoBase, type VenueId } from './tv';
  import VenuePanel from './chart/VenuePanel.svelte';
  import { fib, fibLevel } from './indicators/fib';
  import { pob, SETUPS } from './indicators/pob';
  import { scalper } from './indicators/scalper';
  import { chartPrefs } from './stores/chartPrefs.svelte';
  import { indicators } from './stores/indicators.svelte';
  import { theme, tokenColor } from './theme.svelte';

  let {
    symbol,
    decisions: given = undefined,
    highlightDate = undefined,
    height = 420,
    showTable = true,
    refresh = 0,
    drawings = [],
    timeframe: givenTimeframe = undefined,
    onTimeframe = undefined,
    jumpRequest = 0,
    tools = false,
    fill = true,
    venue = null,
    research = true,
  }: {
    /** Yahoo symbol, as the engine and the analyses store it (BBCA.JK). */
    symbol: string;
    /** Decisions to mark; fetched for the symbol when omitted. */
    decisions?: Decision[];
    highlightDate?: string;
    height?: number;
    showTable?: boolean;
    /** Change it to fetch the decisions again (e.g. after a run finishes). */
    refresh?: number;
    /** The chart agent's drawings for this symbol. */
    drawings?: Drawing[];
    /** Candle timeframe, when the caller owns it (the workspace keeps it in the URL); else chosen here. */
    timeframe?: Interval;
    onTimeframe?: (tf: Interval) => void;
    /** Bump it to open the jump-to-date box (the chart header's button). */
    jumpRequest?: number;
    /** The workspace chart: zoom, jump to date, navigator and indicators. */
    tools?: boolean;
    /**
     * With tools: fill the panel's height, the trading plan above the candles (a desktop panel).
     * False gives the candles `height` and puts the plan under them (a phone, whose panel scrolls).
     */
    fill?: boolean;
    /** For crypto: the venue whose candles to show (server/src/venues.ts); Binance when null. */
    venue?: VenueId | null;
    /** Load and mark the AI's decisions (Riset AI); off on Pasar, which shows the market without them. */
    research?: boolean;
  } = $props();

  // The engine scores a decision over this many trading days from the first close after its date.
  const HOLDING_DAYS = 5;
  const RANGES = [
    { value: '6mo', label: '6 bln', days: 182 },
    { value: '1y', label: '1 thn', days: 365 },
    { value: '2y', label: '2 thn', days: 730 },
    { value: '5y', label: '5 thn', days: 1826 },
  ] as const;
  type Range = (typeof RANGES)[number]['value'];
  // Words, not "1h": in TradingView beside this chart 1h is an hour, so a short "1h" for a day misleads.
  const TIMEFRAMES: { value: Interval; label: string; title: string }[] = [
    { value: '15m', label: '15 menit', title: '15 menit (1 bulan terakhir)' },
    { value: '1h', label: '1 jam', title: '1 jam' },
    { value: '4h', label: '4 jam', title: '4 jam' },
    { value: '1d', label: 'Harian', title: '1 hari' },
    { value: '1wk', label: 'Mingguan', title: '1 minggu' },
    { value: '1mo', label: 'Bulanan', title: '1 bulan' },
  ];
  // Yahoo keeps hourly bars for two years at most; the server clamps, the buttons say so.
  const INTRADAY_RANGES: Range[] = ['6mo', '1y'];

  let range = $state<Range>('1y');
  let ownTimeframe = $state<Interval>('1d');
  const timeframe = $derived(givenTimeframe ?? ownTimeframe);
  const intraday = $derived(timeframe === '15m' || timeframe === '1h' || timeframe === '4h');
  let candles = $state<Candle[]>([]);
  let currency = $state<string | null>(null);
  let source = $state<string | undefined>(undefined);
  const sourceLabel = $derived(CRYPTO_VENUES.find((v) => v.id === source)?.label ?? 'Binance');
  let loadError = $state('');
  let loading = $state(true);
  let fetched = $state<Decision[]>([]);
  const decisions = $derived(given ?? (research ? fetched : []));

  function pickTimeframe(tf: Interval) {
    if (onTimeframe) onTimeframe(tf);
    else ownTimeframe = tf;
    if ((tf === '15m' || tf === '1h' || tf === '4h') && !INTRADAY_RANGES.includes(range)) range = '1y';
  }

  // Candle times: a date for daily and up, the exchange's wall-clock time for
  // intraday. The chart wants the latter as UTC seconds, so the wall-clock time
  // is read as if it were UTC and the axis shows exchange time.
  const day = (t: string) => t.slice(0, 10);
  const toTime = (t: string): Time => (t.length > 10 ? (Math.floor(Date.parse(`${t}Z`) / 1000) as UTCTimestamp) : (t as Time));
  /** The first bar on or after a date, where dated things (decisions, notes, trendline ends) go. */
  const atDay = (date: string) => candles.find((c) => day(c.time) >= date)?.time;
  /** The bar holding a time ("YYYY-MM-DD HH:MM" or a date): on intraday charts the last bar starting at or before it. */
  const atBar = (when: string) => {
    if (!intraday || when.length <= 10) return atDay(day(when));
    const key = (t: string) => t.slice(0, 16).replace('T', ' ');
    return candles.findLast((c) => key(c.time) <= when)?.time ?? (candles.length && when < key(candles[0].time) ? candles[0].time : undefined);
  };
  /** Trading days on the chart, in order. */
  const days = $derived.by(() => {
    const out: string[] = [];
    for (const c of candles) if (out.at(-1) !== day(c.time)) out.push(day(c.time));
    return out;
  });
  const closeOfDay = (d: string) => candles.findLast((c) => day(c.time) === d)?.close;

  type Row = Decision & { markedAt: string | null; priceReturn: number | null; hit: boolean | null };

  const rows = $derived.by<Row[]>(() =>
    decisions.map((d) => {
      // First trading day after the decision: the engine's entry close. Weekly
      // and monthly bars have no daily closes, so only the engine's alpha counts there.
      const entry = days.findIndex((x) => x > d.date);
      const exitDay = entry >= 0 ? days[entry + HOLDING_DAYS] : undefined;
      const entryClose = exitDay ? closeOfDay(days[entry]) : undefined;
      const exitClose = exitDay ? closeOfDay(exitDay) : undefined;
      const priceReturn = !intraday && timeframe !== '1d' ? null : entryClose && exitClose ? exitClose / entryClose - 1 : null;
      const markedAt = atDay(d.date) ?? null;
      const direction = RATING_DIRECTION[d.rating] ?? 0;
      // A settled backtest cell is judged on the engine's alpha; anything else on price alone.
      const measure = d.alpha ?? priceReturn;
      const hit = direction && measure != null ? measure * direction > 0 : null;
      return { ...d, markedAt, priceReturn, hit };
    }),
  );
  const scored = $derived(rows.filter((r) => r.hit != null));
  const hitRate = $derived(scored.length ? scored.filter((r) => r.hit).length / scored.length : null);

  let container: HTMLDivElement;
  let chart: IChartApi | undefined;
  let candleSeries: ISeriesApi<'Candlestick'> | undefined;
  let volumeSeries: ISeriesApi<'Histogram'> | undefined;
  let markers: ISeriesMarkersPluginApi<Time> | undefined;
  let mounted = $state(false);

  // The canvas cannot read CSS variables, so the theme tokens are resolved to
  // rgba() here and again whenever the light/dark theme flips.
  const palette = $derived.by(() => {
    void theme.dark;
    return {
      up: tokenColor('--color-success'),
      down: tokenColor('--color-error'),
      neutral: tokenColor('--color-base-content', 0.45),
      upVolume: tokenColor('--color-success', 0.3),
      downVolume: tokenColor('--color-error', 0.3),
      text: tokenColor('--color-base-content', 0.75),
      grid: tokenColor('--color-base-300', 0.6),
      ink: tokenColor('--color-base-content', 0.85),
      accent: tokenColor('--color-accent'),
    };
  });

  // Agent drawings: price lines on the candle series, trendlines as two-point line series.
  let priceLines: IPriceLine[] = [];
  let lineSeries: ISeriesApi<'Line'>[] = [];
  const shapes = new ShapesPrimitive();
  $effect(() => {
    if (!mounted) return;
    const p = palette;
    void candles.length; // redraw once candles have loaded
    for (const line of priceLines) candleSeries!.removePriceLine(line);
    for (const s of lineSeries) chart!.removeSeries(s);
    priceLines = [];
    lineSeries = [];
    const level = (price: number, color: string, title: string, style = LineStyle.Dashed) =>
      priceLines.push(candleSeries!.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    const ROLE_TOKEN: Record<string, string> = { warning: '--color-warning', info: '--color-info' };
    const roleColor = (role: string) =>
      role === 'support' || role === 'demand' ? p.up : role === 'resistance' || role === 'supply' ? p.down : ROLE_TOKEN[role] ? tokenColor(ROLE_TOKEN[role]) : p.accent;
    const roleFill = (role: string) =>
      tokenColor(role === 'support' || role === 'demand' ? '--color-success' : role === 'resistance' || role === 'supply' ? '--color-error' : (ROLE_TOKEN[role] ?? '--color-accent'), 0.13);
    // A box carries its price range on its own tag: edges on the price axis piled up once there were a few zones.
    const range = (bottom: number, top: number) => {
      const short = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: v >= 1000 ? 0 : v >= 10 ? 2 : 4 });
      return `${short(bottom)}–${short(top)}`;
    };
    const drawn: Shape[] = [];
    // Agent drawings are priced in USD: on a rupiah venue they would land nowhere near the candles.
    for (const d of currency === 'IDR' ? [] : drawings) {
      const x = d.data;
      if (d.kind === 'level') level(x.price, roleColor(x.role), d.label);
      else if (d.kind === 'zone' || d.kind === 'box') {
        const from = d.kind === 'zone' ? candles[0]?.time : atBar(x.from);
        if (!from) continue;
        const end = d.kind === 'box' && x.to ? atBar(x.to) : undefined;
        // An end past the last bar keeps the box open to the right edge.
        const to = end && candles.length && end !== candles.at(-1)!.time ? end : null;
        const color = roleColor(x.role);
        const text = d.label ? `${d.label} · ${range(x.bottom, x.top)}` : range(x.bottom, x.top);
        drawn.push({ type: 'box', from: toTime(from), to: to ? toTime(to) : null, top: x.top, bottom: x.bottom, color, fill: roleFill(x.role), text });
      } else if (d.kind === 'label') {
        const at = atBar(x.time);
        if (at) drawn.push({ type: 'label', time: toTime(at), price: x.price, color: roleColor(x.role), text: x.text || d.label });
      } else if (d.kind === 'fib') {
        for (const f of x.levels) level(f.price, p.accent, `${(f.ratio * 100).toFixed(1)}%`, LineStyle.SparseDotted);
      } else if (d.kind === 'trade_plan') {
        level(x.entry, p.ink, 'Entry', LineStyle.Solid);
        level(x.stop, p.down, 'Stop', LineStyle.Solid);
        level(x.target, p.up, `Target · R/R ${x.rr}`, LineStyle.Solid);
      } else if (d.kind === 'trendline') {
        const from = atDay(x.from.time);
        const to = atDay(x.to.time);
        if (!from || !to || from >= to) continue;
        const s = chart!.addSeries(LineSeries, {
          color: roleColor(x.role),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData([
          { time: toTime(from), value: x.from.price },
          { time: toTime(to), value: x.to.price },
        ]);
        lineSeries.push(s);
      }
    }
    shapes.set(drawn, getComputedStyle(container).fontFamily);
  });

  onMount(() => {
    chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: true },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: 0 },
      // Month names and the crosshair's date in Indonesian, as on the Pemula chart (Okt, not Oct).
      localization: { locale: 'id-ID' },
    });
    // Prices read as everywhere else in the app (77.954,01); volume in Indonesian short form (5,6 rb, 196,6 jt).
    candleSeries = chart.addSeries(CandlestickSeries, { borderVisible: false, priceFormat: { type: 'custom', formatter: (p: number) => priceText(p), minMove: 0.00001 } });
    const compact = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
    volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'custom', formatter: (v: number) => compact.format(v), minMove: 1 }, priceScaleId: '' });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    markers = createSeriesMarkers(candleSeries, []);
    candleSeries.attachPrimitive(band);
    candleSeries.attachPrimitive(pobBand);
    candleSeries.attachPrimitive(fibBand);
    candleSeries.attachPrimitive(shapes);
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r) visible = { from: r.from, to: r.to };
    });
    mounted = true;
    return () => {
      chart?.remove();
      chart = undefined;
    };
  });

  $effect(() => {
    if (!mounted) return;
    const p = palette;
    chart!.applyOptions({
      layout: { textColor: p.text, fontFamily: getComputedStyle(container).fontFamily },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      timeScale: { timeVisible: intraday, secondsVisible: false },
    });
    candleSeries!.applyOptions({ upColor: p.up, downColor: p.down, wickUpColor: p.up, wickDownColor: p.down });
  });

  // --- Scalper Pro+ (indicators/scalper.ts), drawn from the same candles.
  const band = new BandPrimitive();
  const ind = $derived(tools && indicators.showScalper && candles.length ? scalper(candles, indicators.scalper) : null);
  /**
   * How Scalper's latest setup has gone since. The engine reports that setup even after it ended, so
   * the bars after it say whether the stop or the target was touched first (both in one bar counts as
   * the stop, the cautious reading). Only an open setup is a plan, or gets its levels drawn across the chart.
   */
  const scalperState = $derived.by(() => {
    const s = ind?.setup;
    if (!s) return null;
    for (let i = s.index + 1; i < candles.length; i++) {
      const c = candles[i];
      if (s.side === 'BUY' ? c.low <= s.stopLoss : c.high >= s.stopLoss) return { setup: s, outcome: 'loss' as const, exitIndex: i };
      if (s.side === 'BUY' ? c.high >= s.takeProfit : c.low <= s.takeProfit) return { setup: s, outcome: 'win' as const, exitIndex: i };
    }
    return { setup: s, outcome: 'open' as const, exitIndex: null };
  });
  let indSeries: ISeriesApi<'Line'>[] = [];
  let indLines: IPriceLine[] = [];
  $effect(() => {
    if (!mounted) return;
    const p = palette;
    const r = ind;
    const s = indicators.scalper;
    for (const x of indSeries) chart!.removeSeries(x);
    for (const x of indLines) candleSeries!.removePriceLine(x);
    indSeries = [];
    indLines = [];
    band.set(null);
    if (!r) return;
    const gold = tokenColor('--color-warning');
    const blue = tokenColor('--color-info');
    const line = (values: number[], color: string, width: 1 | 2 | 3, from = 0) => {
      const series = chart!.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      series.setData(values.slice(from).map((v, i) => ({ time: toTime(candles[i + from].time), value: v })));
      indSeries.push(series);
    };
    if (s.showEmas) {
      line(r.emaSlow, blue, 2, Math.min(s.emaSlow, candles.length - 1));
      line(r.emaFast, tokenColor('--color-warning', 0.55), 1, Math.min(s.emaFast, candles.length - 1));
    }
    if (s.showTrail) line(r.trail, gold, 2, 1);
    if (s.showTrendlines) {
      const last = candles.length - 1;
      for (const [t, color] of [[r.resistance, p.down], [r.support, p.up]] as const) {
        if (!t) continue;
        const series = chart!.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        series.setData([
          { time: toTime(candles[t.from].time), value: t.fromPrice },
          { time: toTime(candles[last].time), value: t.fromPrice + t.slope * (last - t.from) },
        ]);
        indSeries.push(series);
      }
    }
    const setup = r.setup;
    if (setup && s.showZone) {
      const color = setup.side === 'BUY' ? p.up : p.down;
      const level = (price: number, c: string, title: string, style: LineStyle) =>
        indLines.push(candleSeries!.createPriceLine({ price, color: c, lineWidth: 2, lineStyle: style, axisLabelVisible: true, title }));
      // An ended setup keeps its zone where it was made, but its levels no longer run across the chart as if live.
      if (scalperState?.outcome === 'open') {
        level(setup.entry, gold, setup.side === 'BUY' ? 'Beli' : 'Jual', LineStyle.Solid);
        level(setup.stopLoss, p.down, 'SL', LineStyle.Dashed);
        level(setup.takeProfit, p.up, 'TP', LineStyle.Dashed);
      }
      const end = Math.min(setup.index + Math.round(s.extendBars), candles.length - 1);
      band.set({
        from: toTime(candles[setup.index].time),
        to: toTime(candles[end].time),
        top: setup.zoneTop,
        bottom: setup.zoneBottom,
        fill: setup.side === 'BUY' ? tokenColor('--color-success', 0.14) : tokenColor('--color-error', 0.14),
        stroke: color,
      });
    }
  });
  // --- PoB BYSTRA (indicators/pob.ts): every signal marked, the latest one's levels and zone drawn.
  const pobTf = $derived(timeframe === '15m' || timeframe === '1h' ? timeframe : null);
  const pobRes = $derived(tools && indicators.showPob && pobTf && candles.length ? pob(candles, pobTf) : null);
  const pobLast = $derived(pobRes?.signals.at(-1) ?? null);
  const pobActive = $derived(pobLast?.outcome === 'open' ? pobLast : null);
  const pobBand = new BandPrimitive();
  let pobLines: IPriceLine[] = [];
  let pobSegments: ISeriesApi<'Line'>[] = [];
  // How many finished signals keep their Entry/SL/TP drawn, as short segments over their life.
  const POB_HISTORY = 5;
  let pobTally = $state(false);
  let pobSkillNote = $state('');
  $effect(() => {
    if (!mounted) return;
    const p = palette;
    const res = pobRes;
    const active = pobActive;
    for (const x of pobLines) candleSeries!.removePriceLine(x);
    for (const x of pobSegments) chart!.removeSeries(x);
    pobLines = [];
    pobSegments = [];
    pobBand.set(null);
    if (!res) return;
    // A finished signal is history: its levels run only from the signal bar to
    // where it ended, so they never pass for live levels at today's price.
    const segment = (from: number, to: number, price: number, color: string, style: LineStyle) => {
      const s = chart!.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData([
        { time: toTime(candles[from].time), value: price },
        { time: toTime(candles[to].time), value: price },
      ]);
      pobSegments.push(s);
    };
    for (const sig of res.signals.filter((x) => x.outcome !== 'open').slice(-POB_HISTORY)) {
      const end = Math.max(sig.index + 1, Math.min(sig.exitIndex ?? sig.index + 1, candles.length - 1));
      segment(sig.index, end, sig.entry, p.accent, LineStyle.Solid);
      segment(sig.index, end, sig.stopLoss, p.down, LineStyle.Dashed);
      segment(sig.index, end, sig.takeProfit, p.up, LineStyle.Dashed);
    }
    // Only a signal still running gets full-width levels with axis labels.
    if (active) {
      const level = (price: number, color: string, title: string, style: LineStyle) =>
        pobLines.push(candleSeries!.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
      level(active.entry, p.accent, `PoB ${active.side}`, LineStyle.Solid);
      level(active.stopLoss, p.down, 'PoB SL', LineStyle.Dashed);
      level(active.takeProfit, p.up, 'PoB TP', LineStyle.Dashed);
      if (active.zoneTop != null && active.zoneBottom != null) {
        pobBand.set({
          from: toTime(candles[active.index].time),
          to: toTime(candles[candles.length - 1].time),
          top: active.zoneTop,
          bottom: active.zoneBottom,
          fill: tokenColor('--color-accent', 0.12),
          stroke: p.accent,
        });
      }
    }
  });
  // --- Fib golden zone (indicators/fib.ts): the leg waiting for its pullback, the running signal, recent ones as segments.
  const fibOk = $derived(timeframe === '15m' || timeframe === '1h' || timeframe === '1d');
  const fibRes = $derived(tools && indicators.showFib && fibOk && candles.length ? fib(candles) : null);
  const fibLast = $derived(fibRes?.signals.at(-1) ?? null);
  const fibOpen = $derived(fibLast?.outcome === 'open' ? fibLast : null);
  const fibBand = new BandPrimitive();
  let fibLines: IPriceLine[] = [];
  let fibSegments: ISeriesApi<'Line'>[] = [];
  let fibTally = $state(false);
  $effect(() => {
    if (!mounted) return;
    const p = palette;
    const res = fibRes;
    const open = fibOpen;
    for (const x of fibLines) candleSeries!.removePriceLine(x);
    for (const x of fibSegments) chart!.removeSeries(x);
    fibLines = [];
    fibSegments = [];
    fibBand.set(null);
    if (!res) return;
    const level = (price: number, color: string, title: string, style: LineStyle) =>
      fibLines.push(candleSeries!.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    const leg = res.active;
    if (leg) {
      const gold = tokenColor('--color-warning');
      level(fibLevel(leg, 0.5), gold, 'Fib 0,5', LineStyle.Dotted);
      level(fibLevel(leg, 0.618), gold, 'Fib 0,618', LineStyle.Dotted);
      level(fibLevel(leg, 0.786), p.neutral, 'Fib 0,786 batal', LineStyle.SparseDotted);
      fibBand.set({
        from: toTime(candles[leg.to].time),
        to: toTime(candles[candles.length - 1].time),
        top: Math.max(fibLevel(leg, 0.5), fibLevel(leg, 0.618)),
        bottom: Math.min(fibLevel(leg, 0.5), fibLevel(leg, 0.618)),
        fill: tokenColor('--color-warning', 0.12),
        stroke: gold,
      });
    }
    if (open) {
      level(open.entry, p.accent, `Fib ${open.side}`, LineStyle.Solid);
      level(open.stopLoss, p.down, 'Fib SL', LineStyle.Dashed);
      level(open.takeProfit, p.up, 'Fib TP', LineStyle.Dashed);
    }
    for (const sig of res.signals.filter((x) => x.outcome !== 'open').slice(-POB_HISTORY)) {
      const end = Math.max(sig.index + 1, Math.min(sig.exitIndex ?? sig.index + 1, candles.length - 1));
      for (const [price, color, style] of [
        [sig.entry, p.accent, LineStyle.Solid],
        [sig.stopLoss, p.down, LineStyle.Dashed],
        [sig.takeProfit, p.up, LineStyle.Dashed],
      ] as const) {
        const s = chart!.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData([
          { time: toTime(candles[sig.index].time), value: price },
          { time: toTime(candles[end].time), value: price },
        ]);
        fibSegments.push(s);
      }
    }
  });

  // --- The user's own scripts (shared/script.ts), run in the sandbox worker. They always read
  // the window the server's alerts and the agent read (a year of bars; 15m: a month), whatever
  // range the chart shows, so a script gives the same signals on the chart as in Telegram.
  let scriptCandles = $state<Candle[]>([]);
  $effect(() => {
    if (!tools) return;
    const s = symbol;
    const tf = timeframe;
    const v = venue;
    let stale = false;
    api
      .candles(s, '1y', tf, v)
      .then((series) => {
        if (!stale) scriptCandles = series.candles;
      })
      .catch(() => {
        if (!stale) scriptCandles = [];
      });
    return () => {
      stale = true;
    };
  });
  $effect(() => {
    if (tools) scripts.bars = toScriptBars(scriptCandles);
  });
  /** Bars the chart shows, so script marks land only where a candle is drawn. */
  const shownTimes = $derived(new Set(candles.map((c) => c.time)));
  /** The user's own scripts and the published ones it turned on (no editor for those: the admin keeps their code). */
  const enabledScripts = $derived<{ id: string; name: string; code: string; published: boolean }[]>(
    tools
      ? [
          ...scripts.items.filter((s) => indicators.scriptIds.includes(s.id)).map((s) => ({ id: s.id, name: s.name, code: s.code, published: false })),
          ...indicators.published.map((c) => ({ id: c.key, name: c.name, code: c.code ?? '', published: true })),
        ]
      : [],
  );
  let scriptRuns = $state<Record<string, ScriptRun>>({});
  $effect(() => {
    const list = enabledScripts.map((s) => ({ id: s.id, code: s.code }));
    const bars = toScriptBars(scriptCandles);
    if (!list.length || !bars.length) {
      scriptRuns = {};
      return;
    }
    let stale = false;
    Promise.all(list.map((s) => runInSandbox(s.code, bars).then((run) => [s.id, run] as const))).then((entries) => {
      if (!stale) scriptRuns = Object.fromEntries(entries);
    });
    return () => {
      stale = true;
    };
  });
  let scriptLines: IPriceLine[] = [];
  let scriptSeries: ISeriesApi<'Line'>[] = [];
  const PLOT_TOKENS = ['--color-warning', '--color-info', '--color-accent', '--color-success', '--color-error', '--color-secondary'];
  $effect(() => {
    if (!mounted) return;
    const p = palette;
    const runs = scriptRuns;
    for (const x of scriptLines) candleSeries!.removePriceLine(x);
    for (const x of scriptSeries) chart!.removeSeries(x);
    scriptLines = [];
    scriptSeries = [];
    let colorAt = 0;
    for (const s of enabledScripts) {
      const run = runs[s.id];
      if (!run?.ok || run.result.plots.length === 0 && run.result.hlines.length === 0 && run.result.signals.length === 0) continue;
      const r = run.result;
      for (const plot of r.plots) {
        const series = chart!.addSeries(LineSeries, {
          color: plot.color ?? tokenColor(PLOT_TOKENS[colorAt++ % PLOT_TOKENS.length]),
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: plot.title,
        });
        series.setData(
          scriptCandles
            .map((c, i) => ({ c, v: plot.values[i] }))
            .filter(({ c }) => shownTimes.has(c.time))
            .map(({ c, v }) => (v == null ? { time: toTime(c.time) } : { time: toTime(c.time), value: v })),
        );
        scriptSeries.push(series);
      }
      for (const h of r.hlines) {
        scriptLines.push(candleSeries!.createPriceLine({ price: h.price, color: h.color ?? p.neutral, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: h.title }));
      }
      const open = r.signals.findLast((x) => x.outcome === 'open');
      if (open) {
        scriptLines.push(candleSeries!.createPriceLine({ price: open.entry, color: p.accent, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${s.name} ${open.side}` }));
        scriptLines.push(candleSeries!.createPriceLine({ price: open.stopLoss, color: p.down, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'SL' }));
        scriptLines.push(candleSeries!.createPriceLine({ price: open.takeProfit, color: p.up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'TP' }));
      }
    }
  });
  const scriptCards = $derived(
    enabledScripts.map((s) => {
      const run = scriptRuns[s.id];
      const card = { id: s.id, name: s.name, published: s.published };
      if (!run) return { ...card, loading: true as const };
      if (!run.ok) return { ...card, error: run.error };
      const signals = run.result.signals;
      return { ...card, open: signals.findLast((x) => x.outcome === 'open') ?? null, last: signals.at(-1) ?? null, stats: run.result.stats };
    }),
  );

  /** Open setups from the indicators on the chart, newest first: what the trading plan card offers. */
  const plans = $derived.by((): Plan[] => {
    const at = (index: number) => candles[index]?.time ?? '';
    const out: Plan[] = [];
    if (scalperState?.outcome === 'open') {
      const s = scalperState.setup;
      out.push({ key: 'scalper', source: 'Scalper Pro+', side: s.side, entry: s.entry, stopLoss: s.stopLoss, takeProfit: s.takeProfit, time: at(s.index) });
    }
    const pobOpen = pobRes?.signals.findLast((s) => s.outcome === 'open');
    if (pobOpen) out.push({ key: 'pob', source: `PoB BYSTRA · ${pobOpen.label}`, side: pobOpen.side, entry: pobOpen.entry, stopLoss: pobOpen.stopLoss, takeProfit: pobOpen.takeProfit, time: at(pobOpen.index) });
    const fibOpen = fibRes?.signals.findLast((s) => s.outcome === 'open');
    if (fibOpen) out.push({ key: 'fib', source: 'Fib Golden Zone', side: fibOpen.side, entry: fibOpen.entry, stopLoss: fibOpen.stopLoss, takeProfit: fibOpen.takeProfit, time: at(fibOpen.index) });
    for (const card of scriptCards) {
      if ('open' in card && card.open) {
        const o = card.open;
        out.push({ key: card.id, source: card.name, side: o.side, entry: o.entry, stopLoss: o.stopLoss, takeProfit: o.takeProfit, time: o.time });
      }
    }
    return out.sort((a, b) => b.time.localeCompare(a.time));
  });
  const latestDecision = $derived([...decisions].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null);
  const anyIndicator = $derived(indicators.showScalper || indicators.showPob || indicators.showFib || enabledScripts.length > 0);

  const OUTCOME: Record<string, string> = { win: 'TP kena', loss: 'SL kena', exit: 'keluar oleh kondisi skrip', expired: 'kedaluwarsa', open: 'masih berjalan' };
  /** "28 Okt 21:45" for intraday bars, the date for daily ones. */
  const stamp = (t: string) => {
    const d = new Date(`${day(t)}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return t.length > 10 ? `${d} ${t.slice(11, 16)}` : d;
  };
  // --- The readouts over the chart: one short label per indicator saying what it is doing now, in words.
  const SIDE = { BUY: 'Beli', SELL: 'Jual' } as const;
  const TREND = { BULLISH: 'naik', BEARISH: 'turun', SIDEWAYS: 'mendatar' } as const;
  const SWEEP = { 'LOW SWEPT': 'low tersapu', 'HIGH SWEPT': 'high tersapu', NONE: 'tidak ada' } as const;
  const TONE = { up: 'text-success', down: 'text-error', muted: 'text-base-content/70' } as const;
  type Label = { text: string; tone: keyof typeof TONE };
  const live = (side: 'BUY' | 'SELL'): Label => ({ text: `${SIDE[side]} aktif`, tone: side === 'BUY' ? 'up' : 'down' });
  const timeframeLabel = $derived(TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? timeframe);
  /** Which indicator's details are open under the labels: one at a time, none at first. */
  let readout = $state<string | null>(null);
  /** Scalper: its trend, then its latest setup and whether that still runs or already hit TP or SL. */
  const scalperLabel = $derived.by((): Label | null => {
    if (!ind || !indicators.scalper.showDashboard) return null;
    const st = scalperState;
    const trend = `tren ${TREND[ind.trend]}`;
    if (!st) return { text: `${trend} · belum ada sinyal`, tone: 'muted' };
    const what = `${SIDE[st.setup.side]} ${stamp(candles[st.setup.index].time)}`;
    if (st.outcome === 'open') return { text: `${trend} · ${what} aktif`, tone: st.setup.side === 'BUY' ? 'up' : 'down' };
    return { text: `${trend} · ${what} kena ${st.outcome === 'win' ? 'TP' : 'SL'}`, tone: 'muted' };
  });
  const pobLabel = $derived<Label>(pobActive ? live(pobActive.side) : { text: 'menunggu retest zona', tone: 'muted' });
  const fibLabel = $derived<Label>(
    fibOpen ? live(fibOpen.side) : fibRes?.active ? { text: `menunggu pullback ${fibRes.active.dir === 1 ? 'Beli' : 'Jual'}`, tone: 'muted' } : { text: 'menunggu kaki baru', tone: 'muted' },
  );
  const scriptLabel = (card: (typeof scriptCards)[number]): Label =>
    'loading' in card ? { text: 'menjalankan…', tone: 'muted' } : 'error' in card ? { text: 'skrip error', tone: 'down' } : card.open ? live(card.open.side) : { text: 'tidak ada sinyal aktif', tone: 'muted' };
  /** Under the toolbar when indicators are on but none has an open setup: why the plan card is missing. */
  const noPlan = $derived.by(() => {
    const st = scalperState;
    if (st && st.outcome !== 'open') {
      return `Belum ada setup terbuka. Setup Scalper terakhir (${SIDE[st.setup.side]} ${stamp(candles[st.setup.index].time)}) sudah kena ${st.outcome === 'win' ? 'TP' : 'SL'}; rencana baru muncul di sini saat indikator memberi setup berikutnya.`;
    }
    return 'Belum ada setup terbuka dari indikator yang menyala. Rencana (entry, SL, TP, dan ukuran posisi) muncul di sini saat ada setup baru.';
  });

  async function pobSkill() {
    try {
      const { version } = await api.installSkill('pob-bystra');
      pobSkillNote = `Draf skill pob-bystra v${version} dibuat; setujui di panel Skill.`;
    } catch (e) {
      pobSkillNote = (e as Error).message;
    }
  }

  const priceText = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : 5 });
  /** The last price and its change since the previous day's close; weekly and monthly bars compare with the bar before. */
  const quote = $derived.by(() => {
    const last = candles.at(-1);
    if (!last) return null;
    const longBars = timeframe === '1wk' || timeframe === '1mo';
    const prev = timeframe === '1d' || longBars ? candles.at(-2) : candles.findLast((c) => day(c.time) < day(last.time));
    return {
      price: last.close,
      change: prev && prev.close ? (last.close - prev.close) / prev.close : null,
      since: timeframe === '1wk' ? 'minggu ini' : timeframe === '1mo' ? 'bulan ini' : 'hari ini',
    };
  });
  /** The secondary tools fold behind "Lainnya", so the toolbar keeps to one row and the candles get the height. */
  let moreTools = $state(false);

  // --- Navigation: zoom, jump to a date, the navigator strip.
  let visible = $state({ from: 0, to: 0 });
  function zoom(factor: number) {
    const ts = chart?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2;
    const half = Math.max(5, ((r.to - r.from) / 2) * factor);
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  }
  const reset = () => chart?.timeScale().fitContent();
  const showRange = (from: number, to: number) => chart?.timeScale().setVisibleLogicalRange({ from, to });

  const WINDOWS = [
    { days: 7, label: '±1 mg' },
    { days: 30, label: '±1 bln' },
    { days: 91, label: '±3 bln' },
  ];
  let jumpOpen = $state(false);
  let jumpDate = $state('');
  let jumpDays = $state(30);
  let jumpMark = $state<string | null>(null);
  let jumpError = $state('');
  $effect(() => {
    if (jumpRequest) jumpOpen = true;
  });
  const shift = (d: string, days: number) => new Date(Date.parse(d) + days * 86_400_000).toISOString().slice(0, 10);
  function jumpTo(date: string) {
    jumpError = '';
    if (!date || !candles.length) return;
    const at = candles.findIndex((c) => day(c.time) >= date);
    if (at < 0 || day(candles[0].time) > date) {
      jumpError = `Data yang dimuat mulai ${day(candles[0].time)} sampai ${day(candles.at(-1)!.time)}. Pilih rentang yang lebih panjang (5T) atau tanggal lain.`;
      return;
    }
    const lo = candles.findIndex((c) => day(c.time) >= shift(date, -jumpDays));
    const hiFound = candles.findIndex((c) => day(c.time) > shift(date, jumpDays));
    const hi = hiFound < 0 ? candles.length - 1 : hiFound;
    showRange(Math.max(0, lo) - 0.5, hi + 0.5);
    jumpMark = candles[at].time;
    jumpOpen = false;
  }
  const lastDecision = $derived(decisions.reduce<string | null>((max, d) => (!max || d.date > max ? d.date : max), null));

  // A cached range switch answers in milliseconds; only a slow one earns a spinner.
  let showSpinner = $state(false);
  $effect(() => {
    if (!loading) {
      showSpinner = false;
      return;
    }
    const timer = setTimeout(() => (showSpinner = true), 200);
    return () => clearTimeout(timer);
  });

  // Decisions for the symbol, unless the caller passed them or the screen is not about research.
  $effect(() => {
    if (given || !research) return;
    const s = symbol;
    void refresh;
    api
      .decisions(s)
      .then((d) => {
        fetched = d;
      })
      .catch(() => {
        fetched = [];
      });
  });

  // Widen the default range so the oldest decision is on the chart.
  let rangeChosen = false;
  $effect(() => {
    if (rangeChosen || decisions.length === 0) return;
    const oldest = decisions.reduce((min, d) => (d.date < min ? d.date : min), decisions[0].date);
    const ageDays = (Date.now() - new Date(oldest).getTime()) / 86_400_000;
    const fit = (RANGES.find((r) => r.days > ageDays + 30) ?? RANGES[RANGES.length - 1]).value;
    range = intraday && !INTRADAY_RANGES.includes(fit) ? '1y' : fit;
    rangeChosen = true;
  });

  $effect(() => {
    const s = symbol;
    const r = range;
    const tf = timeframe;
    const v = venue;
    loading = true;
    loadError = '';
    api
      .candles(s, r, tf, v)
      .then((series) => {
        candles = series.candles;
        currency = series.currency;
        source = series.source;
      })
      .catch((e) => {
        candles = [];
        loadError = (e as Error).message;
      })
      .finally(() => (loading = false));
  });

  $effect(() => {
    if (!mounted) return;
    candleSeries!.setData(candles.map((c) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    volumeSeries!.setData(
      candles.map((c) => ({
        time: toTime(c.time),
        value: c.volume,
        color: c.close >= c.open ? palette.upVolume : palette.downVolume,
      })),
    );
    chart!.timeScale().fitContent();
  });

  $effect(() => {
    if (!mounted) return;
    const list: (SeriesMarker<Time> & { at: string })[] = rows
      .filter((r) => r.markedAt)
      .map((r) => {
        const direction = RATING_DIRECTION[r.rating] ?? 0;
        return {
          at: r.markedAt!,
          time: toTime(r.markedAt!),
          position: direction > 0 ? 'belowBar' : 'aboveBar',
          shape: direction > 0 ? 'arrowUp' : direction < 0 ? 'arrowDown' : 'circle',
          color: direction > 0 ? palette.up : direction < 0 ? palette.down : palette.neutral,
          text: r.date === highlightDate ? `▶ ${r.rating}` : r.rating,
          size: r.date === highlightDate ? 2 : 1,
        };
      });
    // The agent's notes ride on the same marker layer, on the first bar at or after their date.
    for (const d of drawings) {
      if (d.kind !== 'note') continue;
      const at = atDay(d.data.time);
      if (at) list.push({ at, time: toTime(at), position: 'aboveBar', shape: 'square', color: palette.accent, text: d.label });
    }
    // Scalper Pro+ marks only its newest signal, as the script does.
    const setup = ind?.setup;
    if (setup && indicators.scalper.showZone) {
      const at = candles[setup.index].time;
      const buy = setup.side === 'BUY';
      list.push({ at, time: toTime(at), position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? palette.up : palette.down, text: buy ? 'Beli' : 'Jual' });
    }
    for (const sig of pobRes?.signals ?? []) {
      const at = candles[sig.index].time;
      const buy = sig.side === 'BUY';
      const text = `${sig.setup}${sig.plus ? '+' : ''}${sig.ck3 ? ' CK3' : sig.ck2 ? ' CK2' : ''}`;
      list.push({ at, time: toTime(at), position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? palette.up : palette.down, text });
    }
    for (const sig of fibRes?.signals ?? []) {
      const at = candles[sig.index].time;
      const buy = sig.side === 'BUY';
      list.push({ at, time: toTime(at), position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? palette.up : palette.down, text: 'FIB' });
    }
    for (const s of enabledScripts) {
      const run = scriptRuns[s.id];
      if (!run?.ok) continue;
      for (const sig of run.result.signals) {
        const at = scriptCandles[sig.index]?.time;
        if (!at || !shownTimes.has(at)) continue;
        const buy = sig.side === 'BUY';
        list.push({ at, time: toTime(at), position: buy ? 'belowBar' : 'aboveBar', shape: buy ? 'arrowUp' : 'arrowDown', color: buy ? palette.up : palette.down, text: s.name.slice(0, 12) });
      }
    }
    if (jumpMark && candles.some((c) => c.time === jumpMark)) {
      list.push({ at: jumpMark, time: toTime(jumpMark), position: 'aboveBar', shape: 'arrowDown', color: palette.accent, text: 'Tanggal' });
    }
    list.sort((a, b) => a.at.localeCompare(b.at));
    markers!.setMarkers(list.map(({ at: _, ...m }) => m));
  });
</script>

<div class="@container flex flex-col gap-3" class:h-full={tools && fill}>
  {#snippet planCard()}
    {#if tools && plans.length}
      <TradePlan {plans} {symbol} {timeframe} {currency} last={candles.at(-1)?.close ?? null} decision={latestDecision} />
    {:else if tools && !anyIndicator && candles.length}
      <p class="text-xs text-base-content/70">Rencana trading (entry, SL, TP, dan ukuran posisi) muncul di sini saat indikator memberi setup. Nyalakan dari menu Indikator.</p>
    {:else if tools && candles.length}
      <p class="text-xs text-base-content/70">{noPlan}</p>
    {/if}
  {/snippet}
  {#snippet readoutChip(key: string, name: string, label: Label)}
    <button
      class="btn btn-xs h-auto min-h-6 max-w-full gap-1.5 border-base-300 bg-base-100/90 py-0.5 font-normal shadow-sm"
      class:btn-active={readout === key}
      aria-expanded={readout === key}
      title="Rincian {name}"
      onclick={() => (readout = readout === key ? null : key)}
    >
      <span class="shrink-0 font-semibold">{name}</span>
      <span class="truncate {TONE[label.tone]}">{label.text}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 transition-transform" class:rotate-180={readout === key} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
  {/snippet}
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-2 text-sm text-base-content/70">
      {#if quote}
        <span class="text-lg font-semibold tabular-nums text-base-content">{priceText(quote.price)}</span>
        {#if quote.change != null}
          <span class="tabular-nums" class:text-success={quote.change > 0} class:text-error={quote.change < 0}>
            {quote.change > 0 ? '+' : quote.change < 0 ? '−' : ''}{(Math.abs(quote.change) * 100).toFixed(2).replace('.', ',')}% {quote.since}
          </span>
        {/if}
      {/if}
      <!-- The workspace's chart head already names the asset; elsewhere the code says which chart this is. -->
      {#if !tools}<span class="font-semibold text-base-content">{assetCode(symbol)}</span>{/if}
      {#if currency}<span>· {currency}</span>{/if}
      {#if source && source !== 'yahoo'}
        <span class="badge badge-xs badge-success badge-soft" title="Harga real-time dari {sourceLabel}">{sourceLabel} · real-time</span>
      {/if}
      {#if research}<span class="badge badge-sm badge-info badge-soft">{decisions.length} keputusan AI</span>{/if}
      {#if hitRate != null}
        <span class="badge badge-sm {hitRate >= 0.5 ? 'badge-success' : 'badge-warning'} badge-soft">
          arah benar {Math.round(hitRate * 100)}% ({scored.length})
        </span>
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <!-- Narrow: the timeframe as one compact picker, so the toolbar keeps to one row on a phone. -->
      <select
        class="select select-xs w-auto @2xl:hidden"
        aria-label="Timeframe candle"
        value={timeframe}
        onchange={(e) => pickTimeframe(e.currentTarget.value as Interval)}
      >
        {#each TIMEFRAMES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
      </select>
      <div class="join hidden @2xl:inline-flex" role="group" aria-label="Timeframe candle">
        {#each TIMEFRAMES as t (t.value)}
          <button class="btn btn-xs join-item" class:btn-active={timeframe === t.value} aria-pressed={timeframe === t.value} title={t.title} onclick={() => pickTimeframe(t.value)}>
            {t.label}
          </button>
        {/each}
      </div>
      {#if tools}
        <IndicatorsMenu pobOk={!!pobTf} {fibOk} {timeframe} {symbol} />
        <AlertsMenu {symbol} {venue} last={candles.at(-1)?.close ?? null} />
        <button class="btn btn-xs" class:btn-active={moreTools} aria-expanded={moreTools} onclick={() => (moreTools = !moreTools)}>Lainnya</button>
      {/if}
      <div class="{moreTools || !tools ? 'flex' : 'hidden'} flex-wrap items-center gap-2">
      <div class="join" role="group" aria-label="Rentang waktu">
        {#each RANGES as r (r.value)}
          <button
            class="btn btn-xs join-item"
            class:btn-active={range === r.value && timeframe !== '15m'}
            aria-pressed={range === r.value}
            disabled={timeframe === '15m' || (intraday && !INTRADAY_RANGES.includes(r.value))}
            title={timeframe === '15m'
              ? 'Candle 15 menit: 1 bulan terakhir'
              : intraday && !INTRADAY_RANGES.includes(r.value)
                ? 'Candle per jam tersedia maksimal 1 tahun'
                : undefined}
            onclick={() => {
              range = r.value;
              rangeChosen = true;
            }}>{r.label}</button
          >
        {/each}
      </div>
      {#if tools}
        <div class="join" role="group" aria-label="Zoom">
          <button class="btn btn-xs join-item" aria-label="Perkecil" onclick={() => zoom(1.5)}>−</button>
          <button class="btn btn-xs join-item" aria-label="Perbesar" onclick={() => zoom(0.66)}>+</button>
          <button class="btn btn-xs join-item" onclick={reset}>Reset</button>
        </div>
        <!-- Jumping to a date lives in the chart head's "⋯" menu, which also works over TradingView's chart. -->
        <button
          class="btn btn-xs"
          class:btn-active={chartPrefs.navigator}
          aria-pressed={chartPrefs.navigator}
          title="Garis kecil seluruh data di bawah chart; geser kotaknya untuk pindah waktu"
          onclick={() => chartPrefs.toggleNavigator()}>Navigasi waktu</button
        >
        <ScriptsMenu />
        {#if cryptoBase(symbol)}<VenuePanel base={cryptoBase(symbol)!} venue={venue ?? 'binance'} />{/if}
      {/if}
      </div>
    </div>
  </div>

  {#if fill}{@render planCard()}{/if}

  <!-- The workspace chart fills its desktop panel; on a phone and elsewhere it has a fixed height. -->
  <div class="relative w-full" class:min-h-48={tools && fill} class:flex-1={tools && fill} style={tools && fill ? '' : `height: ${height}px`}>
    <div bind:this={container} class="h-full w-full"></div>
    {#if tools && (scalperLabel || pobRes || fibRes || scriptCards.length)}
    <!-- The readouts as one row of short labels at the top left, clear of the newest candles and the price
         scale: each says what its indicator is doing now. A label opens its details under the row, one at a
         time, and a second click closes them, so nothing covers the candles unless asked for. -->
    <div class="pointer-events-none absolute top-2 right-16 bottom-8 left-2 z-10 flex flex-col items-start gap-2">
      <div class="pointer-events-auto flex max-w-full flex-wrap gap-1.5" role="group" aria-label="Status indikator">
        {#if scalperLabel}{@render readoutChip('scalper', 'Scalper', scalperLabel)}{/if}
        {#each scriptCards as card (card.id)}{@render readoutChip(card.id, card.name, scriptLabel(card))}{/each}
        {#if pobRes}{@render readoutChip('pob', 'PoB', pobLabel)}{/if}
        {#if fibRes}{@render readoutChip('fib', 'Fib', fibLabel)}{/if}
      </div>
      {#if readout}
      <div class="pointer-events-auto flex max-h-full w-72 max-w-full flex-col overflow-x-hidden overflow-y-auto">
      {#if readout === 'scalper' && ind && scalperLabel}
        <section class="flex w-full shrink-0 flex-col gap-1.5 rounded-box border border-base-300 bg-base-100/95 p-2.5 text-xs shadow-sm" aria-label="Scalper Pro+">
          <span class="font-semibold">Scalper Pro+ · {timeframeLabel}</span>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            <dt class="text-base-content/70">Tren</dt>
            <dd class="text-right" class:text-success={ind.trend === 'BULLISH'} class:text-error={ind.trend === 'BEARISH'}>{TREND[ind.trend]}</dd>
            <dt class="text-base-content/70">RSI</dt>
            <dd class="text-right tabular-nums">{ind.rsi.toFixed(1).replace('.', ',')}</dd>
            <dt class="text-base-content/70">Sapuan likuiditas</dt>
            <dd class="text-right">{SWEEP[ind.sweep]}</dd>
          </dl>
          {#if scalperState}
            {@const st = scalperState}
            <p class="font-medium {TONE[scalperLabel.tone]}">
              {SIDE[st.setup.side]} {stamp(candles[st.setup.index].time)}:
              {st.exitIndex == null ? 'masih berjalan' : `kena ${st.outcome === 'win' ? 'TP' : 'SL'} ${stamp(candles[st.exitIndex].time)}`}
            </p>
            <p class="font-mono tabular-nums text-base-content/80">E {priceText(st.setup.entry)} · SL {priceText(st.setup.stopLoss)} · TP {priceText(st.setup.takeProfit)}</p>
            {#if st.exitIndex != null}
              <p class="text-base-content/70">Setup ini sudah selesai dan levelnya tidak berlaku lagi. Tunggu sinyal berikutnya.</p>
            {/if}
          {:else}
            <p class="text-base-content/70">Belum ada sinyal di candle yang dimuat.</p>
          {/if}
        </section>
      {/if}
      {#each scriptCards as card (card.id)}
        {#if readout === card.id}
        <section
          class="flex w-full shrink-0 flex-col gap-1 rounded-box border border-base-300 bg-base-100/95 p-2.5 text-xs shadow-sm"
          aria-label={card.published ? card.name : `Skrip ${card.name}`}
        >
          <div class="flex items-center gap-2">
            {#if card.published}
              <span class="truncate font-semibold">{card.name}</span>
            {:else}
              <span class="truncate font-semibold">Skrip · {card.name}</span>
              <button class="btn btn-ghost btn-xs ml-auto" onclick={() => scripts.open(card.id)}>Edit</button>
            {/if}
          </div>
          {#if 'loading' in card}
            <p class="text-base-content/70">Menjalankan…</p>
          {:else if 'error' in card}
            <p class="font-mono text-error">{card.error}</p>
          {:else}
            {#if card.open}
              <p class="font-medium" class:text-success={card.open.side === 'BUY'} class:text-error={card.open.side === 'SELL'}>Aktif: {card.open.label}</p>
              <p class="font-mono tabular-nums text-base-content/80">E {priceText(card.open.entry)} · SL {priceText(card.open.stopLoss)} · TP {priceText(card.open.takeProfit)}</p>
            {:else if card.last}
              <p class="text-base-content/70">Tidak ada sinyal aktif. Terakhir: {card.last.label}, {card.last.time}, {OUTCOME[card.last.outcome]}.</p>
            {:else}
              <p class="text-base-content/70">Belum ada sinyal di candle yang dimuat.</p>
            {/if}
            <p class="font-mono tabular-nums text-base-content/70">
              {card.stats.count} sinyal · {card.stats.tp} TP · {card.stats.sl} SL{card.stats.exits ? ` · ${card.stats.exits} keluar` : ''}{card.stats.avgR == null ? '' : ` · ${card.stats.avgR.toFixed(2).replace('.', ',')}R`}
            </p>
          {/if}
        </section>
        {/if}
      {/each}
      {#if readout === 'pob' && pobRes}
      <section class="flex w-full shrink-0 flex-col gap-1.5 rounded-box border border-base-300 bg-base-100/95 p-2.5 text-xs shadow-sm" aria-label="PoB BYSTRA">
        <div class="flex items-center gap-2">
          <span class="font-semibold">PoB BYSTRA · HTF {pobRes.htf}</span>
          <button class="btn btn-ghost btn-xs ml-auto" aria-expanded={pobTally} onclick={() => (pobTally = !pobTally)}>{pobTally ? 'Tutup' : 'Tally'}</button>
        </div>
        {#if pobActive}
          <p class="font-medium" class:text-success={pobActive.side === 'BUY'} class:text-error={pobActive.side === 'SELL'}>Aktif: {pobActive.label}</p>
          <p class="font-mono tabular-nums text-base-content/80">
            {stamp(candles[pobActive.index].time)} · E {priceText(pobActive.entry)} · SL {priceText(pobActive.stopLoss)} · TP {priceText(pobActive.takeProfit)}
          </p>
        {:else}
          <p class="font-medium">Tidak ada sinyal aktif</p>
          <p class="text-base-content/70">
            {#if pobLast}
              Terakhir: {pobLast.label}, {stamp(candles[pobLast.index].time)}, {OUTCOME[pobLast.outcome]}{pobLast.exitIndex != null ? ` ${stamp(candles[pobLast.exitIndex].time)}` : ''}.
            {:else}
              Belum ada sinyal di candle yang dimuat.
            {/if}
            Setup baru muncul saat harga kembali menguji zona; di gerak lurus tanpa retest, PoB memang menunggu.
          </p>
        {/if}
        {#if pobTally}
          <table class="table-xs table">
            <thead><tr><th>Setup</th><th class="text-right">Sinyal</th><th class="text-right">TP</th><th class="text-right">SL</th><th class="text-right">Rata R</th></tr></thead>
            <tbody class="font-mono tabular-nums">
              {#each pobRes.stats as st (st.setup)}
                <tr title={SETUPS.find((x) => x.id === st.setup)?.name}>
                  <td class="font-sans">{st.setup}</td>
                  <td class="text-right">{st.count}</td>
                  <td class="text-right">{st.wins}</td>
                  <td class="text-right">{st.losses}</td>
                  <td class="text-right">{st.avgR == null ? '—' : st.avgR.toFixed(2).replace('.', ',')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="text-base-content/70">Uji asap pada {candles.length} candle yang dimuat, tanpa biaya. Bukan backtest.</p>
          <button class="btn btn-xs" onclick={pobSkill}>Jadikan skill AI</button>
          {#if pobSkillNote}<p class="text-base-content/80" role="status">{pobSkillNote}</p>{/if}
        {/if}
      </section>
      {/if}
      {#if readout === 'fib' && fibRes}
        <section class="flex w-full shrink-0 flex-col gap-1.5 rounded-box border border-base-300 bg-base-100/95 p-2.5 text-xs shadow-sm" aria-label="Fib Golden Zone">
          <div class="flex items-center gap-2">
            <span class="font-semibold">Fib Golden Zone · {timeframeLabel}</span>
            <button class="btn btn-ghost btn-xs ml-auto" aria-expanded={fibTally} onclick={() => (fibTally = !fibTally)}>{fibTally ? 'Tutup' : 'Tally'}</button>
          </div>
          {#if fibOpen}
            <p class="font-medium" class:text-success={fibOpen.side === 'BUY'} class:text-error={fibOpen.side === 'SELL'}>Aktif: {fibOpen.label}</p>
            <p class="font-mono tabular-nums text-base-content/80">
              {stamp(candles[fibOpen.index].time)} · E {priceText(fibOpen.entry)} · SL {priceText(fibOpen.stopLoss)} · TP {priceText(fibOpen.takeProfit)}
            </p>
          {:else if fibRes.active}
            {@const leg = fibRes.active}
            <p class="font-medium">Menunggu pullback {leg.dir === 1 ? 'Beli' : 'Jual'}</p>
            <p class="text-base-content/80">
              Kaki {priceText(leg.fromPrice)} → {priceText(leg.toPrice)}. Zona
              <span class="font-mono">{priceText(fibLevel(leg, 0.5))}–{priceText(fibLevel(leg, 0.618))}</span>, batal bila tutup melewati
              <span class="font-mono">{priceText(fibLevel(leg, 0.786))}</span>.
            </p>
          {:else}
            <p class="font-medium">Tidak ada sinyal aktif</p>
            <p class="text-base-content/70">
              {#if fibLast}Terakhir: {fibLast.label}, {stamp(candles[fibLast.index].time)}, {OUTCOME[fibLast.outcome]}.{:else}Belum ada sinyal di candle yang dimuat.{/if}
              Menunggu kaki impuls baru (≥ 3 ATR, searah trend).
            </p>
          {/if}
          {#if fibTally}
            <p class="font-mono tabular-nums">
              {fibRes.stats.count} sinyal · {fibRes.stats.wins} TP · {fibRes.stats.losses} SL · rata-rata
              {fibRes.stats.avgR == null ? '—' : `${fibRes.stats.avgR.toFixed(2).replace('.', ',')}R`}
            </p>
            <p class="text-base-content/70">Uji asap pada {candles.length} candle yang dimuat, tanpa biaya. Bukan backtest.</p>
          {/if}
        </section>
      {/if}
      </div>
      {/if}
    </div>
    {/if}
    {#if tools && indicators.showScalper && indicators.settingsOpen}
      <div class="absolute top-2 left-2 z-20"><IndicatorPanel onclose={() => (indicators.settingsOpen = false)} /></div>
    {/if}
    {#if tools && jumpOpen}
      <form
        class="ta-pop absolute top-2 right-16 z-30 flex w-72 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl"
        aria-label="Lompat ke tanggal"
        onsubmit={(e) => {
          e.preventDefault();
          jumpTo(jumpDate);
        }}
      >
        <label class="flex flex-col gap-1 text-xs text-base-content/80">Tanggal
          <input class="input input-sm font-mono" type="date" bind:value={jumpDate} required />
        </label>
        <div class="join w-full" role="group" aria-label="Lebar jendela">
          {#each WINDOWS as w (w.days)}
            <button type="button" class="btn btn-xs join-item flex-1" class:btn-active={jumpDays === w.days} aria-pressed={jumpDays === w.days} onclick={() => (jumpDays = w.days)}>{w.label}</button>
          {/each}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#if lastDecision}
            <button type="button" class="btn btn-xs" onclick={() => ((jumpDate = lastDecision!), jumpTo(lastDecision!))}>Keputusan AI terakhir</button>
          {/if}
          {#if ind?.setup}
            <button type="button" class="btn btn-xs" onclick={() => ((jumpDate = day(candles[ind!.setup!.index].time)), jumpTo(jumpDate))}>Sinyal Scalper</button>
          {/if}
          <button type="button" class="btn btn-xs" onclick={() => ((jumpDate = new Date().toLocaleDateString('en-CA')), jumpTo(jumpDate))}>Hari ini</button>
        </div>
        {#if jumpError}<p class="text-xs text-error" role="alert">{jumpError}</p>{/if}
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (jumpOpen = false)}>Batal</button>
          <button class="btn btn-primary btn-sm flex-1">Lompat</button>
        </div>
      </form>
    {/if}
    {#if loading}
      {#if showSpinner}
        <div class="absolute inset-0 grid place-items-center"><span class="loading loading-spinner"></span></div>
      {/if}
    {:else if loadError}
      <div class="absolute inset-0 grid place-items-center p-6 text-center text-sm text-error">{loadError}</div>
    {/if}
  </div>

  {#if tools && chartPrefs.navigator && candles.length > 1}
    <Navigator closes={candles.map((c) => c.close)} from={visible.from} to={visible.to} onchange={showRange} />
  {/if}

  <!-- A phone shows the candles first; the plan follows a short scroll below. -->
  {#if !fill}{@render planCard()}{/if}

  {#if timeframe !== '1d' && !tools}
    <p class="text-xs text-base-content/70">
      Engine, marker keputusan, dan gambar agent dihitung dari candle harian; di timeframe ini sebuah tanggal ditaruh di candle pertama hari itu.
    </p>
  {/if}

  {#if showTable && rows.length}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Keputusan</th>
            <th>Sumber</th>
            <th class="text-right">Harga {HOLDING_DAYS} hari</th>
            <th class="text-right">Alpha engine</th>
            <th>Hasil</th>
          </tr>
        </thead>
        <tbody>
          {#each [...rows].reverse() as row (row.source + row.id + row.date)}
            <tr class:bg-base-200={row.date === highlightDate}>
              <td class="tabular-nums">{row.date}</td>
              <td><span class="badge badge-sm {ratingBadge(row.rating)}">{row.rating}</span></td>
              <td>
                <a class="link link-hover text-sm" href={row.source === 'backtest' ? `#/backtests/${row.id}` : `#/analyses/${row.id}`}>
                  {row.source === 'backtest' ? 'Backtest' : 'Analisa'}
                </a>
              </td>
              <td class="text-right tabular-nums" class:text-success={(row.priceReturn ?? 0) > 0} class:text-error={(row.priceReturn ?? 0) < 0}>
                {row.priceReturn == null ? 'menunggu' : formatPercent(row.priceReturn)}
              </td>
              <td class="text-right tabular-nums">{formatPercent(row.alpha)}</td>
              <td>
                {#if row.hit === true}<span class="text-success">✓ benar</span>
                {:else if row.hit === false}<span class="text-error">✗ salah</span>
                {:else}<span class="text-base-content/70">–</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="max-w-[75ch] text-xs text-base-content/70">
      “Harga {HOLDING_DAYS} hari” = perubahan harga dari penutupan pertama setelah tanggal keputusan sampai {HOLDING_DAYS} hari
      bursa kemudian. Hasil backtest dinilai dengan alpha engine (return dikurangi benchmark, IHSG untuk saham .JK);
      analisa tunggal dinilai dari arah harga saja. Hold tidak punya arah, jadi tidak dinilai.
    </p>
  {/if}
</div>

