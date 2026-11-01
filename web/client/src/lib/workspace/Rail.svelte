<script lang="ts">
  // The left rail: the workspace's four destinations (stores/workspace DESTINATIONS), named for
  // the work done there. A click opens the destination's side panel, if it has one, and the
  // bottom panel on its tabs. The rail never hides anything, so exactly one destination is
  // current: the one the bottom panel belongs to. Panels close from their own header or the
  // Tata letak menu.
  import { layout, type PanelId } from '../stores/layout.svelte';
  import { AI_MODES, DESTINATIONS, destinationOf, MARKET_LIST_LABEL, ws, type Destination } from '../stores/workspace.svelte';
  import { DESTINATION_ICONS } from './icons';

  let { medium = false }: { medium?: boolean } = $props();

  /** Bring a panel into view: a hidden one comes back where it was, a floating one to the front. */
  function reveal(id: PanelId) {
    // On a medium screen the docked market list is a drawer over the chart.
    if (id === 'market' && medium && layout.modes.market === 'dock') ws.marketDrawer = true;
    else if (layout.effective(id) === 'min') layout.restore(id);
    else if (layout.effective(id) === 'float') layout.front(id);
  }

  function go(d: (typeof DESTINATIONS)[number]) {
    if (d.panel) reveal(d.panel);
    reveal('dock');
    ws.openDestination(d.key);
  }

  const current = $derived(destinationOf(ws.dock).key);
  const SIDE: Record<Destination, string[]> = { pasar: [MARKET_LIST_LABEL], riset: AI_MODES.map((m) => m.label), pantau: [], uji: [] };
</script>

<nav class="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-base-300 bg-base-100 py-2" aria-label="Menu ruang kerja">
  {#each DESTINATIONS as d (d.key)}
    <button
      class="ta-rail"
      aria-current={current === d.key ? 'true' : undefined}
      title="{d.label}: {[...SIDE[d.key], ...d.tabs.map((t) => t.label)].join(', ')}"
      onclick={() => go(d)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={DESTINATION_ICONS[d.key]} /></svg>
      {d.label}
      {#if d.tabs.some((t) => ws.live(t.key))}<span class="status status-xs status-info absolute top-1.5 right-1.5 motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
    </button>
  {/each}
</nav>
