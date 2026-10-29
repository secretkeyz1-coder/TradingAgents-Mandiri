<script lang="ts">
  // Arranges the panels and nothing else: three columns + dock on a wide
  // screen, chart + AI with the market list as a drawer on a medium one, one
  // panel at a time with a bottom tab bar on a phone. Panels talk only through
  // the workspace store, so the layout can change without touching them.
  import { onMount } from 'svelte';
  import { agent } from '../stores/agent.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { ws, type MobileTab } from '../stores/workspace.svelte';
  import AiPanel from './AiPanel.svelte';
  import ChartPanel from './ChartPanel.svelte';
  import Dock from './Dock.svelte';
  import MarketPanel from './MarketPanel.svelte';

  onMount(() => {
    jobs.start();
    catalog.load();
  });

  // The agent's chats, drawings and memories follow the symbol in focus.
  $effect(() => {
    if (ws.yahoo) agent.load(ws.yahoo);
  });

  const layout = $derived(layoutOf(viewport));
  const columns = $derived(layout === 'wide' ? '17rem minmax(0, 1fr) 22rem' : 'minmax(0, 1fr) 21rem');
  const rows = $derived(
    ws.dockSize === 'max'
      ? '0 minmax(0, 1fr)'
      : ws.dockSize === 'min'
        ? 'minmax(0, 1fr) 2.5rem'
        : 'minmax(0, 1fr) minmax(12rem, 38%)',
  );

  const MOBILE_TABS: { key: MobileTab; label: string }[] = [
    { key: 'market', label: 'Pasar' },
    { key: 'chart', label: 'Chart' },
    { key: 'ai', label: 'AI' },
    { key: 'dock', label: 'Riwayat' },
  ];
  const busy = $derived(!!(ws.run?.live || ws.backtest?.live));
</script>

{#if layout === 'narrow'}
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1">
      {#if ws.mobileTab === 'market'}
        <MarketPanel />
      {:else if ws.mobileTab === 'chart'}
        <ChartPanel />
      {:else if ws.mobileTab === 'ai'}
        <AiPanel />
      {:else}
        <Dock collapsible={false} />
      {/if}
    </div>
    <nav class="grid shrink-0 grid-cols-4 border-t border-base-300 bg-base-100" aria-label="Panel">
      {#each MOBILE_TABS as t (t.key)}
        <button
          class="flex items-center justify-center gap-1.5 py-3 text-sm font-medium"
          class:text-accent={ws.mobileTab === t.key}
          class:text-base-content={ws.mobileTab !== t.key}
          aria-current={ws.mobileTab === t.key ? 'page' : undefined}
          onclick={() => (ws.mobileTab = t.key)}
        >
          {t.label}
          {#if t.key === 'ai' && busy}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
        </button>
      {/each}
    </nav>
  </div>
{:else}
  <div class="relative grid min-h-0 flex-1 gap-px bg-base-300" style="grid-template-columns: {columns}; grid-template-rows: {rows};">
    {#if layout === 'wide'}
      <div class="min-h-0 min-w-0 overflow-hidden"><MarketPanel /></div>
    {/if}
    <div class="min-h-0 min-w-0 overflow-hidden">
      <ChartPanel onmarket={layout === 'medium' ? () => (ws.marketDrawer = !ws.marketDrawer) : undefined} />
    </div>
    <div class="min-h-0 min-w-0 overflow-hidden"><AiPanel /></div>
    <div class="min-h-0 min-w-0 overflow-hidden" style="grid-column: 1 / -1;"><Dock /></div>

    {#if layout === 'medium' && ws.marketDrawer}
      <div class="absolute inset-y-0 left-0 z-20 w-72 border-r border-base-300">
        <MarketPanel onclose={() => (ws.marketDrawer = false)} />
      </div>
    {/if}
  </div>
{/if}
