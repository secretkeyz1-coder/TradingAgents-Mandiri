<script lang="ts">
  // The "Tata letak" menu: presets, the mode of each panel this screen has, and
  // saving the current arrangement to the account. Opens under its button;
  // Escape or a click outside closes it.
  import { layout, PANELS, PRESETS, type PanelMode } from '../stores/layout.svelte';
  import { ws } from '../stores/workspace.svelte';

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();

  const MODE_LABELS: { mode: PanelMode; label: string }[] = [
    { mode: 'dock', label: 'Tempel' },
    { mode: 'float', label: 'Melayang' },
    { mode: 'min', label: 'Kecil' },
  ];

  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        open = false;
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  });

  /** Pasar has the market list, Riset AI its own panel; both have the bottom panel. */
  const here = $derived(PANELS.filter((p) => p.id === 'dock' || (p.id === 'market' ? ws.screen === 'pasar' : ws.screen === 'riset')));
  const active = $derived(
    PRESETS.find(
      (p) => p.arrangement.focus === layout.focus && PANELS.every(({ id }) => p.arrangement.modes[id] === layout.modes[id]),
    )?.id,
  );
</script>

<div class="relative" bind:this={root}>
  <button
    class="btn btn-ghost btn-xs gap-1"
    class:btn-active={open}
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => (open = !open)}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <rect x="3" y="3" width="7" height="18" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="14" width="8" height="7" rx="1.5" />
    </svg>
    Tata letak
  </button>
  {#if open}
    <div
      class="ta-pop absolute top-full right-0 z-50 mt-1 flex w-80 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl"
      role="dialog"
      aria-label="Tata letak"
    >
      <div class="grid grid-cols-2 gap-1.5">
        {#each PRESETS as p (p.id)}
          <button
            class="flex flex-col items-start rounded-field border px-2.5 py-2 text-left hover:bg-base-200"
            class:border-accent={active === p.id}
            class:border-transparent={active !== p.id}
            aria-pressed={active === p.id}
            onclick={() => layout.applyPreset(p.id)}
          >
            <span class="text-sm font-medium">{p.label}</span>
            <span class="text-xs text-base-content/70">{p.hint}</span>
          </button>
        {/each}
        <button
          class="flex flex-col items-start rounded-field border border-transparent px-2.5 py-2 text-left hover:bg-base-200 disabled:opacity-50"
          disabled={!layout.saved}
          onclick={() => layout.applyPreset('saved')}
        >
          <span class="text-sm font-medium">Layout saya</span>
          <span class="text-xs text-base-content/70">{layout.saved ? 'Tersimpan di akun' : 'Belum disimpan'}</span>
        </button>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/70">Setiap panel</span>
        {#each here as p (p.id)}
          <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 text-sm">
            <span>{p.label}</span>
            <div class="join w-full" role="group" aria-label={p.label}>
              {#each MODE_LABELS as m (m.mode)}
                <button
                  class="btn btn-xs join-item flex-1"
                  class:btn-primary={layout.modes[p.id] === m.mode}
                  aria-pressed={layout.modes[p.id] === m.mode}
                  onclick={() => layout.setMode(p.id, m.mode)}>{m.label}</button
                >
              {/each}
            </div>
          </div>
        {/each}
        <label class="label mt-1 cursor-pointer gap-2 text-sm text-base-content">
          <input type="checkbox" class="toggle toggle-xs" checked={layout.focus} onchange={() => layout.toggleFocus()} />
          Fokus chart (sembunyikan bingkai) <kbd class="kbd kbd-xs ml-auto">F</kbd>
        </label>
      </div>

      <p class="text-xs text-base-content/70">Seret judul jendela ke tepi layar untuk menempel. Tarik pojok kanan bawah untuk ubah ukuran.</p>
      <div class="flex gap-2">
        <button class="btn btn-sm flex-1" onclick={() => layout.saveAsMine()}>Simpan sebagai layout saya</button>
        <button class="btn btn-ghost btn-sm" onclick={() => layout.reset()}>Reset</button>
      </div>
    </div>
  {/if}
</div>
