<script lang="ts">
  // A chart screen on a phone (Pasar or Riset AI), one thing at a time. Pasar starts at its market
  // board, the screener as a second tab; an asset opens its chart behind a back button. Riset AI
  // starts at its list of assets and the preview of the one picked (ResearchStart, ADR 0019); once
  // research starts, the asset switch heads a row of tabs, the chart first, then the AI panel's and
  // the bottom panel's: Chart · Tanya · Analisa · Riwayat · Laporan · Log.
  // ws.phonePane says which one shows, so leaving the screen and coming back finds it as it was.
  import { AI_MODES, MARKET_LIST_LABEL, SCREENS, ws, type ChartScreen } from '../stores/workspace.svelte';
  import AiPanel from './AiPanel.svelte';
  import ResearchStart from './ResearchStart.svelte';
  import AssetSwitcher from './AssetSwitcher.svelte';
  import ChartPanel from './ChartPanel.svelte';
  import MarketBoard from './MarketBoard.svelte';
  import TabView from './TabView.svelte';

  let { screen }: { screen: ChartScreen } = $props();

  const s = $derived(SCREENS.find((x) => x.key === screen) ?? SCREENS[1]);
  const pane = $derived(ws.phonePane[screen]);
  /** Pasar's market board or Riset AI's asset picker, before an asset is open. */
  const start = $derived(!ws.open[screen]);
</script>

{#if screen === 'riset' && start}
  <ResearchStart />
{:else}
  <section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label={s.label}>
    {#if screen === 'riset'}
      <div class="shrink-0 border-b border-base-300 px-2 py-1.5"><AssetSwitcher chips={2} /></div>
    {/if}
    <div class="flex shrink-0 items-center border-b border-base-300">
      {#if screen === 'pasar' && !start}
        <button class="btn btn-ghost btn-sm shrink-0 gap-0.5 px-2" aria-label="Kembali ke daftar pasar" onclick={() => ws.closeChart()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Daftar
        </button>
      {/if}
      <div role="tablist" class="tabs tabs-border tabs-sm min-w-0 flex-1 flex-nowrap overflow-x-auto px-1" aria-label={s.label}>
        {#if screen === 'pasar' && start}
          <button role="tab" class="tab whitespace-nowrap" class:tab-active={pane !== 'dock'} aria-selected={pane !== 'dock'} onclick={() => ws.setPhonePane('pasar', 'side')}>
            {MARKET_LIST_LABEL}
          </button>
        {:else}
          <button role="tab" class="tab whitespace-nowrap" class:tab-active={pane === 'chart'} aria-selected={pane === 'chart'} onclick={() => ws.setPhonePane(screen, 'chart')}>Chart</button>
          {#if screen === 'riset'}
            {#each AI_MODES as m (m.key)}
              {@const on = pane === 'side' && ws.aiMode === m.key}
              <button role="tab" class="tab whitespace-nowrap" class:tab-active={on} aria-selected={on} onclick={() => ws.setAiMode(m.key)}>{m.label}</button>
            {/each}
          {/if}
        {/if}
        {#each s.tabs as t (t.key)}
          {@const on = pane === 'dock' && ws.dock === t.key}
          <button role="tab" class="tab gap-1.5 whitespace-nowrap" class:tab-active={on} aria-selected={on} onclick={() => ws.setDock(t.key)}>
            {t.label}
            {#if t.key === 'log' && ws.run}<span class="tabular-nums text-base-content/70">{ws.run.log.length}</span>{/if}
            {#if ws.live(t.key)}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
          </button>
        {/each}
      </div>
    </div>
    <div class="min-h-0 flex-1">
      {#if pane === 'dock'}
        <div class="relative h-full overflow-auto"><TabView tab={ws.dock} /></div>
      {:else if screen === 'pasar' && start}
        <MarketBoard />
      {:else if pane === 'side' && screen === 'riset'}
        <AiPanel bare />
      {:else}
        <ChartPanel />
      {/if}
    </div>
  </section>
{/if}
