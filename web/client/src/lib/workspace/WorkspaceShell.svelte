<script lang="ts">
  // Arranges the panels and nothing else: three columns + dock on a wide
  // screen, chart + AI with the market list as a drawer on a medium one, one
  // panel at a time with a bottom tab bar on a phone. Panels talk only through
  // the workspace store, so the layout can change without touching them. On
  // wide and medium screens the lines between panes can be dragged.
  import { onMount } from 'svelte';
  import { agent } from '../stores/agent.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { PANE_LIMITS, panes } from '../stores/panes.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { ws, type MobileTab } from '../stores/workspace.svelte';
  import AiPanel from './AiPanel.svelte';
  import ChartPanel from './ChartPanel.svelte';
  import Dock from './Dock.svelte';
  import MarketPanel from './MarketPanel.svelte';
  import Splitter from './Splitter.svelte';

  onMount(() => {
    jobs.start();
    catalog.load();
  });

  // The agent's chats, drawings and memories follow the symbol in focus.
  $effect(() => {
    if (ws.yahoo) agent.load(ws.yahoo);
  });

  const layout = $derived(layoutOf(viewport));

  // Pane sizes: what the user dragged (stores/panes), clamped to the room the
  // workspace has right now so a smaller window never squeezes the chart away.
  const SPLIT = 6;
  let boxW = $state(window.innerWidth);
  let boxH = $state(window.innerHeight - 56);
  const L = PANE_LIMITS;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const hasMarket = $derived(layout === 'wide');
  const splitsX = $derived(hasMarket ? 2 * SPLIT : SPLIT);
  const aiWanted = $derived(panes.sizes.ai ?? (hasMarket ? L.ai.initial : 336));
  const marketWanted = $derived(panes.sizes.market ?? L.market.initial);
  const aiMax = $derived(Math.min(L.ai.max, boxW - splitsX - L.chartWidth - (hasMarket ? Math.min(marketWanted, L.market.max) : 0)));
  const aiW = $derived(clamp(aiWanted, L.ai.min, aiMax));
  const marketMax = $derived(Math.min(L.market.max, boxW - splitsX - L.chartWidth - aiW));
  const marketW = $derived(clamp(marketWanted, L.market.min, marketMax));
  const dockMax = $derived(boxH - SPLIT - L.chartHeight);
  const dockH = $derived(clamp(panes.sizes.dock ?? Math.max(192, Math.round(boxH * 0.38)), L.dock.min, dockMax));

  const columns = $derived(hasMarket ? `${marketW}px ${SPLIT}px minmax(0, 1fr) ${SPLIT}px ${aiW}px` : `minmax(0, 1fr) ${SPLIT}px ${aiW}px`);
  const rows = $derived(
    ws.dockSize === 'max'
      ? '0 1px minmax(0, 1fr)'
      : ws.dockSize === 'min'
        ? 'minmax(0, 1fr) 1px 2.5rem'
        : `minmax(0, 1fr) ${SPLIT}px ${dockH}px`,
  );
  const chartCol = $derived(hasMarket ? 3 : 1);

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
  <div
    class="relative grid min-h-0 flex-1 bg-base-100"
    style="grid-template-columns: {columns}; grid-template-rows: {rows};"
    bind:clientWidth={boxW}
    bind:clientHeight={boxH}
  >
    {#if hasMarket}
      <div class="min-h-0 min-w-0 overflow-hidden" style="grid-area: 1 / 1;"><MarketPanel /></div>
      <div style="grid-area: 1 / 2;" class="flex min-h-0">
        <Splitter
          axis="x"
          label="Lebar panel Pasar"
          value={marketW}
          min={L.market.min}
          max={Math.max(L.market.min, marketMax)}
          onchange={(px) => panes.set('market', px)}
          onend={() => panes.save()}
          onreset={() => (panes.set('market', null), panes.save())}
        />
      </div>
    {/if}
    <div class="min-h-0 min-w-0 overflow-hidden" style="grid-area: 1 / {chartCol};">
      <ChartPanel onmarket={layout === 'medium' ? () => (ws.marketDrawer = !ws.marketDrawer) : undefined} />
    </div>
    <div style="grid-area: 1 / {chartCol + 1};" class="flex min-h-0">
      <Splitter
        axis="x"
        invert
        label="Lebar panel AI"
        value={aiW}
        min={L.ai.min}
        max={Math.max(L.ai.min, aiMax)}
        onchange={(px) => panes.set('ai', px)}
        onend={() => panes.save()}
        onreset={() => (panes.set('ai', null), panes.save())}
      />
    </div>
    <div class="min-h-0 min-w-0 overflow-hidden" style="grid-area: 1 / {chartCol + 2};"><AiPanel /></div>

    {#if ws.dockSize === 'normal'}
      <div style="grid-area: 2 / 1 / 3 / -1;" class="flex min-w-0 flex-col">
        <Splitter
          axis="y"
          invert
          label="Tinggi panel bawah"
          value={dockH}
          min={L.dock.min}
          max={Math.max(L.dock.min, dockMax)}
          onchange={(px) => panes.set('dock', px)}
          onend={() => panes.save()}
          onreset={() => (panes.set('dock', null), panes.save())}
        />
      </div>
    {:else}
      <div style="grid-area: 2 / 1 / 3 / -1;" class="bg-base-300"></div>
    {/if}
    <div class="min-h-0 min-w-0 overflow-hidden" style="grid-area: 3 / 1 / 4 / -1;"><Dock /></div>

    {#if layout === 'medium' && ws.marketDrawer}
      <div class="absolute inset-y-0 left-0 z-20 w-72 border-r border-base-300">
        <MarketPanel onclose={() => (ws.marketDrawer = false)} />
      </div>
    {/if}
  </div>
{/if}
