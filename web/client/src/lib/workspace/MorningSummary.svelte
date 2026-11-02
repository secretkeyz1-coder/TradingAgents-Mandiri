<script lang="ts">
  // Beranda's morning summary: what a trader checks first in the minute they have. The main
  // markets with today's change and a month's line (server site.ts /public/market), what
  // happened since the last visit (analytics.ts /activity/since), Pantauanku with live prices
  // and the latest AI decision, busiest move first (routes.ts /quotes), and the day's AI market
  // brief (site.ts /public/brief). Every row opens its chart.
  import { INDICATOR_NAMES, TIMEFRAME_LABELS } from '../alertLabels';
  import { api, type MarketBrief, type MarketQuote, type Quote, type SinceVisit } from '../api';
  import { friendlyName, priceText, STARTERS } from '../beginner/plain';
  import { ratingBadge } from '../format';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { toYahoo } from '../tv';

  /** The strip's markets in reading order, with the chart each opens. */
  const STRIP: [site: string, tv: string, name: string][] = [
    ['^JKSE', 'IDX:COMPOSITE', 'IHSG'],
    ['GC=F', 'OANDA:XAUUSD', 'Emas'],
    ['BTC-USD', 'BINANCE:BTCUSDT', 'Bitcoin'],
    ['IDR=X', 'FX_IDC:USDIDR', 'USD/IDR'],
    ['^GSPC', 'SP:SPX', 'S&P 500'],
  ];
  const LEAN: Record<string, [string, string]> = { naik: ['condong naik', 'text-success'], turun: ['condong turun', 'text-error'], netral: ['netral', 'text-base-content/70'] };
  /** The brief names assets by their short label (server site.ts ASSETS). */
  const BRIEF_NAMES: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };

  let market = $state<MarketQuote[] | null>(null);
  let brief = $state<MarketBrief | undefined>(undefined);
  let since = $state<SinceVisit | null>(null);
  let quotes = $state<Record<string, Quote | null>>({});
  let allAssets = $state(false);

  api
    .publicMarket()
    .then((m) => (market = m))
    .catch(() => (market = []));
  api
    .publicBrief()
    .then((b) => (brief = b))
    .catch(() => (brief = null));
  api
    .sinceVisit()
    .then((s) => (since = s))
    .catch(() => {});
  watch.load();

  const strip = $derived(
    (market ?? []).length ? STRIP.flatMap(([site, tv, name]) => market!.filter((m) => m.symbol === site).map((m) => ({ ...m, tv, name }))) : [],
  );
  const items = $derived(watch.value?.items ?? []);
  $effect(() => {
    const symbols = items.map((i) => i.symbol);
    if (!symbols.length) return;
    let stopped = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .quotes(symbols)
        .then((r) => {
          if (!stopped) quotes = r.quotes;
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });
  /** Pantauanku, the biggest move today first. */
  const watched = $derived([...items].sort((a, b) => Math.abs(quotes[b.symbol]?.change ?? 0) - Math.abs(quotes[a.symbol]?.change ?? 0)));
  const awayItems = $derived(since ? since.calls.length + since.hits.length + since.analyses.length : 0);

  const percent = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(2).replace('.', ',')}%`;
  const tone = (x: number | null | undefined) => (x == null ? 'text-base-content/70' : x > 0 ? 'text-success' : x < 0 ? 'text-error' : 'text-base-content/70');
  /** A month of closes as a line across the tile. */
  function spark(values: number[]) {
    if (values.length < 2) return '';
    const low = Math.min(...values);
    const span = Math.max(...values) - low || 1;
    return values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(22 - ((v - low) / span) * 20).toFixed(1)}`).join(' ');
  }
  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  function ago(iso: string) {
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    if (minutes < 1440) return rtf.format(-Math.round(minutes / 60), 'hour');
    return rtf.format(-Math.round(minutes / 1440), 'day');
  }
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });
  const indicatorName = (key: string) => INDICATOR_NAMES[key] ?? (key.startsWith('catalog:') ? 'Indikator' : 'Skrip');
</script>

