<script lang="ts">
  // Arranges the open screen (stores/workspace SCREENS) and nothing else; the top bar
  // (AppShell) or a phone's tab bar picks it. Beranda is the member's dashboard, Pantau and
  // Uji strategi are pages of tabs. Pasar and Riset AI are chart screens: each of their panels
  // (the market list on Pasar, Riset AI's panel, the bottom panel) is docked to its edge,
  // floats as a window over the chart, or waits in the tray, as the layout store says, and
  // focus mode gives the chart the whole window. On a phone each screen is one column behind
  // a bottom tab bar. Panels talk only through the workspace store.
  import { onMount } from 'svelte';
  import { agent } from '../stores/agent.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { indicators } from '../stores/indicators.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { layout, PANELS, type PanelId, type Rect } from '../stores/layout.svelte';
  import { PANE_LIMITS, panes } from '../stores/panes.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { isChartScreen, SCREENS, ws, type Screen } from '../stores/workspace.svelte';
  import AiPanel from './AiPanel.svelte';
  import ChartPanel from './ChartPanel.svelte';
  import DashboardScreen from './DashboardScreen.svelte';
  import Dock from './Dock.svelte';
  import FloatingWindow from './FloatingWindow.svelte';
  import { SCREEN_ICONS } from './icons';
  import MarketPanel from './MarketPanel.svelte';
  import PageScreen from './PageScreen.svelte';
  import PhoneScreen from './PhoneScreen.svelte';
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

  const narrow = $derived(layoutOf(viewport) === 'narrow');
  const chartScreen = $derived(isChartScreen(ws.screen));

  // On a chart screen F toggles focus mode and Escape leaves it, unless the key is meant for a field.
  function keys(e: KeyboardEvent) {
    if (narrow || !chartScreen || e.ctrlKey || e.metaKey || e.altKey) return;
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
  // the screen has right now so a smaller window never squeezes the chart away.
  const SPLIT = 6;
  let outerW = $state(window.innerWidth);
  let outerH = $state(window.innerHeight - 56);
  let boxW = $state(window.innerWidth);
  let boxH = $state(window.innerHeight - 56);
  const L = PANE_LIMITS;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  /** The panels a chart screen has: the market list on Pasar, Riset AI's panel on Riset AI, the bottom panel on both. */
  const here = (id: PanelId) => id === 'dock' || (id === 'market' ? ws.screen === 'pasar' : ws.screen === 'riset');
  const docked = (id: PanelId) => here(id) && layout.effective(id) === 'dock';
  const hasMarket = $derived(docked('market'));
  const hasAi = $derived(docked('ai'));
  const hasDock = $derived(docked('dock'));
  const splitsX = $derived((hasMarket ? SPLIT : 0) + (hasAi ? SPLIT : 0));
  const aiWanted = $derived(panes.sizes.ai ?? 336);
  const marketWanted = $derived(panes.sizes.market ?? L.market.initial);
  const aiMax = $derived(Math.min(L.ai.max, boxW - splitsX - L.chartWidth));
  const aiW = $derived(clamp(aiWanted, L.ai.min, aiMax));
  const marketMax = $derived(Math.min(L.market.max, boxW - splitsX - L.chartWidth));
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
          ? 'minmax(0, 1fr) 1px auto'
          : `minmax(0, 1fr) ${SPLIT}px ${dockH}px`,
  );

  // Where a floating panel goes until the user moves it.
  function defaultRect(id: PanelId): Rect {
    const left = 12;
    if (id === 'market') return { x: left, y: 12, w: 340, h: Math.min(560, outerH - 24) };
    if (id === 'ai') return { x: outerW - 400, y: 12, w: 384, h: Math.min(640, outerH - 24) };
    const h = Math.min(360, outerH - 24);
    return { x: left, y: outerH - h - 12, w: Math.min(820, outerW - left - 420), h };
  }
  const floating = $derived(PANELS.filter((p) => here(p.id) && layout.effective(p.id) === 'float'));
  const tray = $derived(PANELS.filter((p) => here(p.id) && layout.effective(p.id) === 'min'));
  /** A tray button pulses while its panel's job runs: an analysis for Riset AI, a backtest for the bottom panel. */
  const trayBusy = (id: PanelId) => (id === 'ai' && !!ws.run?.live) || (id === 'dock' && !!ws.backtest?.live);
  /** A screen whose job is still running (an analysis on Riset AI, a backtest on Uji strategi). */
  const busy = (key: Screen) => SCREENS.some((s) => s.key === key && s.tabs.some((t) => ws.live(t.key)));
</script>

<svelte:window onkeydown={keys} />

{#if narrow}
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1">
      {#if ws.screen === 'beranda'}
        <DashboardScreen />
      {:else if ws.screen === 'pantau' || ws.screen === 'uji'}
        <PageScreen screen={ws.screen} />
      {:else}
        <PhoneScreen screen={ws.screen} />
      {/if}
    </div>
    <nav class="grid shrink-0 grid-cols-5 border-t border-base-300 bg-base-100" aria-label="Menu utama">
      {#each SCREENS as s (s.key)}
        <button class="ta-tab" aria-current={ws.screen === s.key ? 'page' : undefined} onclick={() => ws.go(s.key)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={SCREEN_ICONS[s.key]} /></svg>
          {s.label}
          {#if busy(s.key)}<span class="status status-xs status-info absolute top-1.5 left-[calc(50%+0.75rem)] motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
        </button>
      {/each}
    </nav>
  </div>
{:else if ws.screen === 'beranda'}
  <div class="min-h-0 flex-1"><DashboardScreen /></div>
{:else if ws.screen === 'pantau' || ws.screen === 'uji'}
  <div class="min-h-0 flex-1"><PageScreen screen={ws.screen} /></div>
{:else}
  <div class="relative flex min-h-0 flex-1 bg-base-100" data-workspace bind:clientWidth={outerW} bind:clientHeight={outerH}>
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
          <div class="min-h-0 min-w-0 overflow-hidden"><Dock onclose={() => layout.setMode('dock', 'min')} /></div>
        {/if}
      </div>

      {#if hasAi}
        <div class="flex min-h-0">
          <Splitter
            axis="x"
            invert
            label="Lebar panel Riset AI"
            value={aiW}
            min={L.ai.min}
            max={Math.max(L.ai.min, aiMax)}
            onchange={(px) => panes.set('ai', px)}
            onend={() => panes.save()}
            onreset={() => (panes.set('ai', null), panes.save())}
          />
        </div>
        <div class="min-h-0 min-w-0 overflow-hidden border-l border-base-300"><AiPanel onclose={() => layout.setMode('ai', 'min')} /></div>
      {/if}
    </div>

    {#each floating as p (p.id)}
      <FloatingWindow
        title={p.label}
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

    {#if tray.length}
      <!-- A closed panel waits here to come back, above the chart's own bottom bar (navigator, TradingView's range buttons). -->
      <nav class="absolute bottom-16 left-3 z-30 flex gap-1.5" aria-label="Panel yang dikecilkan">
        {#each tray as p (p.id)}
          <button class="btn btn-sm border-base-300 bg-base-100 shadow-md" onclick={() => layout.restore(p.id)}>
            {p.label}
            {#if trayBusy(p.id)}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
          </button>
        {/each}
      </nav>
    {/if}
  </div>
{/if}
