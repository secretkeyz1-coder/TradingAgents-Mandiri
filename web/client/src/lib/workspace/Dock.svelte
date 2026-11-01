<script lang="ts">
  // The bottom dock, in three groups (stores/workspace DOCK_GROUPS): Analisa (history,
  // the open analysis's report and log), Pantau (watchlist, signal ledger, screener)
  // and Strategi (the open backtest, the strategy lab). Each view is its own component.
  import TradingViewWidget from '../TradingViewWidget.svelte';
  import { appUrl } from '../router.svelte';
  import { DOCK_GROUPS, groupOf, ws, type DockTab } from '../stores/workspace.svelte';
  import { MARKET_TABS } from '../tv';
  import BacktestView from './dock/BacktestView.svelte';
  import HistoryView from './dock/HistoryView.svelte';
  import LabView from './dock/LabView.svelte';
  import LogView from './dock/LogView.svelte';
  import ReportView from './dock/ReportView.svelte';
  import SignalsView from './dock/SignalsView.svelte';
  import WatchView from './dock/WatchView.svelte';

  /** On a phone the dock is a whole screen and has no size controls. */
  let { collapsible = true }: { collapsible?: boolean } = $props();

  const market = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
  const open = $derived(!collapsible || ws.dockSize !== 'min');
  const group = $derived(groupOf(ws.dock));
  /** A tab whose job is still running. */
  const live = (tab: DockTab) => (tab === 'report' && !!ws.run?.live) || (tab === 'backtest' && !!ws.backtest?.live);

  const SIZE = {
    max: { label: 'Perbesar panel', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
    normal: { label: 'Ukuran normal', icon: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' },
    min: { label: 'Sembunyikan panel', icon: 'm6 9 6 6 6-6' },
    show: { label: 'Tampilkan panel', icon: 'm18 15-6-6-6 6' },
  };
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Dock">
  {#snippet sizeButton(kind: keyof typeof SIZE, next: 'min' | 'normal' | 'max')}
    <button class="btn btn-ghost btn-xs btn-square" title={SIZE[kind].label} aria-label={SIZE[kind].label} onclick={() => (ws.dockSize = next)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={SIZE[kind].icon} /></svg>
    </button>
  {/snippet}

  <header class="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-300 px-2 py-1">
    <div role="tablist" class="tabs tabs-border tabs-sm shrink-0 flex-nowrap" aria-label="Kelompok panel">
      {#each DOCK_GROUPS as g (g.key)}
        <button role="tab" class="tab gap-1.5 font-medium whitespace-nowrap" class:tab-active={open && group.key === g.key} aria-selected={open && group.key === g.key} onclick={() => ws.openGroup(g.key)}>
          {g.label}
          {#if g.tabs.some((t) => live(t.key))}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
        </button>
      {/each}
    </div>
    <div role="tablist" class="tabs tabs-box tabs-xs min-w-0 flex-nowrap overflow-x-auto" aria-label={group.label}>
      {#each group.tabs as t (t.key)}
        <button role="tab" class="tab gap-1.5 whitespace-nowrap" class:tab-active={open && ws.dock === t.key} aria-selected={open && ws.dock === t.key} onclick={() => ws.setDock(t.key)}>
          {t.label}
          {#if t.key === 'log' && ws.run}<span class="tabular-nums text-base-content/70">{ws.run.log.length}</span>{/if}
          {#if live(t.key)}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
        </button>
      {/each}
    </div>
    {#if collapsible}
      <div class="ml-auto flex shrink-0 gap-0.5">
        {#if ws.dockSize === 'max'}
          {@render sizeButton('normal', 'normal')}
        {:else if ws.dockSize === 'normal'}
          {@render sizeButton('max', 'max')}
          {@render sizeButton('min', 'min')}
        {:else}
          {@render sizeButton('show', 'normal')}
        {/if}
      </div>
    {/if}
  </header>

  {#if open}
    <div class="min-h-0 flex-1 overflow-auto">
      {#if ws.dock === 'history'}
        <HistoryView />
      {:else if ws.dock === 'report'}
        <ReportView />
      {:else if ws.dock === 'log'}
        <LogView />
      {:else if ws.dock === 'backtest'}
        <BacktestView />
      {:else if ws.dock === 'watch'}
        <WatchView />
      {:else if ws.dock === 'signals'}
        <SignalsView />
      {:else if ws.dock === 'lab'}
        <LabView />
      {:else}
        {#key market.key}
          <TradingViewWidget
            widget={market.screener ? 'screener' : 'market-overview'}
            class="h-full min-h-[24rem]"
            config={market.screener
              ? { width: '100%', height: '100%', showToolbar: true, largeChartUrl: appUrl('/'), ...market.screener }
              : {
                  width: '100%',
                  height: '100%',
                  dateRange: '12M',
                  showChart: true,
                  showSymbolLogo: true,
                  largeChartUrl: appUrl('/'),
                  tabs: market.groups.map((g) => ({ title: g.name, symbols: g.symbols.map(([s, d]) => ({ s, d })) })),
                }}
          />
        {/key}
      {/if}
    </div>
  {/if}
</section>
