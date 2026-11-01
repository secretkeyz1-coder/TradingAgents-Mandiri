<script lang="ts">
  // The left rail: shows or hides the market list and the AI panel, and opens the
  // dock on one of its groups (Analisa, Pantau, Strategi). The active group pressed
  // again hides the dock, as the panel buttons do.
  import { layout, type PanelId } from '../stores/layout.svelte';
  import { DOCK_GROUPS, groupOf, ws, type DockGroup } from '../stores/workspace.svelte';

  let { medium = false }: { medium?: boolean } = $props();

  // On a medium screen the docked market list is a drawer over the chart.
  const shown = (id: PanelId) =>
    id === 'market' && medium && layout.modes.market === 'dock' ? ws.marketDrawer : layout.effective(id) !== 'min';

  function panel(id: PanelId) {
    if (id === 'market' && medium && layout.modes.market === 'dock') ws.marketDrawer = !ws.marketDrawer;
    else layout.toggle(id);
  }

  const ICONS: Record<DockGroup, string> = {
    analisa: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
    pantau: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
    strategi: 'M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3M7.5 15h9',
  };
  // A docked dock folded down to its tab row counts as closed; a floating one never folds.
  const dockOpen = () => shown('dock') && (layout.effective('dock') !== 'dock' || ws.dockSize !== 'min');
  const onGroup = (key: DockGroup) => dockOpen() && groupOf(ws.dock).key === key;

  function group(key: DockGroup) {
    if (onGroup(key)) return layout.toggle('dock');
    if (layout.effective('dock') === 'min') layout.restore('dock');
    ws.openGroup(key);
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
  <div class="my-1 h-px w-8 bg-base-300"></div>
  {#each DOCK_GROUPS as g (g.key)}
    <button class="ta-rail" aria-pressed={onGroup(g.key)} title="{g.label}: {g.tabs.map((t) => t.label).join(', ')}" onclick={() => group(g.key)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[g.key]} /></svg>
      {g.label}
    </button>
  {/each}
</nav>
