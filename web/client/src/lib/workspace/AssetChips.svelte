<script lang="ts">
  // The assets a test runs on, as chips with the names people know (Bitcoin, Emas, Bank Central
  // Asia), added from the asset finder (search, or a market's list) instead of typed engine codes.
  // It holds engine spellings (BTC-USD, GC=F, BBCA.JK); an asset the engine cannot read is refused
  // with a note. Used by Indikator's test card (LabCard) and Uji saran AI (AnalysisForm). Its buttons are all
  // type="button": the chips sit inside forms, where a stray submit would start a test. Focus goes back
  // to "Tambah aset" when the finder closes, and to the next chip's × when one is removed.
  import { tick } from 'svelte';
  import { friendlyName } from '../beginner/plain';
  import { keepPlaced, placeMenu } from '../chart/menuSide';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { toTradingView, toYahoo } from '../tv';
  import AssetFinder from './AssetFinder.svelte';
  import Icon from './Icon.svelte';

  let { symbols = $bindable([]), max = 5 }: { symbols?: string[]; max?: number } = $props();

  let open = $state(false);
  let note = $state('');
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let root: HTMLDivElement | undefined = $state();
  let row: HTMLDivElement | undefined = $state();
  let addButton: HTMLButtonElement | undefined = $state();

  /** After a change, focus lands on `index`'s ×, else "Tambah aset", else the last ×. */
  async function refocus(index: number | null) {
    await tick();
    const removers = [...(row?.querySelectorAll<HTMLButtonElement>('[data-remove]') ?? [])];
    const target = index != null ? (removers[Math.min(index, removers.length - 1)] ?? addButton) : (addButton ?? removers.at(-1));
    target?.focus();
  }

  function close() {
    open = false;
    refocus(null);
  }

  function add(tv: string) {
    const yahoo = toYahoo(tv);
    if (!yahoo) {
      note = `${friendlyName(tv)} belum bisa diuji: datanya tidak terbaca mesin.`;
      close();
      return;
    }
    note = '';
    if (!symbols.includes(yahoo) && symbols.length < max) symbols = [...symbols, yahoo];
    close();
  }

  function remove(s: string, index: number) {
    symbols = symbols.filter((x) => x !== s);
    refocus(index);
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

<div class="flex flex-col gap-1.5">
  <div class="flex flex-wrap items-center gap-2" bind:this={row}>
    {#each symbols as s, i (s)}
      {@const name = friendlyName(toTradingView(s))}
      <span class="inline-flex h-9 items-center gap-0.5 rounded-full border border-base-300 bg-base-200 pr-1 pl-3 text-sm font-medium" title={s}>
        {name}
        <button type="button" data-remove class="btn btn-ghost btn-circle btn-xs" aria-label="Hapus {name} dari uji" onclick={() => remove(s, i)}>
          <Icon name="x" size={14} stroke={2.2} />
        </button>
      </span>
    {/each}
    {#if symbols.length < max}
      <div class="relative" bind:this={root}>
        <button
          bind:this={addButton}
          type="button"
          class="btn btn-sm h-9 rounded-full border-dashed border-base-300 bg-transparent font-medium text-accent shadow-none"
          aria-haspopup="dialog"
          aria-expanded={open}
          onclick={() => {
            if (!open && root) place = placeMenu(root, 22);
            open = !open;
          }}><Icon name="plus" size={16} />Tambah aset</button
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
            <AssetFinder browse autofocus={layoutOf(viewport) !== 'narrow'} onpick={add} onclose={close} />
          </div>
        {/if}
      </div>
    {:else}
      <span class="text-xs text-base-content/70">Maksimal {max} aset.</span>
    {/if}
  </div>
  {#if note}<p class="text-xs text-warning" role="status">{note}</p>{/if}
</div>
