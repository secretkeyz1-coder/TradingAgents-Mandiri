<script lang="ts">
  // The left rail: shows or hides each panel, and opens the dock's watchlist
  // and screener. Riwayat, Laporan, Log and Backtest live as tabs in the dock
  // itself, so they are not repeated here.
  import { layout, type PanelId } from '../stores/layout.svelte';
  import { ws, type DockTab } from '../stores/workspace.svelte';

  let { medium = false }: { medium?: boolean } = $props();

  // On a medium screen the docked market list is a drawer over the chart.
  const shown = (id: PanelId) =>
    id === 'market' && medium && layout.modes.market === 'dock' ? ws.marketDrawer : layout.effective(id) !== 'min';

  function panel(id: PanelId) {
    if (id === 'market' && medium && layout.modes.market === 'dock') ws.marketDrawer = !ws.marketDrawer;
    else layout.toggle(id);
  }

  function tab(t: DockTab) {
    if (layout.effective('dock') === 'min') layout.restore('dock');
    ws.setDock(t);
  }

  const busy = $derived(!!(ws.run?.live || ws.backtest?.live));
</script>

<nav class="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-base-300 bg-base-100 py-2" aria-label="Panel">
  <button class="ta-rail" aria-pressed={shown('market')} onclick={() => panel('market')}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
    Pasar
  </button>
  <button class="ta-rail relative" aria-pressed={shown('ai')} onclick={() => panel('ai')}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
    AI
    {#if busy}<span class="status status-xs status-info absolute top-1.5 right-2 motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
  </button>
  <button class="ta-rail" aria-pressed={shown('dock')} onclick={() => panel('dock')}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 14h18" /></svg>
    Bawah
  </button>
  <div class="my-1 h-px w-8 bg-base-300"></div>
  <button class="ta-rail" aria-pressed={ws.dock === 'watch' && shown('dock')} onclick={() => tab('watch')}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
    Pantau
  </button>
  <button class="ta-rail" aria-pressed={ws.dock === 'screener' && shown('dock')} onclick={() => tab('screener')}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
    Screener
  </button>
</nav>
