<script lang="ts">
  // Pantau and Uji strategi: a page of tabs (stores/workspace SCREENS), the same on a desktop
  // and a phone. Pantau holds only what the member watches (their scheduled analyses and
  // alerts); Uji strategi their backtests and lab runs, with the built-in strategies' live record.
  // The tabs move between pages, so they are a nav of buttons marked aria-current, not an ARIA tablist
  // whose arrow keys nothing here implements. Uji strategi's read as a path: each tab with its icon and
  // what it is for, arrows between the steps, and the AI test set apart; a phone shows short names only.
  import { SCREENS, ws, type DockTab } from '../stores/workspace.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import TabView from './TabView.svelte';

  let { screen }: { screen: 'pantau' | 'uji' } = $props();

  const s = $derived(SCREENS.find((x) => x.key === screen) ?? SCREENS[3]);
  const path = $derived(s.tabs.filter((t) => !t.apart));
  const apart = $derived(s.tabs.filter((t) => t.apart));

  let scroller: HTMLDivElement | undefined = $state();
  $effect(() => {
    // The tabs share one scroller: a tab opens at its top, not where the last one was left.
    void ws.dock;
    scroller?.scrollTo({ top: 0 });
  });
</script>

{#snippet running(tab: DockTab)}
  {#if ws.live(tab)}<span class="status status-xs status-info ml-1.5 align-middle motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
{/snippet}

{#snippet step(t: (typeof s.tabs)[number])}
  <button type="button" class="ta-journey-step" aria-current={ws.dock === t.key ? 'page' : undefined} onclick={() => ws.setDock(t.key)}>
    <span class="ta-journey-icon"><Icon name={t.key as IconName} /></span>
    <span class="min-w-0 text-left">
      <span class="block font-semibold leading-tight"><span class="max-md:hidden">{t.label}</span><span class="md:hidden">{t.short ?? t.label}</span>{@render running(t.key)}</span>
      {#if t.hint}<span class="ta-journey-hint">{t.hint}</span>{/if}
    </span>
  </button>
{/snippet}

<section class="flex h-full min-h-0 min-w-0 flex-col {screen === 'uji' ? 'bg-base-200' : 'bg-base-100'}" aria-labelledby="page-title">
  <h1 id="page-title" class="sr-only">{s.label}</h1>
  {#if screen === 'uji'}
    <nav class="ta-journey" aria-label={s.label}>
      {#each path as t, i (t.key)}
        {#if i}<Icon name="right" size={16} class="ta-journey-arrow" />{/if}
        {@render step(t)}
      {/each}
      {#if apart.length}
        <div class="ta-journey-apart">
          {#each apart as t (t.key)}{@render step(t)}{/each}
        </div>
      {/if}
    </nav>
  {:else}
    <nav class="tabs tabs-border shrink-0 flex-nowrap overflow-x-auto border-b border-base-300 px-2 sm:px-4" aria-label={s.label}>
      {#each s.tabs as t (t.key)}
        <button type="button" class="tab gap-1.5 whitespace-nowrap" class:tab-active={ws.dock === t.key} aria-current={ws.dock === t.key ? 'page' : undefined} onclick={() => ws.setDock(t.key)}>
          {t.label}{@render running(t.key)}
        </button>
      {/each}
    </nav>
  {/if}
  <div class="min-h-0 flex-1 overflow-auto" bind:this={scroller}>
    <div class="mx-auto w-full {screen === 'uji' ? 'max-w-[88rem]' : 'max-w-6xl'}"><TabView tab={ws.dock} /></div>
  </div>
</section>
