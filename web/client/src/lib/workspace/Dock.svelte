<script lang="ts">
  // The bottom dock: history, the open analysis's report and log, the open
  // backtest, and the full screener. Each view is its own component.
  import TradingViewWidget from '../TradingViewWidget.svelte';
  import { appUrl } from '../router.svelte';
  import { ws, type DockTab } from '../stores/workspace.svelte';
  import { MARKET_TABS } from '../tv';
  import BacktestView from './dock/BacktestView.svelte';
  import HistoryView from './dock/HistoryView.svelte';
  import LogView from './dock/LogView.svelte';
  import ReportView from './dock/ReportView.svelte';
  import WatchView from './dock/WatchView.svelte';

  /** On a phone the dock is a whole screen and has no size controls. */
  let { collapsible = true }: { collapsible?: boolean } = $props();

  const TABS: { key: DockTab; label: string }[] = [
    { key: 'history', label: 'Riwayat' },
    { key: 'report', label: 'Laporan' },
    { key: 'log', label: 'Log' },
    { key: 'backtest', label: 'Backtest' },
    { key: 'watch', label: 'Pantau' },
    { key: 'screener', label: 'Screener' },
  ];
  const market = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
  const open = $derived(!collapsible || ws.dockSize !== 'min');
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Dock">
  <header class="flex h-10 shrink-0 items-center gap-2 border-b border-base-300 px-2">
    <div role="tablist" class="tabs tabs-border tabs-sm min-w-0 flex-nowrap overflow-x-auto">
      {#each TABS as t (t.key)}
        <button
          role="tab"
          class="tab gap-1.5 whitespace-nowrap"
          class:tab-active={open && ws.dock === t.key}
          onclick={() => ws.setDock(t.key)}
        >
          {t.label}
          {#if t.key === 'log' && ws.run}<span class="tabular-nums text-base-content/70">{ws.run.log.length}</span>{/if}
          {#if (t.key === 'report' && ws.run?.live) || (t.key === 'backtest' && ws.backtest?.live)}
            <span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>
          {/if}
        </button>
      {/each}
    </div>
    {#if collapsible}
      <div class="ml-auto flex shrink-0 gap-1">
        {#if ws.dockSize === 'max'}
          <button class="btn btn-ghost btn-xs" onclick={() => (ws.dockSize = 'normal')}>Normal</button>
        {:else if ws.dockSize === 'normal'}
          <button class="btn btn-ghost btn-xs" onclick={() => (ws.dockSize = 'max')}>Perbesar</button>
          <button class="btn btn-ghost btn-xs" onclick={() => (ws.dockSize = 'min')}>Sembunyikan</button>
        {:else}
          <button class="btn btn-ghost btn-xs" onclick={() => (ws.dockSize = 'normal')}>Tampilkan</button>
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
