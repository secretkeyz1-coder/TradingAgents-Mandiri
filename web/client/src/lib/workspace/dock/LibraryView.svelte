<script lang="ts">
  // Uji strategi → Indikator saya: every indicator this account can use, in one place: the built-in
  // engines, the ones the admin published (stores/indicators.svelte.ts, the catalog), and the
  // account's own scripts (stores/scripts.svelte.ts), each with its switch on the chart and a way
  // to test it in Uji indikator. New ones start from a template, from TradingView Pine code (the
  // AI translates it) or from an empty script, in the script editor the workspace keeps open.
  import type { CatalogIndicator } from '../../api';
  import { indicators } from '../../stores/indicators.svelte';
  import { scripts } from '../../stores/scripts.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { pickStrategy } from './LabView.svelte';

  indicators.load();
  scripts.load();

  const builtins = $derived(indicators.catalog.filter((i) => i.builtin));
  const published = $derived(indicators.catalog.filter((i) => !i.builtin));
  let note = $state('');

  const onChart = (i: CatalogIndicator) =>
    i.builtin === 'scalper' ? indicators.scalperOn : i.builtin === 'pob' ? indicators.pobOn : i.builtin === 'fib' ? indicators.fibOn : indicators.catalogIds.includes(i.key);
  function flip(i: CatalogIndicator) {
    if (i.builtin === 'scalper') indicators.toggle();
    else if (i.builtin === 'pob') indicators.togglePob();
    else if (i.builtin === 'fib') indicators.toggleFib();
    else indicators.toggleCatalog(i.key);
  }

  /** Uji indikator with this one chosen. */
  function test(strategy: string) {
    pickStrategy(strategy);
    ws.setDock('lab');
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Hapus indikator "${name}"? Notifikasi yang memakainya ikut berhenti.`)) return;
    note = '';
    try {
      await scripts.remove(id);
    } catch (e) {
      note = (e as Error).message;
    }
  }
</script>

<div class="flex flex-col gap-5 p-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex max-w-[70ch] flex-col gap-1 text-sm">
      <p>Semua indikator yang bisa dipakai akunmu. Tiap indikator bisa tampil di chart, mengirim notifikasi sinyal, dan diuji di Uji indikator.</p>
      <p class="text-xs text-base-content/70">Indikator buatanmu hanya terlihat olehmu. Admin bisa menerbitkan indikator untuk semua member di paket tertentu.</p>
    </div>
    <div class="flex shrink-0 flex-wrap gap-2">
      <button class="btn btn-sm" onclick={() => scripts.open(null)}>Dari template</button>
      <button class="btn btn-sm" title="Tempel kode Pine Script dari TradingView; AI menerjemahkannya" onclick={() => scripts.open(null, 'pine')}>Tempel kode Pine</button>
      <button class="btn btn-sm btn-primary" onclick={() => scripts.open(null)}>Tulis sendiri</button>
    </div>
  </div>

  {#if note}<p role="alert" class="text-sm text-error">{note}</p>{/if}
  {#if indicators.failed}<p role="alert" class="text-sm text-error">Daftar indikator gagal dimuat. Muat ulang halaman.</p>{/if}

  {#snippet row(name: string, description: string, on: boolean, toggle: () => void, strategy: string, mine: { id: string } | null)}
    <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <span class="min-w-0 flex-1">
        <span class="block font-medium">{name}</span>
        {#if description}<span class="block text-xs text-base-content/70">{description}</span>{/if}
      </span>
      <label class="label cursor-pointer gap-2 text-sm">
        <input type="checkbox" class="toggle toggle-sm" checked={on} onchange={toggle} />
        Di chart
      </label>
      <span class="flex gap-1">
        <button class="btn btn-ghost btn-xs" onclick={() => test(strategy)}>Uji</button>
        {#if mine}
          <button class="btn btn-ghost btn-xs" onclick={() => scripts.open(mine.id)}>Edit</button>
          <button class="btn btn-ghost btn-xs" onclick={() => remove(mine.id, name)}>Hapus</button>
        {/if}
      </span>
    </li>
  {/snippet}

  <section class="flex flex-col" aria-labelledby="library-builtin">
    <h3 id="library-builtin" class="text-sm font-semibold">Bawaan</h3>
    <ul class="divide-y divide-base-200">
      {#each builtins as i (i.key)}
        {@render row(i.name, i.description, onChart(i), () => flip(i), `engine:${i.builtin}`, null)}
      {:else}
        <li class="py-3 text-sm text-base-content/70">{indicators.loaded ? 'Tidak ada indikator bawaan untuk paketmu.' : 'Memuat…'}</li>
      {/each}
    </ul>
  </section>

  {#if published.length}
    <section class="flex flex-col" aria-labelledby="library-published">
      <h3 id="library-published" class="text-sm font-semibold">Dari admin</h3>
      <ul class="divide-y divide-base-200">
        {#each published as i (i.key)}
          {@render row(i.name, i.description, onChart(i), () => flip(i), i.key, null)}
        {/each}
      </ul>
    </section>
  {/if}

  <section class="flex flex-col" aria-labelledby="library-mine">
    <h3 id="library-mine" class="text-sm font-semibold">Buatan saya <span class="font-normal text-base-content/70">({scripts.items.length} dari {scripts.max})</span></h3>
    {#if scripts.error}<p role="alert" class="text-sm text-error">{scripts.error}</p>{/if}
    <ul class="divide-y divide-base-200">
      {#each scripts.items as s (s.id)}
        {@render row(s.name, s.pine ? 'Diterjemahkan dari Pine' : '', indicators.scriptIds.includes(s.id), () => indicators.toggleScript(s.id), `script:${s.id}`, { id: s.id })}
      {:else}
        <li class="py-3 text-sm text-base-content/70">Belum ada. Mulai dari template, tempel kode Pine, atau tulis sendiri.</li>
      {/each}
    </ul>
  </section>
</div>
