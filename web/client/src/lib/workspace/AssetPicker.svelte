<script lang="ts">
  // Riset AI's start, its left column (ADR 0019): which asset to research. Untukmu first: Pantauanku, the assets
  // researched lately and those opened lately, or the well-known ones on a first visit; then each market with its
  // prices. A row carries the AI's last call on that asset. Picking one shows it beside the list (ResearchPreview)
  // without opening its chart; on a phone the list is the whole screen and the preview follows it.
  import { STARTERS } from '../beginner/plain';
  import { formatDay } from '../format';
  import { callOf as callFrom } from '../marks';
  import { jobs } from '../stores/jobs.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { toTradingView, toYahoo } from '../tv';
  import AssetFinder from './AssetFinder.svelte';

  let { selected = null, onpick }: { selected?: string | null; onpick: (tv: string) => void } = $props();

  watch.load();

  const wide = $derived(layoutOf(viewport) !== 'narrow');
  const watched = $derived(watch.value?.items.map((w) => w.tvSymbol) ?? []);
  /** Each ticker's newest analysis that ended with a rating (the history is newest first). */
  const calls = $derived.by(() => {
    const byTicker = new Map<string, { rating: string; day: string }>();
    for (const a of jobs.analyses) {
      if (a.kind === 'analysis' && a.status === 'completed' && a.rating && !byTicker.has(a.ticker)) byTicker.set(a.ticker, { rating: a.rating, day: a.tradeDate });
    }
    return byTicker;
  });
  const researched = $derived([...new Set(jobs.analyses.filter((a) => a.kind === 'analysis').map((a) => toTradingView(a.ticker)))].slice(0, 6));
  const groups = $derived.by(() => {
    const mine = [
      { heading: 'Pantauanku', note: 'dianalisa AI tiap hari bursa', symbols: watched },
      { heading: 'Riset terakhir', symbols: researched },
      { heading: 'Terakhir dibuka', symbols: ws.recent },
    ].filter((g) => g.symbols.length);
    return mine.length ? mine : [{ heading: 'Populer', note: 'untuk mulai', symbols: STARTERS.map(([tv]) => tv) }];
  });

  function callOf(tv: string) {
    const ticker = toYahoo(tv);
    const c = ticker ? calls.get(ticker) : undefined;
    return c ? callFrom(c.rating, formatDay(c.day)) : null;
  }
</script>

<section class="flex min-w-0 flex-col gap-4" aria-labelledby="picker-title">
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center gap-3">
      <span class="ta-step-n" aria-hidden="true">1</span>
      <h1 id="picker-title" class="ta-title">Aset mana yang mau diriset?</h1>
    </div>
    <p class="text-sm ta-muted">
      Pilih dari daftar atau ketik namanya. {wide ? 'Harga, grafik, dan keputusan AI terakhirnya muncul di sebelahnya.' : 'Harga dan keputusan AI terakhirnya muncul sesudahnya.'}
    </p>
  </div>
  <AssetFinder size="lg" browse autofocus={wide && !selected} home={groups} {selected} {callOf} watched={(tv) => watched.includes(tv)} {onpick} />
</section>
