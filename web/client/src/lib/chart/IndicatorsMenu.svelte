<script lang="ts">
  // The chart toolbar's "Indikator" menu: the built-in signal engines, each
  // with a line on what it draws and, when the timeframe rules it out, why.
  // Scalper Pro+ keeps its own settings panel (IndicatorPanel), opened from here.
  import { indicators } from '../stores/indicators.svelte';
  import { keepPlaced, placeMenu } from './menuSide';

  let { pobOk, fibOk }: { pobOk: boolean; fibOk: boolean } = $props();

  let open = $state(false);
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let root: HTMLDivElement | undefined = $state();

  const active = $derived(Number(indicators.scalperOn) + Number(indicators.pobOn) + Number(indicators.fibOn));

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
      <div class="flex items-start gap-2 rounded-field p-2">
        <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
          <input type="checkbox" class="toggle toggle-sm mt-0.5" checked={indicators.scalperOn} onchange={() => indicators.toggle()} />
          <span class="flex min-w-0 flex-col">
            <span class="font-medium">Scalper Pro+</span>
            <span class="text-xs text-base-content/70">Sinyal beli dan jual cepat dari arah tren dan momentum.</span>
          </span>
        </label>
        {#if indicators.scalperOn}
          <button class="btn btn-ghost btn-xs" aria-expanded={indicators.settingsOpen} onclick={() => (indicators.settingsOpen = !indicators.settingsOpen)}>Atur</button>
        {/if}
      </div>
      <label class="flex items-start gap-3 rounded-field p-2" class:cursor-pointer={pobOk} class:opacity-60={!pobOk}>
        <input type="checkbox" class="toggle toggle-sm mt-0.5" checked={indicators.pobOn} disabled={!pobOk} onchange={() => indicators.togglePob()} />
        <span class="flex min-w-0 flex-col">
          <span class="font-medium">PoB BYSTRA</span>
          <span class="text-xs text-base-content/70">
            {pobOk ? 'Zona tempat harga sering berbalik (SNR, QM, CK2/CK3).' : 'Hanya di timeframe 15m dan 1j.'}
          </span>
        </span>
      </label>
      <label class="flex items-start gap-3 rounded-field p-2" class:cursor-pointer={fibOk} class:opacity-60={!fibOk}>
        <input type="checkbox" class="toggle toggle-sm mt-0.5" checked={indicators.fibOn} disabled={!fibOk} onchange={() => indicators.toggleFib()} />
        <span class="flex min-w-0 flex-col">
          <span class="font-medium">Fib GZ</span>
          <span class="text-xs text-base-content/70">
            {fibOk ? 'Area pullback Fibonacci 0,5–0,618 setelah harga bergerak jauh.' : 'Hanya di timeframe 15m, 1j dan 1h.'}
          </span>
        </span>
      </label>
    </div>
  {/if}
</div>
