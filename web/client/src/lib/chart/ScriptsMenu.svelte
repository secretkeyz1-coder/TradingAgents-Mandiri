<script lang="ts">
  // The chart toolbar's "Skrip" menu: switch each of the user's scripts on or
  // off on the AI chart, and open the editor.
  import { indicators } from '../stores/indicators.svelte';
  import { scripts } from '../stores/scripts.svelte';
  import { keepPlaced, placeMenu } from './menuSide';

  let open = $state(false);
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let root: HTMLDivElement | undefined = $state();

  scripts.load();
  const shown = $derived(scripts.items.filter((s) => indicators.scriptIds.includes(s.id)).length);

  $effect(() => {
    if (open && root) return keepPlaced(root, 18, (p) => (place = p));
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

  function edit(id: string | null) {
    open = false;
    scripts.open(id);
  }
</script>

<div class="relative" bind:this={root}>
  <button
    class="btn btn-xs gap-1"
    class:btn-active={open}
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => {
      if (!open && root) place = placeMenu(root, 18);
      open = !open;
    }}
  >
    Skrip{#if shown}<span class="badge badge-xs badge-accent">{shown}</span>{/if}
  </button>
  {#if open}
    <div
      class="ta-pop absolute top-full z-40 mt-1 flex flex-col gap-2 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-xl"
      style:left="{place.left}px"
      style:width="{place.width}px"
      style:max-height="{place.maxHeight}px"
      role="dialog"
      aria-label="Skrip indikator"
    >
      <h3 class="font-semibold">Skrip indikator Anda</h3>
      {#if scripts.error}<p class="text-xs text-error">{scripts.error}</p>{/if}
      {#if scripts.items.length}
        <div class="flex flex-col gap-1">
          {#each scripts.items as s (s.id)}
            <div class="flex items-center gap-2">
              <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input type="checkbox" class="toggle toggle-sm" checked={indicators.scriptIds.includes(s.id)} onchange={() => indicators.toggleScript(s.id)} />
                <span class="truncate">{s.name}</span>
              </label>
              <button class="btn btn-ghost btn-xs" aria-label="Edit {s.name}" onclick={() => edit(s.id)}>Edit</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-base-content/70">Belum ada skrip. Buat dari template, tulis sendiri, atau terjemahkan skrip Pine dengan AI.</p>
      {/if}
      <button class="btn btn-sm" onclick={() => edit(null)}>Buat skrip baru</button>
      <p class="text-xs text-base-content/70">Skrip yang tampil di chart juga bisa dinyalakan di menu Notifikasi dan ditanyakan ke agent AI.</p>
    </div>
  {/if}
</div>
