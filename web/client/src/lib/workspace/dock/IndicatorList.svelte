<script module lang="ts">
  import type { UserScript } from '../../api';

  /** One indicator on Uji strategi → Indikator (IndicatorsView builds them). */
  export type IndicatorItem = {
    /** The strategy key Uji knows it by: engine:<name>, catalog:<id> or script:<id>. */
    id: string;
    kind: 'builtin' | 'published' | 'own';
    name: string;
    description: string;
    /** What its signal notifications name it (server/src/alerts.ts); null for one that has none. */
    alertKey: string | null;
    /** The ledger source of a built-in engine. */
    engine: string | null;
    /** Whether the chart can draw it: Donchian is only tested. */
    drawable: boolean;
    on: boolean;
    toggle: () => void;
    script: UserScript | null;
  };
</script>

<script lang="ts">
  // The indicators on the left of Uji strategi → Indikator: a search, "Indikator baru" with its ways to start,
  // then the groups (built in, from the admin, the account's own), each row with whether it is on the chart, its
  // notifications and its latest test. Picking one opens it in the middle; the row stays ringed.
  import { lab, verdictOf } from '../../stores/lab.svelte';
  import { scripts } from '../../stores/scripts.svelte';
  import { indicators } from '../../stores/indicators.svelte';
  import Icon from '../Icon.svelte';

  let {
    items,
    selected,
    notifications,
    onpick,
  }: {
    items: IndicatorItem[];
    selected: string | null;
    /** How many signal notifications use an indicator. */
    notifications: (i: IndicatorItem) => number;
    onpick: (i: IndicatorItem) => void;
  } = $props();

  let query = $state('');
  const found = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => `${i.name} ${i.description}`.toLowerCase().includes(q)) : items;
  });
  const groups = $derived([
    { key: 'builtin', label: 'Bawaan', count: '', items: found.filter((i) => i.kind === 'builtin') },
    { key: 'published', label: 'Dari admin', count: '', items: found.filter((i) => i.kind === 'published') },
    { key: 'own', label: 'Buatan saya', count: `${scripts.items.length} dari ${scripts.max}`, items: found.filter((i) => i.kind === 'own') },
  ]);

  // --- "Indikator baru": the ways to start, in a menu.
  let menuOpen = $state(false);
  let menu: HTMLDetailsElement | undefined = $state();
  const STARTS = [
    { title: 'Mulai dari template', sub: 'Pola siap pakai, tinggal diubah.', act: () => scripts.open(null) },
    { title: 'Tempel kode Pine', sub: 'Dari TradingView; AI menerjemahkannya.', act: () => scripts.open(null, 'pine') },
    { title: 'Tulis dari prompt', sub: 'Jelaskan aturannya dengan kata-kata; AI menulis skripnya.', act: () => scripts.open(null, 'prompt') },
    { title: 'Mulai kosong', sub: 'Tulis sendiri di editor skrip.', act: () => scripts.open(null) },
  ];
  const full = $derived(scripts.items.length >= scripts.max);
  $effect(() => {
    // Open, it closes on a click elsewhere, or on Escape with focus back on its button.
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node)) menuOpen = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      menuOpen = false;
      menu?.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });
</script>

<section class="ta-card" aria-labelledby="ind-list-h">
  <div class="flex items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
    <h2 id="ind-list-h" class="font-semibold">Indikator</h2>
    <span class="text-sm ta-muted">{items.length} bisa dipakai</span>
  </div>
  <div class="flex flex-col gap-3 px-4 pt-4">
    <label class="input w-full">
      <Icon name="search" size={16} />
      <span class="sr-only">Cari indikator</span>
      <input id="ind-search" type="search" placeholder="Cari indikator" bind:value={query} />
    </label>
    {#if full}
      <button type="button" class="btn btn-primary w-full" disabled><Icon name="plus" size={18} />Indikator baru</button>
      <p class="text-xs ta-muted">Slot skrip penuh ({scripts.items.length} dari {scripts.max}). Hapus satu dulu, atau naikkan paket untuk slot lebih banyak.</p>
    {:else}
      <details class="dropdown w-full" bind:this={menu} bind:open={menuOpen}>
        <summary class="btn btn-primary w-full"><Icon name="plus" size={18} />Indikator baru</summary>
        <ul class="menu dropdown-content z-30 mt-1 w-full rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">
          {#each STARTS as s (s.title)}
            <li>
              <button
                type="button"
                class="flex flex-col items-start gap-0.5"
                onclick={() => {
                  menuOpen = false;
                  s.act();
                }}><span class="font-semibold">{s.title}</span><span class="text-xs ta-muted">{s.sub}</span></button
              >
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
  {#if indicators.failed}<p role="alert" class="px-5 pt-3 text-sm text-error">Daftar indikator gagal dimuat. Muat ulang halaman.</p>{/if}
  {#each groups as g (g.key)}
    {#if g.items.length || (g.key === 'own' && !query.trim())}
      <p class="ta-group-label"><span>{g.label}</span><span>{g.count || g.items.length}</span></p>
      {#if g.key === 'own' && scripts.error}<p role="alert" class="px-5 text-sm text-error">{scripts.error}</p>{/if}
      <ul class="ta-rows pt-0">
        {#each g.items as i (i.id)}
          {@const run = lab.latest(i.id)}
          {@const v = run ? verdictOf(run) : null}
          {@const n = notifications(i)}
          <li>
            <button type="button" class="ta-row min-h-0" aria-current={selected === i.id ? 'true' : undefined} onclick={() => onpick(i)}>
              <span class="min-w-0 flex-1">
                <span class="ta-row-title">{i.name}</span>
                <span class="ta-row-sub">{i.drawable ? (i.on ? 'Di chart' : 'Tidak di chart') : 'Hanya untuk uji'}{n ? ` · ${n} notifikasi` : ''}</span>
              </span>
              <span class="badge badge-soft {v ? v.badge : 'badge-ghost'} shrink-0 gap-1">{#if v}<Icon name={v.icon} size={14} />{/if}{v ? v.word : 'Belum diuji'}</span>
            </button>
          </li>
        {:else}
          <li class="px-3 py-3 text-sm ta-muted">Belum ada. Buat dari template, kode Pine, prompt, atau mulai kosong.</li>
        {/each}
      </ul>
    {/if}
  {/each}
  {#if query.trim() && !found.length}<p class="px-5 py-3 text-sm ta-muted">Tidak ada indikator bernama “{query.trim()}”.</p>{/if}
  <p class="px-5 pt-1 pb-4 text-xs ta-muted">Indikator buatanmu hanya terlihat olehmu. Admin bisa menerbitkan indikator untuk paket tertentu.</p>
</section>
