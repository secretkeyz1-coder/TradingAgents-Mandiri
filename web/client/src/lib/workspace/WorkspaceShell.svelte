<script lang="ts">
  // Arranges the panels and nothing else. On a desktop-sized screen each panel
  // (market list, AI, bottom dock) is docked to its edge, floats as a window
  // over the chart, or waits in the tray, as the layout store says; focus mode
  // hides the frame and gives the chart the whole window. The dock sits under
  // the chart only, so the AI panel keeps the full height. On a medium screen a
  // docked market list is a drawer; on a phone one panel shows at a time with a
  // bottom tab bar. Panels talk only through the workspace store.
  import { onMount } from 'svelte';
  import { agent } from '../stores/agent.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { indicators } from '../stores/indicators.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { layout, PANELS, type PanelId, type Rect } from '../stores/layout.svelte';
  import { PANE_LIMITS, panes } from '../stores/panes.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { ws, type MobileTab } from '../stores/workspace.svelte';
  import AiPanel from './AiPanel.svelte';
  import ChartPanel from './ChartPanel.svelte';
  import Dock from './Dock.svelte';
  import FloatingWindow from './FloatingWindow.svelte';
  import MarketPanel from './MarketPanel.svelte';
  import Rail from './Rail.svelte';
  import Splitter from './Splitter.svelte';

  onMount(() => {
    jobs.start();
    catalog.load();
    layout.adopt();
    indicators.adopt();
  });

  // The agent's chats, drawings and memories follow the symbol in focus.
  $effect(() => {
    if (ws.yahoo) agent.load(ws.yahoo);
  });

  const screen = $derived(layoutOf(viewport));

  // F toggles focus mode and Escape leaves it, unless the key is meant for a field.
  function keys(e: KeyboardEvent) {
    if (screen === 'narrow' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      layout.toggleFocus();
    } else if (e.key === 'Escape' && layout.focus) {
      layout.toggleFocus();
    }
  }

  // Docked pane sizes: what the user dragged (stores/panes), clamped to the room
  // the workspace has right now so a smaller window never squeezes the chart away.
  const SPLIT = 6;
  let outerW = $state(window.innerWidth);
  let outerH = $state(window.innerHeight - 56);
  let boxW = $state(window.innerWidth);
  let boxH = $state(window.innerHeight - 56);
  const L = PANE_LIMITS;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  const docked = (id: PanelId) => layout.effective(id) === 'dock';
  const hasMarket = $derived(screen === 'wide' && docked('market'));
  const hasAi = $derived(docked('ai'));
  const hasDock = $derived(docked('dock'));
  const splitsX = $derived((hasMarket ? SPLIT : 0) + (hasAi ? SPLIT : 0));
  const aiWanted = $derived(panes.sizes.ai ?? (hasMarket ? L.ai.initial : 336));
  const marketWanted = $derived(panes.sizes.market ?? L.market.initial);
  const aiMax = $derived(Math.min(L.ai.max, boxW - splitsX - L.chartWidth - (hasMarket ? Math.min(marketWanted, L.market.max) : 0)));
  const aiW = $derived(clamp(aiWanted, L.ai.min, aiMax));
  const marketMax = $derived(Math.min(L.market.max, boxW - splitsX - L.chartWidth - (hasAi ? aiW : 0)));
  const marketW = $derived(clamp(marketWanted, L.market.min, marketMax));
  const dockMax = $derived(boxH - SPLIT - L.chartHeight);
  const dockH = $derived(clamp(panes.sizes.dock ?? Math.max(192, Math.round(boxH * 0.34)), L.dock.min, dockMax));

  const columns = $derived(
    [hasMarket ? `${marketW}px ${SPLIT}px` : '', 'minmax(0, 1fr)', hasAi ? `${SPLIT}px ${aiW}px` : ''].filter(Boolean).join(' '),
  );
  const rows = $derived(
    !hasDock
      ? 'minmax(0, 1fr)'
      : ws.dockSize === 'max'
        ? '0 1px minmax(0, 1fr)'
        : ws.dockSize === 'min'
          ? 'minmax(0, 1fr) 1px 2.5rem'
          : `minmax(0, 1fr) ${SPLIT}px ${dockH}px`,
  );

  // Where a floating panel goes until the user moves it.
  function defaultRect(id: PanelId): Rect {
    const left = layout.focus ? 12 : 68;
    if (id === 'market') return { x: left, y: 12, w: 300, h: Math.min(560, outerH - 24) };
    if (id === 'ai') return { x: outerW - 400, y: 12, w: 384, h: Math.min(640, outerH - 24) };
    const h = Math.min(360, outerH - 24);
    return { x: left, y: outerH - h - 12, w: Math.min(820, outerW - left - 420), h };
  }
  const TITLES: Record<PanelId, string> = { market: 'Pasar', ai: 'AI', dock: 'Riwayat · Laporan · Log' };
  const floating = $derived(PANELS.filter((p) => layout.effective(p.id) === 'float'));
  const tray = $derived(PANELS.filter((p) => layout.effective(p.id) === 'min'));

  const MOBILE_TABS: { key: MobileTab; label: string }[] = [
    { key: 'market', label: 'Pasar' },
    { key: 'chart', label: 'Chart' },
    { key: 'ai', label: 'AI' },
    { key: 'dock', label: 'Riwayat' },
  ];
  const busy = $derived(!!(ws.run?.live || ws.backtest?.live));
