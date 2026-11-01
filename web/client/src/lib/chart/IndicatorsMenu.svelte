<script lang="ts">
  // The chart toolbar's "Indikator" menu: what the admin's catalog opens to this
  // account (stores/indicators.svelte.ts), the built-in signal engines and the
  // scripts the admin published, each with a line on what it draws and, when the
  // timeframe rules a built-in out, why. Scalper Pro+ keeps its own settings panel
  // (IndicatorPanel), opened from here.
  import type { CatalogIndicator } from '../api';
  import { indicators } from '../stores/indicators.svelte';
  import { keepPlaced, placeMenu } from './menuSide';

  let { pobOk, fibOk }: { pobOk: boolean; fibOk: boolean } = $props();

  let open = $state(false);
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let root: HTMLDivElement | undefined = $state();

  const active = $derived(Number(indicators.showScalper) + Number(indicators.showPob) + Number(indicators.showFib) + indicators.published.length);
  /** Why a built-in is off on this timeframe. */
  const TIMEFRAMES: Record<string, string> = { pob: 'Hanya di timeframe 15m dan 1j.', fib: 'Hanya di timeframe 15m, 1j dan 1h.' };

  const usable = (item: CatalogIndicator) => (item.builtin === 'pob' ? pobOk : item.builtin === 'fib' ? fibOk : true);
  const isOn = (item: CatalogIndicator) =>
    item.builtin === 'scalper'
      ? indicators.scalperOn
      : item.builtin === 'pob'
        ? indicators.pobOn
        : item.builtin === 'fib'
          ? indicators.fibOn
          : indicators.catalogIds.includes(item.key);
  function flip(item: CatalogIndicator) {
    if (item.builtin === 'scalper') indicators.toggle();
    else if (item.builtin === 'pob') indicators.togglePob();
    else if (item.builtin === 'fib') indicators.toggleFib();
    else indicators.toggleCatalog(item.key);
  }

  $effect(() => {
    if (open && root) return keepPlaced(root, 20, (p) => (place = p));
  });

  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });
</script>

<div class="relative" bind:this={root}>
  <button
    class="btn btn-xs gap-1"
    class:btn-active={open}
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => {
      if (!open && root) place = placeMenu(root, 20);
      open = !open;
    }}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6" /></svg>
    Indikator{#if active}<span class="badge badge-xs badge-accent">{active}</span>{/if}
  </button>
  {#if open}
    <div
      class="ta-pop absolute top-full z-40 mt-1 flex flex-col gap-1 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 text-sm shadow-xl"
      style:left="{place.left}px"
      style:width="{place.width}px"
      style:max-height="{place.maxHeight}px"
      role="dialog"
      aria-label="Indikator"
    >
      {#each indicators.catalog as item (item.key)}
        {@const ok = usable(item)}
        <div class="flex items-start gap-2 rounded-field p-2" class:opacity-60={!ok}>
          <label class="flex min-w-0 flex-1 items-start gap-3" class:cursor-pointer={ok}>
            <input type="checkbox" class="toggle toggle-sm mt-0.5" checked={isOn(item)} disabled={!ok} onchange={() => flip(item)} />
            <span class="flex min-w-0 flex-col">
              <span class="font-medium">{item.name}</span>
              {#if !ok}
                <span class="text-xs text-base-content/70">{TIMEFRAMES[item.builtin ?? '']}</span>
              {:else if item.description}
                <span class="text-xs text-base-content/70">{item.description}</span>
              {/if}
              {#if !item.active}
                <span class="text-xs text-warning">Disembunyikan dari member (atur di Konsol admin → Indikator).</span>
              {/if}
            </span>
          </label>
          {#if item.builtin === 'scalper' && indicators.scalperOn}
            <button class="btn btn-ghost btn-xs" aria-expanded={indicators.settingsOpen} onclick={() => (indicators.settingsOpen = !indicators.settingsOpen)}>Atur</button>
          {/if}
        </div>
      {:else}
        <p class="p-2 text-xs text-base-content/70">
          {indicators.failed ? 'Daftar indikator gagal dimuat. Muat ulang halaman.' : indicators.loaded ? 'Belum ada indikator untuk paketmu.' : 'Memuat…'}
        </p>
      {/each}
    </div>
  {/if}
</div>
