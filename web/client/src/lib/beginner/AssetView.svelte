<script lang="ts">
  // The asset in focus, for a beginner: its name, the latest price and today's
  // change, and one area chart over a span people think in (a day, a week … a
  // year). The candles are the Pro chart's own: crypto live from its venue, the
  // rest a few minutes late from Yahoo. Green or red follows the span's change.
  import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
  import { api, type CandleSeries, type Interval } from '../api';
  import { formatPercent, today } from '../format';
  import SessionBadge from '../SessionBadge.svelte';
  import { mode } from '../stores/mode.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { theme, tokenColor } from '../theme.svelte';
  import { venueOf } from '../tv';
  import { latest } from './latest.svelte';
  import { friendlyName, priceText, toneOf } from './plain';

  type Span = { key: string; short: string; label: string; range: string; interval: Interval; days: 'session' | number | null };
  const SPANS: Span[] = [
    { key: '1d', short: '1hr', label: '1 Hari', range: '6mo', interval: '15m', days: 'session' },
    { key: '1w', short: '1mg', label: '1 Minggu', range: '6mo', interval: '1h', days: 7 },
    { key: '1m', short: '1bln', label: '1 Bulan', range: '6mo', interval: '1d', days: 31 },
    { key: '6m', short: '6bln', label: '6 Bulan', range: '6mo', interval: '1d', days: null },
    { key: '1y', short: '1thn', label: '1 Tahun', range: '1y', interval: '1d', days: null },
  ];
  const SPAN_KEY = 'ta.beginner.span';
  let spanKey = $state(remembered());
  const span = $derived(SPANS.find((s) => s.key === spanKey) ?? SPANS[2]);

  function remembered(): string {
    try {
      return localStorage.getItem(SPAN_KEY) ?? '1m';
    } catch {
      return '1m';
    }
  }

  function pick(key: string) {
    spanKey = key;
    try {
      localStorage.setItem(SPAN_KEY, key);
    } catch {
      /* remembering the span is a convenience */
    }
  }

  const name = $derived(friendlyName(ws.symbol));
  const watched = $derived(watch.has(ws.yahoo));

  // Six months of daily candles give today's change and the 1- and 6-month spans;
  // the other spans load their own. Both refresh every minute (the server caches).
  let daily = $state<CandleSeries | null>(null);
  let other = $state<CandleSeries | null>(null);
  let error = $state('');
  let attempt = $state(0);
  const ownSeries = $derived(!(span.range === '6mo' && span.interval === '1d'));

  function follow(range: string, interval: Interval, set: (s: CandleSeries | null) => void) {
    const yahoo = ws.yahoo;
    const venue = venueOf(ws.symbol);
    set(null);
    if (!yahoo) return;
    let live = true;
    const load = () =>
      api
        .candles(yahoo, range, interval, venue)
        .then((s) => {
          if (!live) return;
          set(s);
          error = '';
        })
        .catch((e) => live && (error = (e as Error).message));
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }

  $effect(() => {
    void attempt;
    return follow('6mo', '1d', (s) => (daily = s));
  });
  $effect(() => {
    void attempt;
    if (!ownSeries) return;
    return follow(span.range, span.interval, (s) => (other = s));
  });
  const shown = $derived(ownSeries ? other : daily);

  /** Candle times as seconds, read as UTC so the axis shows the exchange's own clock. */
  const seconds = (t: string) => Date.parse(t.length > 10 ? `${t.slice(0, 19)}Z` : `${t}T00:00:00Z`) / 1000;
  const shift = (t: string, days: number) => {
    const iso = new Date((seconds(t) + days * 86_400) * 1000).toISOString();
    return t.length > 10 ? iso.slice(0, 19) : iso.slice(0, 10);
  };

  const points = $derived.by(() => {
    const candles = shown?.candles ?? [];
    if (!candles.length) return [];
    const last = candles[candles.length - 1].time;
    // A day: the last 24 hours of a market that never closes, else the last session's date.
    const from =
      span.days === 'session'
        ? shown!.source && shown!.source !== 'yahoo'
          ? shift(last, -1)
          : last.slice(0, 10)
        : span.days
          ? shift(last, -span.days)
          : '';
    const byTime = new Map<number, number>();
    for (const c of candles) if (c.time >= from) byTime.set(Math.floor(seconds(c.time)), c.close);
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
  });
  const spanChange = $derived(points.length > 1 ? points[points.length - 1].value / points[0].value - 1 : null);

  // The latest price and its change from the session before.
  const quote = $derived.by(() => {
    const c = daily?.candles ?? [];
    if (c.length < 2) return null;
    const now = c[c.length - 1];
    const before = c[c.length - 2];
    return { price: now.close, change: now.close / before.close - 1, today: now.time.slice(0, 10) === today() };
  });
  const live = $derived(!!daily?.source && daily.source !== 'yahoo');

  // Shared with the cards beside the chart.
  $effect(() => {
    latest.symbol = ws.yahoo ?? '';
    latest.price = quote?.price ?? null;
  });

  // --- The chart: made once its box exists, fed and coloured as data and theme change.
  let box: HTMLDivElement | undefined = $state();
  let chart: IChartApi | undefined;
  let area: ISeriesApi<'Area'> | undefined = $state();
  $effect(() => {
    if (!box) return;
    chart = createChart(box, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: false },
      localization: { locale: 'id-ID' },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.05 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { vertLine: { labelVisible: true }, horzLine: { labelVisible: true } },
      handleScroll: false,
      handleScale: false,
    });
    area = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    return () => {
      chart?.remove();
      chart = undefined;
      area = undefined;
    };
  });
  $effect(() => {
    void theme.dark;
    if (!chart || !area) return;
    const token = spanChange == null || spanChange === 0 ? '--color-base-content' : spanChange > 0 ? '--color-success' : '--color-error';
    const digits = points.length && points[points.length - 1].value < 1 ? 6 : points.length && points[points.length - 1].value < 100 ? 4 : 2;
    chart.applyOptions({
      layout: { textColor: tokenColor('--color-base-content', 0.7), fontFamily: getComputedStyle(box!).fontFamily },
      grid: { vertLines: { visible: false }, horzLines: { color: tokenColor('--color-base-300', 0.6) } },
      localization: { locale: 'id-ID', priceFormatter: (p: number) => p.toLocaleString('id-ID', { maximumFractionDigits: digits }) },
      timeScale: { timeVisible: span.interval !== '1d', secondsVisible: false },
    });
    area.applyOptions({ lineColor: tokenColor(token), topColor: tokenColor(token, 0.22), bottomColor: tokenColor(token, 0.02) });
    area.setData(points);
    chart.timeScale().fitContent();
  });
