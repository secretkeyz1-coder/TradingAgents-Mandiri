<script lang="ts">
  // One tab's content, wherever it shows: the bottom panel of a chart screen, a page of Pantau
  // or Uji strategi, or a phone's screen (stores/workspace SCREENS). Each view is its own
  // component; the screener is TradingView's widget for the market picked on Pasar.
  import TradingViewWidget from '../TradingViewWidget.svelte';
  import { appUrl } from '../router.svelte';
  import { ws, type DockTab } from '../stores/workspace.svelte';
  import { MARKET_TABS } from '../tv';
  import AlertsView from './dock/AlertsView.svelte';
  import BacktestView from './dock/BacktestView.svelte';
  import HistoryView from './dock/HistoryView.svelte';
  import LabView from './dock/LabView.svelte';
  import LogView from './dock/LogView.svelte';
  import ReportView from './dock/ReportView.svelte';
  import SignalsView from './dock/SignalsView.svelte';
  import WatchView from './dock/WatchView.svelte';

  let { tab }: { tab: DockTab } = $props();

  const market = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
</script>

{#if tab === 'history'}
  <HistoryView />
{:else if tab === 'report'}
  <ReportView />
{:else if tab === 'log'}
  <LogView />
{:else if tab === 'backtest'}
  <BacktestView />
{:else if tab === 'lab'}
  <LabView />
{:else if tab === 'signals'}
  <SignalsView />
{:else if tab === 'watch'}
  <WatchView />
{:else if tab === 'alerts'}
  <AlertsView />
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
