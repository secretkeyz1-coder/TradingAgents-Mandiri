<script lang="ts">
  // A chart screen on a phone (Pasar or Riset AI): one row of tabs over one thing at a time,
  // the chart first, then the side panel's tabs and the bottom panel's, so Riset AI reads
  // Chart · Tanya · Jalankan · Riwayat · Laporan · Log. ws.phonePane says which one shows, so
  // leaving the screen and coming back finds it as it was.
  import { AI_MODES, MARKET_LIST_LABEL, SCREENS, ws, type ChartScreen } from '../stores/workspace.svelte';
  import AiPanel from './AiPanel.svelte';
  import ChartPanel from './ChartPanel.svelte';
  import MarketPanel from './MarketPanel.svelte';
  import TabView from './TabView.svelte';

  let { screen }: { screen: ChartScreen } = $props();

  const s = $derived(SCREENS.find((x) => x.key === screen) ?? SCREENS[1]);
  const pane = $derived(ws.phonePane[screen]);
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label={s.label}>
  <div role="tablist" class="tabs tabs-border tabs-sm shrink-0 flex-nowrap overflow-x-auto border-b border-base-300 px-1" aria-label={s.label}>
    <button role="tab" class="tab whitespace-nowrap" class:tab-active={pane === 'chart'} aria-selected={pane === 'chart'} onclick={() => ws.setPhonePane(screen, 'chart')}>Chart</button>
    {#if screen === 'pasar'}
      <button role="tab" class="tab whitespace-nowrap" class:tab-active={pane === 'side'} aria-selected={pane === 'side'} onclick={() => ws.setPhonePane('pasar', 'side')}>
        {MARKET_LIST_LABEL}
      </button>
    {:else}
      {#each AI_MODES as m (m.key)}
        {@const on = pane === 'side' && ws.aiMode === m.key}
        <button role="tab" class="tab whitespace-nowrap" class:tab-active={on} aria-selected={on} onclick={() => ws.setAiMode(m.key)}>{m.label}</button>
      {/each}
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
  <div class="min-h-0 flex-1">
    {#if pane === 'chart'}
      <ChartPanel />
    {:else if pane === 'side' && screen === 'pasar'}
      <MarketPanel bare />
    {:else if pane === 'side'}
      <AiPanel bare />
    {:else}
      <div class="h-full overflow-auto"><TabView tab={ws.dock} /></div>
    {/if}
  </div>
</section>
