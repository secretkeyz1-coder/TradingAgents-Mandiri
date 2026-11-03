<script lang="ts">
  // Beranda's side column (ADR 0021). The markets a trader in Indonesia checks first (server site.ts /public/market),
  // each with its session in WIB and its change from the previous close, so at 07.00 yesterday's IDX session never
  // reads as today's; Pantauanku with live prices and the AI's last call in the words Pemula uses (routes.ts
  // /quotes, the watchlist's decision); the AI market brief folded to its headline, marked when it is old; and
  // today's quota, or what opens it for an account not verified yet. Every row opens its chart.
  import { api, type MarketBrief, type MarketQuote, type Quote } from '../../api';
  import { auth } from '../../auth.svelte';
  import { biasLean, friendlyName, priceText, STARTERS } from '../../beginner/plain';
  import { callOf, dirOf, monogram, percentText, sparkPath } from '../../marks';
  import { sessionOf } from '../../sessions';
  import { usage } from '../../stores/usage.svelte';
  import { watch } from '../../stores/watch.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import TelegramConnect from '../../TelegramConnect.svelte';
  import { toYahoo } from '../../tv';
  import VerifyNote from '../../VerifyNote.svelte';
  import Icon from '../Icon.svelte';
  import { agoText } from './calls';

  /** `starters`: offer the well-known assets when Pantauanku is empty, unless "Mulai di sini" already does. */
  let { telegram, starters = true }: { telegram: boolean | null; starters?: boolean } = $props();

  /** The markets in reading order, with the chart each opens. */
  const STRIP: [site: string, tv: string, name: string][] = [
    ['^JKSE', 'IDX:COMPOSITE', 'IHSG'],
    ['GC=F', 'OANDA:XAUUSD', 'Emas'],
    ['BTC-USD', 'BINANCE:BTCUSDT', 'Bitcoin'],
    ['IDR=X', 'FX_IDC:USDIDR', 'USD/IDR'],
    ['^GSPC', 'SP:SPX', 'S&P 500'],
  ];
  /** The brief names assets by their short label (server site.ts ASSETS). */
  const BRIEF_NAMES: Record<string, string> = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana' };

  let market = $state<MarketQuote[] | null>(null);
  let brief = $state<MarketBrief | undefined>(undefined);
  let quotes = $state<Record<string, Quote | null>>({});
  let briefOpen = $state(false);
  api
    .publicMarket()
    .then((m) => (market = m))
    .catch(() => (market = []));
  api
    .publicBrief()
    .then((b) => (brief = b))
    .catch(() => (brief = null));
  watch.load();
  usage.refresh();

  const strip = $derived(STRIP.flatMap(([site, tv, name]) => (market ?? []).filter((m) => m.symbol === site).map((m) => ({ ...m, tv, name }))));
  const items = $derived(watch.value?.items ?? []);
  $effect(() => {
    const symbols = items.map((i) => i.symbol);
    if (!symbols.length) return;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .quotes(symbols)
        .then((r) => (quotes = r.quotes))
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });
  /** Pantauanku, the biggest move today first. */
  const watched = $derived([...items].sort((a, b) => Math.abs(quotes[b.symbol]?.change ?? 0) - Math.abs(quotes[a.symbol]?.change ?? 0)));
  const wibDay = (t: number) => Math.floor((t + 7 * 3_600_000) / 86_400_000);
  const stale = $derived(brief ? wibDay(Date.now()) > wibDay(Date.parse(brief.createdAt)) : false);
  /** The model sometimes opens its watch line with the label the row already shows. */
  const watchText = (s: string) => s.replace(/^pantau(lah)?\s+/i, '');
  const monthDir = (spark: number[]) => dirOf(spark.length > 1 ? spark[spark.length - 1] - spark[0] : null);
  const quotas = $derived(
    usage.value
      ? [
          { label: 'Analisa AI', u: usage.value.analyses },
          { label: 'Tanya AI', u: usage.value.chat },
        ]
      : [],
  );
