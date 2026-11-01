<script lang="ts">
  // A phone shows one destination at a time (stores/workspace DESTINATIONS) as a single screen:
  // one row of tabs over what a desktop splits between a side panel and the bottom panel, so
  // Riset AI reads Tanya · Jalankan · Riwayat · Laporan · Log. The panels render without their
  // own headers; which half shows is ws.phonePane, so leaving and coming back finds it as it was.
  import { AI_MODES, DESTINATIONS, MARKET_LIST_LABEL, ws, type Destination } from '../stores/workspace.svelte';
  import AiPanel from './AiPanel.svelte';
  import Dock from './Dock.svelte';
  import MarketPanel from './MarketPanel.svelte';

  let { destination }: { destination: Destination } = $props();

  const d = $derived(DESTINATIONS.find((x) => x.key === destination) ?? DESTINATIONS[0]);
  const side = $derived(d.panel !== null && ws.phonePane[d.key] === 'side');
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label={d.label}>
  <div role="tablist" class="tabs tabs-border tabs-sm shrink-0 flex-nowrap overflow-x-auto border-b border-base-300 px-1" aria-label={d.label}>
    {#if d.panel === 'market'}
      <button role="tab" class="tab whitespace-nowrap" class:tab-active={side} aria-selected={side} onclick={() => (ws.phonePane.pasar = 'side')}>
        {MARKET_LIST_LABEL}
      </button>
    {:else if d.panel === 'ai'}
      {#each AI_MODES as m (m.key)}
        {@const on = side && ws.aiMode === m.key}
        <button role="tab" class="tab whitespace-nowrap" class:tab-active={on} aria-selected={on} onclick={() => ws.setAiMode(m.key)}>{m.label}</button>
      {/each}
    {/if}
    {#each d.tabs as t (t.key)}
      {@const on = !side && ws.dock === t.key}
      <button role="tab" class="tab gap-1.5 whitespace-nowrap" class:tab-active={on} aria-selected={on} onclick={() => ws.setDock(t.key)}>
        {t.label}
        {#if t.key === 'log' && ws.run}<span class="tabular-nums text-base-content/70">{ws.run.log.length}</span>{/if}
        {#if ws.live(t.key)}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
      </button>
    {/each}
  </div>
  <div class="min-h-0 flex-1">
    {#if side && d.panel === 'market'}
      <MarketPanel bare />
    {:else if side}
      <AiPanel bare />
    {:else}
      <Dock bare />
    {/if}
  </div>
</section>
