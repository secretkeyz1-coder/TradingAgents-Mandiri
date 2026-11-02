<script lang="ts">
  // Uji strategi → Indikator saya: every indicator this account can use, listed on the left in three groups
  // (the built-in engines, the ones the admin published from stores/indicators.svelte.ts' catalog, and the
  // account's own scripts from stores/scripts.svelte.ts), each with its latest test. The one picked opens on
  // the right as two numbered steps, test it on history (Uji indikator) and then follow its real signals
  // (Rekam jejak live for an engine, notifications for any), then its switch on the chart and, for a
  // script of your own, editing and deleting. Deleting asks first in a dialog that names what goes with it
  // (the signal notifications using it, server/src/scripts.ts); its tests stay. New ones start from a
  // template, from TradingView Pine code (the AI translates it) or empty, in the script editor the
  // workspace keeps open. A phone shows one side at a time: the list, or the indicator picked.
  import { api, type LedgerRecord, type SignalAlerts, type UserScript } from '../../api';
  import { auth } from '../../auth.svelte';
  import { friendlyName } from '../../beginner/plain';
  import { formatR, TIMEFRAME_NAMES } from '../../format';
  import { announcer } from '../../stores/announcer.svelte';
  import { indicators } from '../../stores/indicators.svelte';
  import { lab, timeframeLabel, verdictOf } from '../../stores/lab.svelte';
  import { scripts } from '../../stores/scripts.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { toTradingView } from '../../tv';
  import Icon from '../Icon.svelte';
  import { pickStrategy } from './LabView.svelte';
  import { pickSource } from './SignalsView.svelte';

  indicators.load();
  scripts.load();
  if (!lab.loaded) lab.load();

  type Item = {
    /** The strategy key Uji indikator knows it by: engine:<name>, catalog:<id> or script:<id>. */
    id: string;
    kind: 'builtin' | 'published' | 'own';
    name: string;
    description: string;
    /** What its signal notifications name it (server/src/alerts.ts). */
    alertKey: string;
    /** The ledger source for a built-in engine. */
    engine: string | null;
    on: boolean;
    toggle: () => void;
    script: UserScript | null;
  };

  const items = $derived.by((): Item[] => {
    const builtin = indicators.catalog
      .filter((i) => i.builtin)
      .map((i): Item => {
        const b = i.builtin!;
        const on = b === 'scalper' ? indicators.scalperOn : b === 'pob' ? indicators.pobOn : indicators.fibOn;
        const toggle = () => (b === 'scalper' ? indicators.toggle() : b === 'pob' ? indicators.togglePob() : indicators.toggleFib());
        return { id: `engine:${b}`, kind: 'builtin', name: i.name, description: i.description, alertKey: b, engine: b, on, toggle, script: null };
      });
    const published = indicators.catalog
      .filter((i) => !i.builtin)
      .map((i): Item => ({
        id: i.key,
        kind: 'published',
        name: i.name,
        description: i.description,
        alertKey: i.key,
        engine: null,
        on: indicators.catalogIds.includes(i.key),
        toggle: () => indicators.toggleCatalog(i.key),
        script: null,
      }));
    const own = scripts.items.map(
      (s): Item => ({
        id: `script:${s.id}`,
        kind: 'own',
        name: s.name,
        description: s.pine ? 'Skrip buatanmu, diterjemahkan dari Pine.' : 'Skrip buatanmu.',
        alertKey: `script:${s.id}`,
        engine: null,
        on: indicators.scriptIds.includes(s.id),
        toggle: () => indicators.toggleScript(s.id),
        script: s,
      }),
    );
    return [...builtin, ...published, ...own];
  });
  const groups = $derived([
    { key: 'builtin', label: 'Bawaan', count: '', items: items.filter((i) => i.kind === 'builtin') },
    { key: 'published', label: 'Dari admin', count: '', items: items.filter((i) => i.kind === 'published') },
    { key: 'own', label: 'Buatan saya', count: `${scripts.items.length} dari ${scripts.max}`, items: items.filter((i) => i.kind === 'own') },
  ]);

  let selectedId = $state('');
  const sel = $derived(items.find((i) => i.id === selectedId) ?? items[0] ?? null);
  /** On a phone, the indicator picked shown over the list. */
  let showDetail = $state(false);
  let done = $state('');

  function pick(i: Item) {
    selectedId = i.id;
    showDetail = true;
    done = '';
  }

  // Signal notifications and the ledger's live record, for step 2.
  let alerts = $state<SignalAlerts | null>(null);
  let record = $state<LedgerRecord | null>(null);
  const loadAlerts = () =>
    api.alerts().then(
      (a) => (alerts = a),
      () => {},
    );
  loadAlerts();
  api.ledgerRecord().then(
    (r) => (record = r),
    () => {},
  );
  const alertsOf = (i: Item) => alerts?.items.filter((a) => a.indicator === i.alertKey) ?? [];
  const alertPlaces = (i: Item) => alertsOf(i).map((a) => `${friendlyName(a.tvSymbol)}, ${TIMEFRAME_NAMES[a.timeframe] ?? a.timeframe}`);
  /** An engine's live record over the ledger's window, all its timeframes together. */
  function liveOf(engine: string) {
    const rows = record?.items.filter((x) => x.source === engine) ?? [];
    if (!rows.length) return null;
    const closed = rows.reduce((n, x) => n + x.all.closed, 0);
    const wins = rows.reduce((n, x) => n + x.all.wins, 0);
    return {
      closed,
      open: rows.reduce((n, x) => n + x.all.open, 0),
      winRate: closed ? wins / closed : null,
      expectancy: closed ? rows.reduce((n, x) => n + (x.all.expectancy ?? 0) * x.all.closed, 0) / closed : null,
    };
  }

  /** What Uji indikator offers this account (the plan decides the engines and the admin's indicators). */
  const testable = $derived(
    new Set(lab.meta ? [...Object.keys(lab.meta.engines).map((k) => `engine:${k}`), ...lab.meta.catalog.map((c) => `catalog:${c.id}`), ...lab.meta.scripts.map((s) => `script:${s.id}`)] : []),
  );
  const name = (s: string) => friendlyName(toTradingView(s));
  const joinNames = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} dan ${xs.at(-1)}`);
  const day = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'ta-up' : x < 0 ? 'ta-down' : '');

  function test(i: Item) {
    pickStrategy(i.id);
    ws.setDock('lab');
  }
  function retest(i: Item) {
    const run = lab.latest(i.id);
    if (run) lab.reuse(run.config, {}, 'Pengaturan uji terakhir sudah diisi. Ubah yang perlu, lalu jalankan.');
    test(i);
  }
  function openRun(id: string) {
    lab.open(id);
    ws.setDock('lab');
  }
  /** Notifications are set from the chart's Notifikasi menu: open the chart with this indicator on. */
  function toChart(i: Item) {
    if (!i.on) i.toggle();
    const symbol = lab.latest(i.id)?.config.symbols[0];
    if (symbol) ws.setSymbol(toTradingView(symbol));
    else ws.showChart();
    announcer.say(`Chart terbuka dengan ${i.name}. Pasang notifikasinya dari menu Notifikasi di atas chart.`);
  }

  // --- "Indikator baru": three ways to start, in a menu.
  let menuOpen = $state(false);
  let menu: HTMLDetailsElement | undefined = $state();
  const STARTS = [
    { title: 'Mulai dari template', sub: 'Pola siap pakai, tinggal diubah.', act: () => scripts.open(null) },
    { title: 'Tempel kode Pine', sub: 'Dari TradingView; AI menerjemahkannya.', act: () => scripts.open(null, 'pine') },
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

  // --- Deleting one's own script: a dialog that names what goes with it.
  let dialog: HTMLDialogElement | undefined = $state();
  let deleting = $state<Item | null>(null);
  let busy = $state(false);
  let deleteError = $state('');
  function askDelete(i: Item) {
    deleting = i;
    deleteError = '';
    dialog?.showModal();
  }
  async function confirmDelete() {
    const i = deleting;
    if (!i?.script) return;
    const gone = alertsOf(i).length;
    busy = true;
    deleteError = '';
    try {
      await scripts.remove(i.script.id);
      dialog?.close();
      selectedId = '';
      showDetail = false;
      done = `"${i.name}" dihapus${gone ? `, bersama ${gone} notifikasi sinyalnya` : ''}. Slot skrip: ${scripts.items.length} dari ${scripts.max} terpakai.`;
      announcer.say(done);
      loadAlerts();
    } catch (e) {
      deleteError = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="ta-split">
  <aside class="ta-side {showDetail ? 'max-lg:hidden' : ''}" aria-label="Daftar indikator">
    <section class="ta-card" aria-labelledby="lib-h">
      <div class="flex items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
        <h2 id="lib-h" class="font-semibold">Indikator</h2>
        <span class="text-sm ta-muted">{items.length} bisa dipakai</span>
      </div>
      <div class="px-4 pt-4">
        {#if full}
          <button type="button" class="btn btn-primary w-full" disabled><Icon name="plus" size={18} />Indikator baru</button>
          <p class="mt-2 text-xs ta-muted">Slot skrip penuh ({scripts.items.length} dari {scripts.max}). Hapus satu dulu, atau naikkan paket untuk slot lebih banyak.</p>
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
        {#if g.key !== 'published' || g.items.length}
          <p class="ta-group-label"><span>{g.label}</span><span>{g.count || g.items.length}</span></p>
          {#if g.key === 'own' && scripts.error}<p role="alert" class="px-5 text-sm text-error">{scripts.error}</p>{/if}
          <ul class="ta-rows pt-0">
            {#each g.items as i (i.id)}
              {@const run = lab.latest(i.id)}
              {@const v = run ? verdictOf(run) : null}
              {@const n = alertsOf(i).length}
              <li>
                <button type="button" class="ta-row flex-wrap" aria-current={sel?.id === i.id ? 'true' : undefined} onclick={() => pick(i)}>
                  <span class="min-w-40 flex-1">
                    <span class="ta-row-title">{i.name}</span>
                    <span class="ta-row-sub">{i.on ? 'Di chart' : 'Tidak di chart'}{n ? ` · ${n} notifikasi` : ''}</span>
                  </span>
                  <span class="badge badge-soft {v ? v.badge : 'badge-ghost'} shrink-0 gap-1">{#if v}<Icon name={v.icon} size={14} />{/if}{v ? v.word : 'Belum diuji'}</span>
                </button>
              </li>
            {:else}
              <li class="px-3 py-3 text-sm ta-muted">
                {g.key === 'own' ? 'Belum ada. Buat dari template, tempel kode Pine, atau mulai kosong.' : indicators.loaded ? 'Tidak ada indikator bawaan untuk paketmu.' : 'Memuat…'}
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
      <p class="px-5 pb-4 text-xs ta-muted">Indikator buatanmu hanya terlihat olehmu. Admin bisa menerbitkan indikator untuk paket tertentu.</p>
    </section>
  </aside>

  <section class="ta-detail {showDetail ? '' : 'max-lg:hidden'}" aria-labelledby="ind-h">
    <button type="button" class="btn btn-ghost btn-sm w-fit lg:hidden" onclick={() => (showDetail = false)}><Icon name="left" size={16} />Semua indikator</button>
    {#if done}<p class="alert alert-soft alert-success items-start text-sm"><Icon name="check" />{done}</p>{/if}

    {#if !sel}
      <div class="grid place-items-center p-10">
        {#if indicators.loaded}<p class="ta-muted">Belum ada indikator untuk akunmu.</p>{:else}<span class="loading loading-spinner" aria-label="Memuat"></span>{/if}
      </div>
    {:else}
      {@const run = lab.latest(sel.id)}
      {@const v = run ? verdictOf(run) : null}
      {@const passed = !!run?.verdict.pass}
      {@const canTest = testable.has(sel.id)}
      {@const live = sel.engine ? liveOf(sel.engine) : null}
      {@const places = alertPlaces(sel)}
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-3">
          <h2 id="ind-h" class="ta-title">{sel.name}</h2>
          <span class="badge badge-soft {sel.kind === 'own' ? 'badge-accent' : sel.kind === 'published' ? 'badge-info' : 'badge-ghost'}">
            {sel.kind === 'own' ? 'Buatan saya' : sel.kind === 'published' ? 'Dari admin' : 'Bawaan'}
          </span>
        </div>
        {#if sel.kind !== 'own' && sel.description}<p class="max-w-[68ch] text-[1.0625rem] leading-relaxed">{sel.description}</p>{/if}
        <p class="text-sm ta-muted">
          {sel.kind === 'builtin'
            ? 'Indikator bawaan TradingAgents.'
            : sel.kind === 'published'
              ? 'Diterbitkan admin untuk paketmu.'
              : `${sel.script?.pine ? 'Diterjemahkan dari Pine Script · ' : ''}diubah ${day(sel.script!.updatedAt)} · hanya terlihat olehmu`}
        </p>
      </div>

      <section class="flex flex-col gap-3" aria-labelledby="steps-h">
        <h3 id="steps-h" class="ta-section-title">Langkah untuk indikator ini</h3>
        <ol class="ta-compare">
          <li class="ta-cmp" data-key={passed ? undefined : ''}>
            <div class="flex flex-wrap items-center gap-3">
              <span class="ta-step-n" aria-hidden="true">1</span>
              <h4 class="font-semibold">Uji di riwayat</h4>
              <span class="badge badge-soft {v ? v.badge : 'badge-ghost'} ml-auto gap-1">{#if v}<Icon name={v.icon} size={14} />{/if}{v ? v.word : 'Belum diuji'}</span>
            </div>
            <p class="text-sm">
              {#if run}Uji terakhir: {timeframeLabel(run.config.timeframe)} di {joinNames(run.config.symbols.map(name))}, {day(run.createdAt)}. {run.verdict.reason}
              {:else if canTest}Belum pernah diuji. Mulai dari sini: lihat apakah indikator ini untung di riwayat, setelah biaya.
              {:else}Indikator ini belum bisa diuji di Uji indikator.{/if}
            </p>
            {#if run}
              <p>
                {#if run.total.oos.n < 30}<span class="ta-big">{run.total.oos.n}</span> <span class="text-sm ta-muted">dari 30 trade di data uji</span>
                {:else}<span class="ta-big {tone(run.total.oos.net)}">{formatR(run.total.oos.net)}</span> <span class="text-sm ta-muted">per trade di data uji</span>{/if}
              </p>
            {/if}
            {#if run && passed}
              <button type="button" class="btn btn-sm w-fit" onclick={() => openRun(run.id)}>Lihat hasil uji</button>
            {:else if run && canTest}
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary btn-sm" onclick={() => retest(sel)}>Uji dengan pengaturan lain</button>
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => openRun(run.id)}>Lihat hasil uji</button>
              </div>
            {:else if canTest}
              <button type="button" class="btn btn-primary btn-sm w-fit" onclick={() => test(sel)}>Uji indikator ini</button>
            {/if}
          </li>
          <li class="ta-cmp" data-key={passed ? '' : undefined}>
            <div class="flex flex-wrap items-center gap-3">
              <span class="ta-step-n" aria-hidden="true">2</span>
              <h4 class="font-semibold">Pantau sinyal nyata</h4>
            </div>
            <p class="text-sm">
              {#if live}
                Dicatat live untuk semua member: {live.closed} sinyal selesai{live.open ? ` dan ${live.open} berjalan` : ''} dalam {record?.days} hari{live.closed ? `, ${pct(live.winRate)} untung` : ''}.
              {/if}
              {#if places.length}
                {places.length} notifikasi sinyal aktif: {joinNames(places)}. Tiap sinyalnya dinilai di Beranda.
              {:else if !live}
                Belum ada notifikasi untuk indikator ini. Pasang dari menu Notifikasi di chart: tiap sinyal barunya dikabarkan, lalu dinilai di Beranda.
              {/if}
            </p>
            {#if live?.closed}
              <p><span class="ta-big {tone(live.expectancy)}">{formatR(live.expectancy)}</span> <span class="text-sm ta-muted">per sinyal setelah biaya</span></p>
            {/if}
            {#if places.length && !passed}
              <p class="alert alert-soft alert-warning items-start text-sm"><Icon name="alert" size={16} />Uji dulu di riwayat sebelum mengandalkan sinyalnya.</p>
            {/if}
            <div class="flex flex-wrap gap-2">
              {#if places.length}
                <button type="button" class="btn btn-sm {passed ? 'btn-primary' : ''}" onclick={() => ws.setDock('alerts')}><Icon name="bell" size={16} />Atur notifikasi</button>
              {:else}
                <button type="button" class="btn btn-sm {passed ? 'btn-primary' : ''}" onclick={() => toChart(sel)}><Icon name="bell" size={16} />Pasang notifikasi</button>
              {/if}
              {#if live}
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => (pickSource(sel.engine!), ws.setDock('signals'))}>Lihat rekam jejak live</button>
              {/if}
            </div>
          </li>
        </ol>
      </section>

      <section class="ta-card flex items-center gap-4 p-4" aria-label="Tampil di chart">
        <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-base-200"><Icon name="eye" size={20} /></span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="font-semibold">Tampilkan di chart</span>
          <span class="text-sm ta-muted">Sinyalnya muncul di chart Pasar dan Riset AI. Tidak mengubah notifikasi.</span>
        </span>
        <input type="checkbox" class="toggle shrink-0" role="switch" checked={sel.on} onchange={sel.toggle} aria-label="Tampilkan {sel.name} di chart" />
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="manage-h">
        <h3 id="manage-h" class="ta-section-title">Kelola</h3>
        {#if sel.script}
          {@const script = sel.script}
          <div class="ta-card flex flex-col gap-3 p-4">
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-sm" onclick={() => scripts.open(script.id)}><Icon name="code" size={16} />Edit kode</button>
              <button type="button" class="btn btn-sm btn-outline btn-error" onclick={() => askDelete(sel)}><Icon name="trash" size={16} />Hapus indikator</button>
            </div>
            <p class="text-sm ta-muted">
              {places.length ? `Menghapus juga mematikan ${places.length} notifikasi sinyal yang memakainya. ` : ''}Riwayat ujinya tetap tersimpan.
            </p>
          </div>
        {:else}
          <p class="alert alert-soft items-start text-sm">
            <Icon name="lock" size={16} />
            <span>
              {sel.kind === 'published'
                ? 'Diterbitkan admin untuk paketmu. Hanya admin yang bisa menghapusnya, di Konsol admin → Indikator. Kamu bisa menyembunyikannya dengan mematikan Tampilkan di chart.'
                : 'Indikator bawaan tidak bisa dihapus. Matikan Tampilkan di chart untuk menyembunyikannya dari chart-mu; admin bisa menonaktifkannya untuk semua member.'}
              {#if auth.isAdmin}<a class="link link-accent font-medium" href="#/admin/indikator">Buka Konsol admin → Indikator</a>{/if}
            </span>
          </p>
        {/if}
      </section>
    {/if}
  </section>
</div>

<dialog bind:this={dialog} class="modal" aria-labelledby="del-h" aria-describedby="del-d" onclose={() => (deleting = null)}>
  {#if deleting}
    {@const places = alertPlaces(deleting)}
    <div class="modal-box flex flex-col gap-3">
      <h2 id="del-h" class="text-lg font-bold">Hapus “{deleting.name}”?</h2>
      <div id="del-d" class="flex flex-col gap-2 text-sm">
        <p>
          Indikator ini hilang dari chart dan dari pilihan Uji indikator.
          {#if places.length}<strong>{places.length} notifikasi sinyal</strong> yang memakainya ({joinNames(places)}) ikut berhenti.{/if}
        </p>
        <p>Riwayat ujinya tetap tersimpan. Penghapusan ini tidak bisa dibatalkan.</p>
      </div>
      {#if deleteError}<p role="alert" class="text-sm text-error">{deleteError}</p>{/if}
      <div class="modal-action">
        <button type="button" class="btn" onclick={() => dialog?.close()}>Batal</button>
        <button type="button" class="btn btn-error" disabled={busy} onclick={confirmDelete}>
          {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}Hapus indikator
        </button>
      </div>
    </div>
  {/if}
  <form method="dialog" class="modal-backdrop"><button>Tutup</button></form>
</dialog>
