<script lang="ts">
  // The bottom panel ("Panel bawah"): the tabs of one destination (stores/workspace
  // DESTINATIONS). Pasar has the screener; Riset AI the history and the open analysis's report
  // and log; Pantau & alert the scheduled analyses, the signal ledger and every alert; Uji
  // strategi the backtests and the strategy lab. The rail picks the destination; in focus
  // mode, where the rail is hidden, the header does. Each view is its own component.
  import TradingViewWidget from '../TradingViewWidget.svelte';
  import { appUrl } from '../router.svelte';
  import { layout } from '../stores/layout.svelte';
  import { DESTINATIONS, destinationOf, ws, type Destination } from '../stores/workspace.svelte';
  import { MARKET_TABS } from '../tv';
  import AlertsView from './dock/AlertsView.svelte';
  import BacktestView from './dock/BacktestView.svelte';
  import HistoryView from './dock/HistoryView.svelte';
  import LabView from './dock/LabView.svelte';
  import LogView from './dock/LogView.svelte';
  import ReportView from './dock/ReportView.svelte';
  import SignalsView from './dock/SignalsView.svelte';
  import WatchView from './dock/WatchView.svelte';
  import PanelClose from './PanelClose.svelte';

  let {
    collapsible = true,
    bare = false,
    onclose,
  }: {
    /** A floating window sizes itself, so it has no size controls. */
    collapsible?: boolean;
    /** On a phone the panel is part of a destination's screen, whose tab row is the header (PhoneScreen). */
    bare?: boolean;
    onclose?: () => void;
  } = $props();

  const market = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
  const open = $derived(bare || !collapsible || ws.dockSize !== 'min');
  const dest = $derived(destinationOf(ws.dock));

  const SIZE = {
    max: { label: 'Perbesar panel', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
    normal: { label: 'Ukuran normal', icon: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' },
    min: { label: 'Ciutkan panel', icon: 'm6 9 6 6 6-6' },
    show: { label: 'Tampilkan isi panel', icon: 'm18 15-6-6-6 6' },
  };
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Panel bawah">
  {#snippet sizeButton(kind: keyof typeof SIZE, next: 'min' | 'normal' | 'max')}
    <button class="btn btn-ghost btn-xs btn-square" title={SIZE[kind].label} aria-label={SIZE[kind].label} onclick={() => (ws.dockSize = next)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={SIZE[kind].icon} /></svg>
    </button>
  {/snippet}

  {#if !bare}
    <header class="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-300 px-2 py-1">
      {#if layout.focus}
        <select
          class="select select-sm w-auto shrink-0 font-semibold"
          aria-label="Isi panel bawah"
          value={dest.key}
          onchange={(e) => ws.openDestination(e.currentTarget.value as Destination)}
        >
          {#each DESTINATIONS as d (d.key)}<option value={d.key}>{d.label}</option>{/each}
        </select>
      {:else}
        <h2 class="shrink-0 px-1 text-sm font-semibold whitespace-nowrap">{dest.label}</h2>
      {/if}
      <div role="tablist" class="tabs tabs-box tabs-xs min-w-0 flex-nowrap overflow-x-auto" aria-label={dest.label}>
        {#each dest.tabs as t (t.key)}
          <button role="tab" class="tab gap-1.5 whitespace-nowrap" class:tab-active={open && ws.dock === t.key} aria-selected={open && ws.dock === t.key} onclick={() => ws.setDock(t.key)}>
            {t.label}
            {#if t.key === 'log' && ws.run}<span class="tabular-nums text-base-content/70">{ws.run.log.length}</span>{/if}
            {#if ws.live(t.key)}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
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
          {#if onclose}<PanelClose label="Tutup panel bawah" onclick={onclose} />{/if}
        </div>
      {/if}
    </header>
  {/if}

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
      {:else if ws.dock === 'alerts'}
        <AlertsView />
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