<section class="flex min-w-0 flex-col gap-4" aria-labelledby="morning-title">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 id="morning-title" class="text-lg font-semibold tracking-tight">Ringkasan hari ini</h2>
    <span class="text-sm text-base-content/70">{today}</span>
  </div>

  {#if market === null}
    <div class="h-20 animate-pulse rounded-box bg-base-200" aria-label="Memuat harga pasar"></div>
  {:else if strip.length}
    <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Pasar utama">
      {#each strip as q (q.symbol)}
        <li>
          <button class="flex w-full flex-col gap-0.5 rounded-box border border-base-300 bg-base-100 p-3 text-left hover:border-base-content/30" onclick={() => ws.setSymbol(q.tv)}>
            <span class="text-xs text-base-content/70">{q.name}</span>
            <span class="font-semibold tabular-nums">{priceText(q.price, q.currency, q.symbol)}</span>
            <span class="text-xs tabular-nums {tone(q.change)}">{q.change == null ? '–' : `${percent(q.change)} hari ini`}</span>
            <svg viewBox="0 0 100 24" class="mt-1 h-6 w-full text-base-content/40" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={spark(q.spark)} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if since?.since && awayItems}
    <section class="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="away-title">
      <h3 id="away-title" class="font-semibold">Sejak kamu terakhir buka <span class="font-normal text-base-content/70">({ago(since.since)})</span></h3>
      <ul class="flex flex-col gap-1.5 text-sm">
        {#each since.calls as c (c.id)}
          <li>
            <span class="badge badge-sm badge-info badge-soft">Sinyal baru</span>
            <button class="link link-hover font-mono" onclick={() => ws.setSymbol(c.tvSymbol)}>{c.tvSymbol}</button>
            {c.label} · {indicatorName(c.indicator)} {TIMEFRAME_LABELS[c.timeframe as keyof typeof TIMEFRAME_LABELS] ?? c.timeframe}
          </li>
        {/each}
        {#each since.hits as h (h.id)}
          <li>
            <span class="badge badge-sm badge-warning badge-soft">Alert harga</span>
            <button class="link link-hover font-mono" onclick={() => ws.setSymbol(h.tvSymbol)}>{h.tvSymbol}</button>
            {h.direction === 'above' ? 'naik ke' : 'turun ke'} {h.price.toLocaleString('id-ID')}
          </li>
        {/each}
        {#each since.analyses as a (a.id)}
          <li>
            <span class="badge badge-sm badge-success badge-soft">Analisa selesai</span>
            <button class="link link-hover" onclick={() => ws.openRun(a.id, {})}>{a.ticker}</button>
            {#if a.rating}<span class="badge badge-sm {ratingBadge(a.rating)}">{a.rating}</span>{/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="grid items-start gap-4 lg:grid-cols-2">
    <section class="flex min-w-0 flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="mine-title">
      <div class="flex items-baseline justify-between gap-2">
        <h3 id="mine-title" class="font-semibold">Pantauanku</h3>
        {#if watch.value}<span class="text-xs text-base-content/70">{items.length} dari {watch.value.max}</span>{/if}
      </div>
      {#if !watch.value}
        <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
      {:else if !items.length}
        <p class="text-sm text-base-content/70">Belum ada. Tambahkan aset yang kamu ikuti: harganya tampil di sini setiap buka, dan AI menganalisanya tiap hari bursa.</p>
        <div class="flex flex-wrap gap-2">
          {#each STARTERS as [tv, name] (tv)}
            {@const yahoo = toYahoo(tv)}
            {#if yahoo}<button class="btn btn-sm" onclick={() => watch.toggle(yahoo, tv)}>+ {name}</button>{/if}
          {/each}
        </div>
      {:else}
        <ul class="flex flex-col">
          {#each watched as item (item.symbol)}
            {@const q = quotes[item.symbol]}
            <li>
              <button class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-sm hover:bg-base-200" onclick={() => ws.setSymbol(item.tvSymbol)}>
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{friendlyName(item.tvSymbol)}</span>
                  <span class="block truncate font-mono text-xs text-base-content/60">{item.tvSymbol}</span>
                </span>
                {#if item.last?.rating}<span class="badge badge-sm {ratingBadge(item.last.rating)}" title="Keputusan AI terakhir, {item.last.tradeDate}">{item.last.rating}</span>{/if}
                <span class="tabular-nums">{q ? priceText(q.price, q.currency, item.symbol) : '…'}</span>
                <span class="w-16 text-right tabular-nums {tone(q?.change)}">{q?.change == null ? '' : percent(q.change)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="flex min-w-0 flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="brief-title">
      <div class="flex items-baseline justify-between gap-2">
        <h3 id="brief-title" class="font-semibold">Ringkasan pasar AI</h3>
        {#if brief}<span class="text-xs text-base-content/70">{ago(brief.createdAt)}</span>{/if}
      </div>
      {#if brief === undefined}
        <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
      {:else if !brief}
        <p class="text-sm text-base-content/70">Ringkasan hari ini belum tersedia.</p>
      {:else}
        <p class="font-medium">{brief.content.headline}</p>
        <p class="text-sm text-base-content/80">{brief.content.summary}</p>
        <ul class="flex flex-col gap-2 text-sm">
          {#each allAssets ? brief.content.assets : brief.content.assets.slice(0, 3) as a (a.symbol)}
            <li>
              <span class="font-medium">{BRIEF_NAMES[a.symbol] ?? a.symbol}</span>
              <span class={LEAN[a.bias]?.[1]}>· {LEAN[a.bias]?.[0] ?? a.bias}</span>
              <span class="block text-base-content/70">Pantau: {a.watch}</span>
            </li>
          {/each}
        </ul>
        {#if brief.content.assets.length > 3}
          <button class="link link-hover self-start text-xs" onclick={() => (allAssets = !allAssets)}>{allAssets ? 'Lebih sedikit' : 'Semua aset'}</button>
        {/if}
        <p class="text-xs text-base-content/60">Riset otomatis, bukan saran investasi.</p>
      {/if}
    </section>
  </div>
</section>
