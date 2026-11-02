<script lang="ts">
  // Riset AI's asset switch, at the head of its chart: the asset's name opens the asset finder in a
  // popover (search, or a market's list with prices), and the assets opened lately sit beside it as
  // one-click chips, with a spinner on one whose analysis still runs. Switching moves the whole
  // screen (chart, chat, analysis form, history) to that asset; Alt+↑/↓ (WorkspaceShell) steps
  // through its market's list.
  import { friendlyName } from '../beginner/plain';
  import { keepPlaced, placeMenu } from '../chart/menuSide';
  import { jobs } from '../stores/jobs.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { nameOf, toYahoo } from '../tv';
  import AssetFinder from './AssetFinder.svelte';

  /** How many recent assets show as chips beside the name. */
  let { chips = 4 }: { chips?: number } = $props();

  let open = $state(false);
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let root: HTMLDivElement | undefined = $state();

  const others = $derived(ws.recent.filter((s) => s !== ws.symbol).slice(0, chips));
  const running = (tv: string) => {
    const yahoo = toYahoo(tv);
    return !!yahoo && jobs.analyses.some((a) => a.ticker === yahoo && (a.status === 'queued' || a.status === 'running'));
  };
  /** A chip's label: the listed name when short, else the code. */
  const short = (tv: string) => {
    const name = nameOf(tv);
    return name && name.length <= 14 ? name : (tv.split(':').pop() ?? tv);
  };

  function switchTo(tv: string) {
    open = false;
    ws.setSymbol(tv);
  }

  $effect(() => {
    if (open && root) return keepPlaced(root, 22, (p) => (place = p));
  });
  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  });
</script>

<div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
  <div class="relative" bind:this={root}>
    <button
      class="btn btn-sm gap-1.5"
      class:btn-active={open}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Ganti aset. Alt+↑ atau Alt+↓ pindah ke aset sebelah di daftar pasarnya."
      onclick={() => {
        if (!open && root) place = placeMenu(root, 22);
        open = !open;
      }}
    >
      <span class="max-w-48 truncate font-semibold">{friendlyName(ws.symbol)}</span>
      <span class="font-mono text-xs font-normal text-base-content/70">{ws.symbol.split(':').pop()}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {#if open}
      <div
        class="ta-pop absolute top-full z-40 mt-1 flex flex-col rounded-box border border-base-300 bg-base-100 p-2 shadow-xl"
        style:left="{place.left}px"
        style:width="{place.width}px"
        style:max-height="{place.maxHeight}px"
        role="dialog"
        aria-label="Ganti aset"
      >
        <!-- On a phone the list is what is tapped; a keyboard popping up would cover it. -->
        <AssetFinder browse autofocus={layoutOf(viewport) !== 'narrow'} onpick={switchTo} onclose={() => (open = false)} />
      </div>
    {/if}
  </div>
  {#if others.length}
    <span class="text-xs text-base-content/70">Terakhir:</span>
    {#each others as tv (tv)}
      <button class="btn btn-ghost btn-xs max-w-32 gap-1" title="Buka {friendlyName(tv)}" onclick={() => switchTo(tv)}>
        <span class="truncate">{short(tv)}</span>
        {#if running(tv)}<span class="loading loading-spinner loading-xs" aria-label="analisa berjalan"></span>{/if}
      </button>
    {/each}
  {/if}
</div>
