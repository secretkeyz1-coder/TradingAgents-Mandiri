<script lang="ts">
  // The bottom panel of a chart screen ("Panel bawah"): Pasar's screener, or Riset AI's
  // history, report and log (stores/workspace SCREENS). Docked, it can be made bigger, folded
  // to its header, or closed (the Tata letak menu brings it back); a floating window sizes
  // itself instead.
  import { SCREENS, ws } from '../stores/workspace.svelte';
  import PanelClose from './PanelClose.svelte';
  import TabView from './TabView.svelte';

  let {
    collapsible = true,
    onclose,
  }: {
    /** A floating window sizes itself, so it has no size controls. */
    collapsible?: boolean;
    onclose?: () => void;
  } = $props();

  const open = $derived(!collapsible || ws.dockSize !== 'min');
  const tabs = $derived(SCREENS.find((s) => s.key === ws.screen)?.tabs ?? []);

  const SIZE = {
    max: { label: 'Perbesar panel', icon: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
    normal: { label: 'Ukuran normal', icon: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' },
    min: { label: 'Ciutkan panel', icon: 'm6 9 6 6 6-6' },
    show: { label: 'Tampilkan isi panel', icon: 'm18 15-6-6-6 6' },
  };
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Panel bawah">
  {#snippet sizeButton(kind: keyof typeof SIZE, next: 'min' | 'normal' | 'max')}
    <button class="btn btn-ghost btn-xs btn-square" title={SIZE[kind].label} aria-label={SIZE[kind].label} onclick={() => (ws.dockSize = next)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={SIZE[kind].icon} /></svg>
    </button>
  {/snippet}

  <header class="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-300 px-2 py-1">
    {#if tabs.length === 1}
      <h2 class="px-1 text-sm font-semibold whitespace-nowrap">{tabs[0].label}</h2>
    {:else}
      <div role="tablist" class="tabs tabs-box tabs-xs min-w-0 flex-nowrap overflow-x-auto" aria-label="Panel bawah">
        {#each tabs as t (t.key)}
          <button role="tab" class="tab gap-1.5 whitespace-nowrap" class:tab-active={open && ws.dock === t.key} aria-selected={open && ws.dock === t.key} onclick={() => ws.setDock(t.key)}>
            {t.label}
            {#if t.key === 'log' && ws.run}<span class="tabular-nums text-base-content/70">{ws.run.log.length}</span>{/if}
            {#if ws.live(t.key)}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
          </button>
        {/each}
      </div>
    {/if}
    {#if collapsible}
      <div class="ml-auto flex shrink-0 gap-0.5">
        {#if ws.dockSize === 'max'}
          {@render sizeButton('normal', 'normal')}
        {:else if ws.dockSize === 'normal'}
          {@render sizeButton('max', 'max')}
          {@render sizeButton('min', 'min')}
        {:else}
          {@render sizeButton('show', 'normal')}
        {/if}
        {#if onclose}<PanelClose label="Tutup panel bawah" onclick={onclose} />{/if}
      </div>
    {/if}
  </header>

  {#if open}
    <div class="min-h-0 flex-1 overflow-auto"><TabView tab={ws.dock} /></div>
  {/if}
</section>