</script>

<section class="flex min-h-0 flex-col gap-3" aria-labelledby="asset-name">
  <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
    <div class="min-w-0">
      <h1 id="asset-name" class="truncate text-xl font-semibold tracking-tight sm:text-2xl">{name}</h1>
      <p class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-base-content/70">
        <span>{ws.symbol}</span>
        {#if daily}
          <span class="inline-flex items-center gap-1.5">
            <span class="status status-xs {live ? 'status-success' : 'status-neutral'}" aria-hidden="true"></span>{live ? 'Harga real-time' : 'Harga tertunda beberapa menit'}
          </span>
        {/if}
        <SessionBadge tv={ws.symbol} />
      </p>
    </div>
    {#if ws.yahoo}
      <button
        class="btn btn-sm shrink-0 gap-1.5"
        class:btn-soft={watched}
        aria-pressed={watched}
        title={watched ? 'Hapus dari Pantauanku' : 'Simpan ke Pantauanku: dianalisa AI tiap hari bursa'}
        onclick={() => watch.toggle(ws.yahoo!, ws.symbol)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" class:text-warning={watched} aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
        {watched ? 'Dipantau' : 'Pantau'}
      </button>
    {/if}
  </div>

  {#if !ws.yahoo}
    <div class="rounded-box border border-base-300 p-4 text-sm">
      <p>Grafik sederhana belum tersedia untuk {ws.symbol}, dan AI belum bisa menganalisanya.</p>
      <button class="btn btn-sm mt-3" onclick={() => mode.set('pro')}>Buka di mode Pro (grafik TradingView)</button>
    </div>
  {:else}
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {#if quote}
        <p class="text-3xl font-semibold tracking-tight tabular-nums">{priceText(quote.price, daily?.currency ?? null, ws.yahoo)}</p>
        <p class="text-base font-medium tabular-nums {toneOf(quote.change)}">
          <span aria-hidden="true">{quote.change > 0 ? '▲' : quote.change < 0 ? '▼' : '■'}</span>
          {formatPercent(quote.change)}
          <span class="font-normal text-base-content/70">{quote.today ? 'hari ini' : 'sesi terakhir'}</span>
        </p>
      {:else if error}
        <p role="alert" class="text-sm text-error">
          Harga belum bisa dimuat. <button class="link" onclick={() => attempt++}>Coba lagi</button>
        </p>
      {:else}
        <div class="skeleton h-9 w-48"></div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <div role="tablist" class="tabs tabs-box tabs-sm" aria-label="Rentang waktu grafik">
        {#each SPANS as s (s.key)}
          <button role="tab" class="tab" class:tab-active={s.key === span.key} aria-selected={s.key === span.key} onclick={() => pick(s.key)}>
            <span class="sm:hidden">{s.short}</span><span class="hidden sm:inline">{s.label}</span>
          </button>
        {/each}
      </div>
      {#if spanChange != null}
        <p class="text-sm tabular-nums">
          <span class="font-medium {toneOf(spanChange)}">{spanChange > 0 ? 'Naik' : spanChange < 0 ? 'Turun' : 'Datar'} {formatPercent(Math.abs(spanChange), false)}</span>
          <span class="text-base-content/70">dalam {span.label.toLowerCase()}</span>
        </p>
      {/if}
    </div>

    <div class="relative h-56 min-h-0 sm:h-72">
      <div bind:this={box} class="absolute inset-0" role="img" aria-label="Grafik harga {name}, {span.label.toLowerCase()} terakhir"></div>
      {#if !shown}
        {#if error}
          <p role="alert" class="absolute inset-0 grid place-items-center rounded-box border border-base-300 text-sm">
            <span>Grafik belum bisa dimuat. <button class="link" onclick={() => attempt++}>Coba lagi</button></span>
          </p>
        {:else}
          <div class="skeleton absolute inset-0"></div>
        {/if}
      {/if}
    </div>
  {/if}
</section>