</script>

{#if telegram === false && watch.value?.telegram.bot}
  <section class="ta-card flex flex-col gap-2 p-4 text-sm" aria-label="Telegram">
    <p>Sinyalmu tercatat di sini, tapi belum sampai ke HP-mu.</p>
    <TelegramConnect compact />
  </section>
{/if}

<section class="ta-card ta-pane" aria-labelledby="mkt-title">
  <div class="ta-pane-head">
    <h2 id="mkt-title" class="font-semibold">Pasar</h2>
    <span class="text-xs ta-muted">dari penutupan sebelumnya</span>
  </div>
  {#if market === null}
    <div class="h-40 animate-pulse rounded-field bg-base-200" aria-label="Memuat harga pasar"></div>
  {:else if !strip.length}
    <p class="text-sm ta-muted">Harga pasar belum bisa dimuat.</p>
  {:else}
    <ul class="-mx-2 flex flex-col">
      {#each strip as q (q.symbol)}
        <li>
          <button type="button" class="ta-asset" onclick={() => ws.setSymbol(q.tv)}>
            <span class="ta-mono">{monogram(q.tv)}</span>
            <span class="min-w-0">
              <span class="block font-semibold">{q.name}</span>
              <span class="block text-xs text-pretty ta-muted">{sessionOf(q.tv)?.text ?? ''}</span>
            </span>
            <span class="flex items-center gap-3">
              <svg class="ta-spark h-7 w-14 max-sm:hidden" data-dir={monthDir(q.spark)} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><path d={sparkPath(q.spark)} /></svg>
              <span class="flex flex-col items-end gap-1">
                <span class="font-semibold tabular-nums">{priceText(q.price, q.currency, q.symbol)}</span>
                {#if q.change != null}<span class="ta-chip" data-dir={dirOf(q.change)}>{percentText(q.change)}</span>{/if}
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="ta-card ta-pane" aria-labelledby="wl-title">
  <div class="ta-pane-head">
    <h2 id="wl-title" class="font-semibold">Pantauanku</h2>
    {#if watch.value}<span class="text-xs ta-muted">{items.length} dari {watch.value.max}</span>{/if}
  </div>
  {#if !watch.value}
    <div class="h-24 animate-pulse rounded-field bg-base-200" aria-label="Memuat"></div>
  {:else if !items.length}
    <p class="text-sm ta-muted">Belum ada. Aset yang kamu tambahkan tampil di sini dengan harganya, dan AI menganalisanya tiap hari bursa.</p>
    {#if starters}
      <div class="flex flex-wrap gap-2">
        {#each STARTERS as [tv, name] (tv)}
          {@const yahoo = toYahoo(tv)}
          {#if yahoo}<button type="button" class="btn btn-sm" onclick={() => watch.toggle(yahoo, tv)}>+ {name}</button>{/if}
        {/each}
      </div>
    {/if}
  {:else}
    <ul class="-mx-2 flex flex-col">
      {#each watched as item (item.symbol)}
        {@const q = quotes[item.symbol]}
        {@const call = item.decision?.rating ? callOf(item.decision.rating) : null}
        <li>
          <button type="button" class="ta-asset" onclick={() => ws.setSymbol(item.tvSymbol)}>
            <span class="ta-mono" data-watched>{monogram(item.tvSymbol)}</span>
            <span class="flex min-w-0 flex-col items-start gap-1">
              <span class="max-w-full truncate font-semibold">{friendlyName(item.tvSymbol)}</span>
              {#if call}
                <span class="ta-chip" data-dir={call.dir} title="Keputusan AI terakhir, {item.decision?.tradeDate}"><Icon name={call.icon} size={12} stroke={2.4} />{call.label}</span>
              {:else}
                <span class="text-xs ta-muted">Belum dianalisa AI</span>
              {/if}
            </span>
            <span class="flex flex-col items-end gap-1 tabular-nums">
              <span class="font-semibold">{q ? priceText(q.price, q.currency, item.symbol) : '–'}</span>
              {#if q?.change != null}<span class="text-xs font-semibold {q.change > 0 ? 'ta-up' : q.change < 0 ? 'ta-down' : 'ta-muted'}">{percentText(q.change)}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="ta-pane-foot">
      <span class="text-xs ta-muted">Dianalisa AI tiap hari bursa</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => ws.setDock('watch')}>Kelola di Pantau</button>
    </div>
  {/if}
</section>

<section class="ta-card ta-pane" aria-labelledby="ai-title">
  <div class="ta-pane-head">
    <h2 id="ai-title" class="font-semibold">Ringkasan pasar AI</h2>
    {#if brief}<span class="ta-chip" data-dir={stale ? 'warn' : undefined}>ditulis {agoText(brief.createdAt)}</span>{/if}
  </div>
  {#if brief === undefined}
    <div class="h-24 animate-pulse rounded-field bg-base-200" aria-label="Memuat"></div>
  {:else if !brief}
    <p class="text-sm ta-muted">Ringkasan hari ini belum tersedia.</p>
  {:else}
    <p class="font-semibold text-pretty">{brief.content.headline}</p>
    {#if briefOpen}<p class="text-sm text-pretty ta-muted">{brief.content.summary}</p>{/if}
    <ul class="flex flex-col gap-2 text-sm">
      {#each briefOpen ? brief.content.assets : brief.content.assets.slice(0, 3) as a (a.symbol)}
        {@const lean = biasLean(a.bias)}
        <li class="flex flex-col gap-1">
          <span class="flex items-center justify-between gap-2">
            <span class="font-semibold">{BRIEF_NAMES[a.symbol] ?? a.symbol}</span>
            <span class="ta-chip" data-dir={dirOf(lean.direction)}><Icon name={lean.direction > 0 ? 'arrowUp' : lean.direction < 0 ? 'arrowDown' : 'minus'} size={12} stroke={2.4} />{lean.label}</span>
          </span>
          {#if briefOpen}<span class="text-xs ta-muted">Pantau: {watchText(a.watch)}</span>{/if}
        </li>
      {/each}
    </ul>
    {#if stale}<p class="text-xs text-warning">Harga di atas lebih baru dari ringkasan ini, jadi angkanya bisa sudah berbeda.</p>{/if}
    <div class="ta-pane-foot">
      <span class="text-xs ta-muted">Riset otomatis, bukan saran investasi.</span>
      <button type="button" class="btn btn-ghost btn-sm" aria-expanded={briefOpen} onclick={() => (briefOpen = !briefOpen)}>{briefOpen ? 'Lebih ringkas' : 'Baca selengkapnya'}</button>
    </div>
  {/if}
</section>

<section class="ta-card ta-pane" aria-labelledby="quota-title">
  <div class="ta-pane-head">
    <h2 id="quota-title" class="font-semibold">Kuota hari ini</h2>
    <span class="text-xs ta-muted">direset 00.00 WIB</span>
  </div>
  {#if auth.unverified}
    <VerifyNote />
  {:else if !usage.value}
    <div class="h-12 animate-pulse rounded-field bg-base-200" aria-label="Memuat"></div>
  {:else}
    {#each quotas as q (q.label)}
      <div class="flex flex-col gap-1.5">
        <span class="flex justify-between text-sm"><span>{q.label}</span><span class="font-semibold tabular-nums">{q.u.limit ? `${q.u.used} dari ${q.u.limit}` : `${q.u.used}, tanpa batas`}</span></span>
        {#if q.u.limit}<progress class="progress progress-primary h-1.5" value={q.u.used} max={q.u.limit} aria-label="{q.label}: {q.u.used} dari {q.u.limit}"></progress>{/if}
      </div>
    {/each}
  {/if}
</section>
