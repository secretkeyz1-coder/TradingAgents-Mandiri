<script lang="ts">
  // Watchlist per market. A click inside the TradingView widget comes back as
  // #/?tvwidgetsymbol=… and the workspace makes that symbol the focus.
  import TradingViewWidget from '../TradingViewWidget.svelte';
  import { appUrl } from '../router.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { MARKET_TABS } from '../tv';

  let { onclose }: { onclose?: () => void } = $props();

  const SHORT: Record<string, string> = { idx: 'IDX', us: 'US', crypto: 'Crypto', forex: 'Forex', commodities: 'Komoditas' };
  const active = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
  const chartUrl = appUrl('/');
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Pasar">
  <header class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3">
    <h2 class="text-sm font-semibold">Pasar</h2>
    <div class="flex items-center gap-1">
      <button class="btn btn-ghost btn-xs" onclick={() => ws.setDock('screener')}>Screener</button>
      {#if onclose}
        <button class="btn btn-ghost btn-xs" onclick={onclose} aria-label="Tutup panel pasar">Tutup</button>
      {/if}
    </div>
  </header>
  <div role="tablist" class="tabs tabs-border tabs-sm shrink-0 flex-nowrap overflow-x-auto px-1">
    {#each MARKET_TABS as tab (tab.key)}
      <button role="tab" class="tab whitespace-nowrap" class:tab-active={tab.key === active.key} onclick={() => ws.setMarket(tab.key)}>
        {SHORT[tab.key] ?? tab.label}
      </button>
    {/each}
  </div>
  <div class="min-h-0 flex-1">
    {#key active.key}
      <TradingViewWidget
        widget="market-quotes"
        class="h-full"
        config={{
          width: '100%',
          height: '100%',
          showSymbolLogo: true,
          largeChartUrl: chartUrl,
          symbolsGroups: active.groups.map((g) => ({ name: g.name, symbols: g.symbols.map(([name, displayName]) => ({ name, displayName })) })),
        }}
      />
    {/key}
  </div>
</section>
