<script lang="ts">
  // Pasar: the price list per market, from the server's quotes (GET /api/quotes: the daily bars
  // the chart reads), with the change on the previous close that traders scan first, at any
  // panel width. A row opens its chart; the list refreshes every minute while the tab is in
  // front. The same market's screener sits in the bottom panel, under the same destination.
  import { api, type Quote } from '../api';
  import { priceText } from '../beginner/plain';
  import { layout } from '../stores/layout.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { MARKET_TABS, toYahoo } from '../tv';
  import PanelClose from './PanelClose.svelte';

  /** `bare`: on a phone the Pasar screen's tab row stands in for the header (PhoneScreen). */
  let { bare = false, onclose }: { bare?: boolean; onclose?: () => void } = $props();

  const SHORT: Record<string, string> = { idx: 'IDX', us: 'US', crypto: 'Crypto', forex: 'Forex', commodities: 'Komoditas' };
  const active = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
  const groups = $derived(
    active.groups.map((g) => ({ name: g.name, items: g.symbols.map(([tv, name]) => ({ tv, name, yahoo: toYahoo(tv) })) })),
  );

  let quotes = $state<Record<string, Quote | null>>({});
  let failed = $state(false);

  $effect(() => {
    const symbols = [...new Set(groups.flatMap((g) => g.items.flatMap((i) => (i.yahoo ? [i.yahoo] : []))))];
    if (!symbols.length) return;
    let stopped = false;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const answers = await Promise.all(Array.from({ length: Math.ceil(symbols.length / 80) }, (_, i) => api.quotes(symbols.slice(i * 80, i * 80 + 80))));
        if (stopped) return;
        quotes = Object.assign({ ...quotes }, ...answers.map((a) => a.quotes));
        failed = false;
      } catch {
        if (!stopped) failed = true;
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });

  const percent = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(2).replace('.', ',')}%`;

  /** The bottom panel on the screener, brought back if it was hidden. */
  function screener() {
    ws.setDock('screener');
    if (layout.effective('dock') === 'min') layout.restore('dock');
    else if (layout.effective('dock') === 'float') layout.front('dock');
  }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Pasar">
  {#if !bare}
    <header class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3">
      <h2 class="text-sm font-semibold">Pasar</h2>
      <div class="flex items-center gap-1">
        <button class="btn btn-ghost btn-xs" onclick={screener}>Screener</button>
        {#if onclose}<PanelClose label="Tutup panel Pasar" onclick={onclose} />{/if}
      </div>
    </header>
  {/if}
  <div role="tablist" class="tabs tabs-border tabs-sm shrink-0 flex-nowrap overflow-x-auto px-1" aria-label="Pasar">
    {#each MARKET_TABS as tab (tab.key)}
      <button role="tab" class="tab whitespace-nowrap" class:tab-active={tab.key === active.key} aria-selected={tab.key === active.key} onclick={() => ws.setMarket(tab.key)}>
        {SHORT[tab.key] ?? tab.label}
      </button>
    {/each}
  </div>
  <div class="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3 py-1 text-xs text-base-content/70" aria-hidden="true">
    <span>Nama</span>
    <span class="flex gap-2"><span>Harga</span><span class="w-16 text-right">Hari ini</span></span>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if failed && !Object.keys(quotes).length}
      <p class="p-3 text-sm text-error">Harga belum bisa dimuat. Dicoba lagi tiap menit.</p>
    {/if}
    {#each groups as group (group.name)}
      <h3 class="sticky top-0 z-10 border-b border-base-200 bg-base-100 px-3 pt-2 pb-1 text-xs font-semibold text-base-content/70">{group.name}</h3>
      <ul>
        {#each group.items as item (item.tv)}
          {@const q = item.yahoo ? quotes[item.yahoo] : null}
          <li>
            <button
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-base-200"
              class:bg-base-200={ws.symbol === item.tv}
              aria-current={ws.symbol === item.tv ? 'true' : undefined}
              onclick={() => ws.setSymbol(item.tv)}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{item.name}</span>
                <span class="block truncate font-mono text-xs text-base-content/60">{item.tv.split(':').pop()}</span>
              </span>
              {#if q}
                <span class="tabular-nums">{priceText(q.price, q.currency, item.yahoo ?? '')}</span>
                <span class="w-16 text-right tabular-nums" class:text-success={(q.change ?? 0) > 0} class:text-error={(q.change ?? 0) < 0}>
                  {q.change == null ? '–' : percent(q.change)}
                </span>
              {:else}
                <span class="tabular-nums text-base-content/50">{item.yahoo && !(item.yahoo in quotes) ? '…' : '–'}</span>
                <span class="w-16"></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
    <p class="px-3 py-2 text-xs text-base-content/60">Harga saham dan indeks tertunda beberapa menit; kripto real-time.</p>
  </div>
</section>
