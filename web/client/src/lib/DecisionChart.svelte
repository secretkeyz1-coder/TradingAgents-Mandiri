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
  import { formatPercent, ratingBadge, RATING_DIRECTION } from './format';
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
  } = $props();

  // The engine scores a decision over this many trading days from the first close after its date.
  const HOLDING_DAYS = 5;
  const RANGES = [
    { value: '6mo', label: '6B', days: 182 },
    { value: '1y', label: '1T', days: 365 },
    { value: '2y', label: '2T', days: 730 },
    { value: '5y', label: '5T', days: 1826 },
  ] as const;
  type Range = (typeof RANGES)[number]['value'];
  const TIMEFRAMES: { value: Interval; label: string; title: string }[] = [
    { value: '1h', label: '1j', title: '1 jam' },
    { value: '4h', label: '4j', title: '4 jam' },
    { value: '1d', label: '1H', title: '1 hari' },
    { value: '1wk', label: '1M', title: '1 minggu' },
    { value: '1mo', label: '1B', title: '1 bulan' },
  ];
  // Yahoo keeps hourly bars for two years at most; the server clamps, the buttons say so.
  const INTRADAY_RANGES: Range[] = ['6mo', '1y'];

  let range = $state<Range>('1y');
  let ownTimeframe = $state<Interval>('1d');
  const timeframe = $derived(givenTimeframe ?? ownTimeframe);
  const intraday = $derived(timeframe === '1h' || timeframe === '4h');
  let candles = $state<Candle[]>([]);
  let currency = $state<string | null>(null);
  let loadError = $state('');
  let loading = $state(true);
  let fetched = $state<Decision[]>([]);
  const decisions = $derived(given ?? fetched);

  function pickTimeframe(tf: Interval) {
    if (onTimeframe) onTimeframe(tf);
    else ownTimeframe = tf;
    if ((tf === '1h' || tf === '4h') && !INTRADAY_RANGES.includes(range)) range = '1y';
  }

  // Candle times: a date for daily and up, the exchange's wall-clock time for
  // intraday. The chart wants the latter as UTC seconds, so the wall-clock time
  // is read as if it were UTC and the axis shows exchange time.
  const day = (t: string) => t.slice(0, 10);
  const toTime = (t: string): Time => (t.length > 10 ? (Math.floor(Date.parse(`${t}Z`) / 1000) as UTCTimestamp) : (t as Time));
  /** The first bar on or after a date, where dated things (decisions, notes, trendline ends) go. */
  const atDay = (date: string) => candles.find((c) => day(c.time) >= date)?.time;
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
    const roleColor = (role: string) => (role === 'support' || role === 'demand' ? p.up : role === 'resistance' || role === 'supply' ? p.down : p.accent);
    for (const d of drawings) {
      const x = d.data;
      if (d.kind === 'level') level(x.price, roleColor(x.role), d.label);
      else if (d.kind === 'zone') {
        level(x.top, roleColor(x.role), d.label, LineStyle.Dotted);
        level(x.bottom, roleColor(x.role), '', LineStyle.Dotted);
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
  });

  onMount(() => {
    chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: true },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: 0 },
    });
    candleSeries = chart.addSeries(CandlestickSeries, { borderVisible: false });
    volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    markers = createSeriesMarkers(candleSeries, []);
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

  // Decisions for the symbol, unless the caller passed them.
  $effect(() => {
    if (given) return;
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
    loading = true;
    loadError = '';
    api
      .candles(s, r, tf)
      .then((series) => {
        candles = series.candles;
        currency = series.currency;
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
    list.sort((a, b) => a.at.localeCompare(b.at));
    markers!.setMarkers(list.map(({ at: _, ...m }) => m));
  });
</script>

<div class="flex flex-col gap-3">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap items-center gap-2 text-sm text-base-content/70">
      <span class="font-mono font-semibold text-base-content">{symbol}</span>
      {#if currency}<span>· {currency}</span>{/if}
      <span>· {decisions.length} keputusan AI</span>
      {#if hitRate != null}
        <span class="badge badge-sm {hitRate >= 0.5 ? 'badge-success' : 'badge-warning'} badge-soft">
          arah benar {Math.round(hitRate * 100)}% ({scored.length})
        </span>
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="join" role="group" aria-label="Timeframe candle">
        {#each TIMEFRAMES as t (t.value)}
          <button class="btn btn-xs join-item" class:btn-active={timeframe === t.value} aria-pressed={timeframe === t.value} title={t.title} onclick={() => pickTimeframe(t.value)}>
            {t.label}
          </button>
        {/each}
      </div>
      <div class="join" role="group" aria-label="Rentang waktu">
        {#each RANGES as r (r.value)}
          <button
            class="btn btn-xs join-item"
            class:btn-active={range === r.value}
            aria-pressed={range === r.value}
            disabled={intraday && !INTRADAY_RANGES.includes(r.value)}
            title={intraday && !INTRADAY_RANGES.includes(r.value) ? 'Candle per jam tersedia maksimal 1 tahun' : undefined}
            onclick={() => {
              range = r.value;
              rangeChosen = true;
            }}>{r.label}</button
          >
        {/each}
      </div>
    </div>
  </div>

  <div class="relative w-full" style="height: {height}px">
    <div bind:this={container} class="h-full w-full"></div>
    {#if loading}
      {#if showSpinner}
        <div class="absolute inset-0 grid place-items-center"><span class="loading loading-spinner"></span></div>
      {/if}
    {:else if loadError}
      <div class="absolute inset-0 grid place-items-center p-6 text-center text-sm text-error">{loadError}</div>
    {/if}
  </div>

  {#if timeframe !== '1d'}
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
