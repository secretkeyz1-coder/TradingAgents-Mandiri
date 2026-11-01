<script lang="ts">
  // Pantau and Uji strategi: a page of tabs (stores/workspace SCREENS), the same on a desktop
  // and a phone. Pantau holds only what the member watches (their scheduled analyses and
  // alerts); Uji strategi their backtests and lab runs, with the built-in strategies' live record.
  import { SCREENS, ws } from '../stores/workspace.svelte';
  import TabView from './TabView.svelte';

  let { screen }: { screen: 'pantau' | 'uji' } = $props();

  const s = $derived(SCREENS.find((x) => x.key === screen) ?? SCREENS[3]);
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-labelledby="page-title">
  <h1 id="page-title" class="sr-only">{s.label}</h1>
  <div role="tablist" class="tabs tabs-border shrink-0 flex-nowrap overflow-x-auto border-b border-base-300 px-2 sm:px-4" aria-label={s.label}>
    {#each s.tabs as t (t.key)}
      <button role="tab" class="tab gap-1.5 whitespace-nowrap" class:tab-active={ws.dock === t.key} aria-selected={ws.dock === t.key} onclick={() => ws.setDock(t.key)}>
        {t.label}
        {#if ws.live(t.key)}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
      </button>
    {/each}
  </div>
  <div class="min-h-0 flex-1 overflow-auto">
    <div class="mx-auto w-full max-w-6xl"><TabView tab={ws.dock} /></div>
  </div>
</section>