</script>

<svelte:window onkeydown={keys} />

{#if screen === 'narrow'}
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
          class="flex min-h-14 items-center justify-center gap-1.5 text-sm font-medium"
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
  <div class="relative flex min-h-0 flex-1 bg-base-100" data-workspace bind:clientWidth={outerW} bind:clientHeight={outerH}>
    {#if !layout.focus}<Rail medium={screen === 'medium'} />{/if}

    <div class="grid min-h-0 min-w-0 flex-1" style="grid-template-columns: {columns};" bind:clientWidth={boxW} bind:clientHeight={boxH}>
      {#if hasMarket}
        <div class="min-h-0 min-w-0 overflow-hidden border-r border-base-300"><MarketPanel onclose={() => layout.setMode('market', 'min')} /></div>
        <div class="flex min-h-0">
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

      <div class="grid min-h-0 min-w-0" style="grid-template-rows: {rows};">
        <div class="min-h-0 min-w-0 overflow-hidden"><ChartPanel /></div>
        {#if hasDock}
          {#if ws.dockSize === 'normal'}
            <div class="flex min-w-0 flex-col">
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
            <div class="bg-base-300"></div>
          {/if}
          <div class="min-h-0 min-w-0 overflow-hidden"><Dock /></div>
        {/if}
      </div>

      {#if hasAi}
        <div class="flex min-h-0">
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
        <div class="min-h-0 min-w-0 overflow-hidden border-l border-base-300"><AiPanel /></div>
      {/if}
    </div>

    {#if screen === 'medium' && layout.modes.market === 'dock' && !layout.focus && ws.marketDrawer}
      <div class="absolute inset-y-0 left-14 z-20 w-72 border-r border-base-300 shadow-xl">
        <MarketPanel onclose={() => (ws.marketDrawer = false)} />
      </div>
    {/if}

    {#each floating as p (p.id)}
      <FloatingWindow
        title={TITLES[p.id]}
        rect={layout.rects[p.id] ?? defaultRect(p.id)}
        bounds={{ w: outerW, h: outerH }}
        z={layout.order.indexOf(p.id)}
        edge={p.edge}
        onmove={(r) => layout.move(p.id, r)}
        oncommit={() => layout.commit()}
        ondock={() => layout.setMode(p.id, 'dock')}
        onminimize={() => layout.setMode(p.id, 'min')}
        onfront={() => layout.front(p.id)}
      >
        {#if p.id === 'market'}
          <MarketPanel />
        {:else if p.id === 'ai'}
          <AiPanel />
        {:else}
          <Dock collapsible={false} />
        {/if}
      </FloatingWindow>
    {/each}

    {#if layout.focus && tray.length}
      <!-- Above the chart's own bottom bar (navigator, TradingView's range buttons). -->
      <nav class="absolute bottom-16 left-3 z-30 flex gap-1.5" aria-label="Panel yang dikecilkan">
        {#each tray as p (p.id)}
          <button class="btn btn-sm border-base-300 bg-base-100 shadow-md" onclick={() => layout.restore(p.id)}>
            {p.label}
            {#if p.id === 'ai' && busy}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
          </button>
        {/each}
      </nav>
    {/if}
  </div>
{/if}
