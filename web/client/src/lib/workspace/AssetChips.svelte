<script lang="ts">
  // The assets a test runs on, as chips with the names people know (Bitcoin, Emas, Bank Central
  // Asia), added from the asset finder (search, or a market's list) instead of typed engine codes.
  // It holds engine spellings (BTC-USD, GC=F, BBCA.JK); an asset the engine cannot read is refused
  // with a note. Used by Uji indikator (LabView) and Uji saran AI (AnalysisForm).
  import { friendlyName } from '../beginner/plain';
  import { keepPlaced, placeMenu } from '../chart/menuSide';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { toTradingView, toYahoo } from '../tv';
  import AssetFinder from './AssetFinder.svelte';

  let { symbols = $bindable([]), max = 5 }: { symbols?: string[]; max?: number } = $props();

  let open = $state(false);
  let note = $state('');
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let root: HTMLDivElement | undefined = $state();

  function add(tv: string) {
    const yahoo = toYahoo(tv);
    open = false;
    if (!yahoo) {
      note = `${friendlyName(tv)} belum bisa diuji: datanya tidak terbaca mesin.`;
      return;
    }
    note = '';
    if (!symbols.includes(yahoo) && symbols.length < max) symbols = [...symbols, yahoo];
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

<div class="flex flex-col gap-1">
  <div class="flex flex-wrap items-center gap-1.5">
    {#each symbols as s (s)}
      <span class="badge badge-ghost gap-1" title={s}>
        {friendlyName(toTradingView(s))}
        <button class="cursor-pointer" aria-label="Hapus {friendlyName(toTradingView(s))}" onclick={() => (symbols = symbols.filter((x) => x !== s))}>×</button>
      </span>
    {/each}
    {#if symbols.length < max}
      <div class="relative" bind:this={root}>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          aria-haspopup="dialog"
          aria-expanded={open}
          onclick={() => {
            if (!open && root) place = placeMenu(root, 22);
            open = !open;
          }}>+ Aset</button
        >
        {#if open}
          <div
            class="ta-pop absolute top-full z-40 mt-1 flex flex-col rounded-box border border-base-300 bg-base-100 p-2 shadow-xl"
            style:left="{place.left}px"
            style:width="{place.width}px"
            style:max-height="{place.maxHeight}px"
            role="dialog"
            aria-label="Tambah aset"
          >
            <AssetFinder browse autofocus={layoutOf(viewport) !== 'narrow'} onpick={add} onclose={() => (open = false)} />
          </div>
        {/if}
      </div>
    {:else}
      <span class="text-xs text-base-content/70">Maksimal {max} aset.</span>
    {/if}
  </div>
  {#if note}<p class="text-xs text-warning" role="status">{note}</p>{/if}
</div>
