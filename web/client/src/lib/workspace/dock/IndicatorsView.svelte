<script lang="ts">
  // Uji strategi → Indikator (ADR 0020): every indicator this account can use, listed on the left (IndicatorList),
  // the one picked in the middle and its test card beside it (LabCard: Uji baru and Riwayat). The middle has two
  // tabs. Detail indikator shows its test result (the newest, or the one opened from Riwayat: LabResult), its live
  // signals, and the switch for the Pasar and Riset AI charts or, for one's own script, editing and deleting. Chart
  // pasar draws it alone on any asset (IndicatorChart). Between 64 and 80rem the card sits under the list; a phone
  // shows the list, then the indicator with Uji as a third tab. The indicator picked is the test form's strategy
  // (stores/lab), so a link from Rekam jejak live, a result's "Ubah dan uji ulang" and the card agree on it.
  // Deleting one's own script asks first in a dialog that names what goes with it (the signal notifications using
  // it, server/src/scripts.ts); its tests stay, and Riwayat still opens them under the old name.
  import { tick } from 'svelte';
  import { api, type LabRunSummary, type LedgerRecord, type SignalAlerts } from '../../api';
  import { auth } from '../../auth.svelte';
  import { friendlyName } from '../../beginner/plain';
  import { formatR, TIMEFRAME_NAMES } from '../../format';
  import { announcer } from '../../stores/announcer.svelte';
  import { indicators } from '../../stores/indicators.svelte';
  import { lab, strategyKey, timeframeLabel, verdictOf } from '../../stores/lab.svelte';
  import { scripts } from '../../stores/scripts.svelte';
  import { layoutOf, viewport } from '../../stores/viewport.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { toTradingView } from '../../tv';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';
  import { tabKeys } from '../tabKeys';
  import IndicatorChart from './IndicatorChart.svelte';
  import IndicatorList, { type IndicatorItem } from './IndicatorList.svelte';
  import LabCard from './LabCard.svelte';
  import LabResult from './LabResult.svelte';
  import { pickSource } from './SignalsView.svelte';

  /** Engines Uji tests that the chart's catalog does not describe. */
  const ENGINE_NOTES: Record<string, string> = { donchian: 'Masuk saat harga menembus batas atas atau bawah kanal Donchian.' };
  /** The engines the signal ledger follows live (server/src/ledger.ts). */
  const RECORDED = ['scalper', 'pob', 'fib', 'donchian'];

  indicators.load();
  scripts.load();
  lab.load();

  const items = $derived.by((): IndicatorItem[] => {
    const builtin = indicators.catalog
      .filter((i) => i.builtin)
      .map((i): IndicatorItem => {
        const b = i.builtin!;
        const on = b === 'scalper' ? indicators.scalperOn : b === 'pob' ? indicators.pobOn : indicators.fibOn;
        const toggle = () => (b === 'scalper' ? indicators.toggle() : b === 'pob' ? indicators.togglePob() : indicators.toggleFib());
        return { id: `engine:${b}`, kind: 'builtin', name: i.name, description: i.description, alertKey: b, engine: b, drawable: true, on, toggle, script: null };
      });
    // Engines Uji tests but the chart does not draw (Donchian): still picked and tested here.
    const testedOnly = Object.entries(lab.meta?.engines ?? {})
      .filter(([k]) => !builtin.some((i) => i.engine === k))
      .map(([k, e]): IndicatorItem => ({ id: `engine:${k}`, kind: 'builtin', name: e.label, description: ENGINE_NOTES[k] ?? '', alertKey: null, engine: k, drawable: false, on: false, toggle: () => {}, script: null }));
    const published = indicators.catalog
      .filter((i) => !i.builtin)
      .map(
        (i): IndicatorItem => ({
          id: i.key,
          kind: 'published',
          name: i.name,
          description: i.description,
          alertKey: i.key,
          engine: null,
          drawable: !!i.code,
          on: indicators.catalogIds.includes(i.key),
          toggle: () => indicators.toggleCatalog(i.key),
          script: null,
        }),
      );
    const own = scripts.items.map(
      (s): IndicatorItem => ({
        id: `script:${s.id}`,
        kind: 'own',
        name: s.name,
        description: s.pine ? 'Skrip buatanmu, diterjemahkan dari Pine.' : 'Skrip buatanmu.',
        alertKey: `script:${s.id}`,
        engine: null,
        drawable: true,
        on: indicators.scriptIds.includes(s.id),
        toggle: () => indicators.toggleScript(s.id),
        script: s,
      }),
    );
    return [...builtin, ...testedOnly, ...published, ...own];
  });
  /** What Uji tests for this account (the plan decides the engines and the admin's indicators). */
  const testable = $derived(
    new Set(lab.meta ? [...Object.keys(lab.meta.engines).map((k) => `engine:${k}`), ...lab.meta.catalog.map((c) => `catalog:${c.id}`), ...lab.meta.scripts.map((s) => `script:${s.id}`)] : []),
  );

  /** A test opened from Riwayat; otherwise Detail indikator shows the indicator's newest. */
  let wantRun = $state<string | null>(null);
  /** A test of an indicator no longer on the list (a deleted script), shown under its old name. */
  const ghost = $derived.by((): IndicatorItem | null => {
    const run = lab.shown.find((r) => r.id === wantRun);
    if (!run) return null;
    const key = strategyKey(run.config.strategy);
    if (items.some((i) => i.id === key)) return null;
    const kind = run.config.strategy.kind === 'script' ? 'own' : run.config.strategy.kind === 'catalog' ? 'published' : 'builtin';
    return { id: key, kind, name: run.name, description: 'Indikator ini sudah tidak ada di daftarmu. Riwayat ujinya tetap tersimpan.', alertKey: null, engine: null, drawable: false, on: false, toggle: () => {}, script: null };
  });
  const sel = $derived(ghost ?? items.find((i) => i.id === lab.strategy) ?? items[0] ?? null);

  // --- Panes and tabs. A phone shows the list or the indicator; the test card is its third tab there.
  type Tab = 'detail' | 'chart' | 'uji';
  let pane = $state<'list' | 'detail'>('list');
  let tab = $state<Tab>('detail');
  let ujiTab = $state<'baru' | 'riwayat'>('baru');
  const narrow = $derived(layoutOf(viewport) === 'narrow');
  const TABS = $derived<Tab[]>(narrow ? ['detail', 'chart', 'uji'] : ['detail', 'chart']);
  const shownTab = $derived<Tab>(tab === 'uji' && !narrow ? 'detail' : tab);
  // A phone has three tabs in one row, so the first goes by its short name there.
  const TAB_LABEL = $derived<Record<Tab, string>>({ detail: narrow ? 'Detail' : 'Detail indikator', chart: 'Chart pasar', uji: 'Uji' });
  const TAB_ICON: Record<Tab, IconName> = { detail: 'clipboard', chart: 'chart', uji: 'lab' };
  /** Where the test card is, in words, for the empty states. */
  const cardWhere = $derived(narrow ? 'di tab Uji' : viewport.wide ? 'di kanan' : 'di kiri, di bawah daftar indikator');
  let done = $state('');

  function pick(i: IndicatorItem) {
    lab.strategy = i.id;
    wantRun = null;
    pane = 'detail';
    done = '';
  }
  async function toList() {
    if (narrow) {
      pane = 'list';
      return;
    }
    await tick();
    document.getElementById('ind-search')?.focus();
  }
  /** A result's "Ubah dan uji ulang" put its settings in the form: show the form. */
  async function toForm() {
    ujiTab = 'baru';
    if (narrow) tab = 'uji';
    await tick();
    document.getElementById('lab-panel-baru')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function openRun(run: LabRunSummary) {
    lab.strategy = strategyKey(run.config.strategy);
    wantRun = run.id;
    tab = 'detail';
    pane = 'detail';
  }
  function started() {
    wantRun = null;
    tab = 'detail';
  }
  function added() {
    ujiTab = 'baru';
    if (narrow) tab = 'uji';
    announcer.say(`${friendlyName(ws.symbol)} ditambahkan ke uji ${sel?.name ?? ''}.`);
  }

  // --- The result in Detail indikator: the run wanted, else the indicator's newest, fetched once each.
  const mine = $derived(sel ? lab.shown.filter((r) => strategyKey(r.config.strategy) === sel.id) : []);
  const target = $derived(mine.find((r) => r.id === wantRun)?.id ?? mine[0]?.id ?? null);
  const shown = $derived(lab.result && target && lab.result.id === target ? lab.result : null);
  const runningHere = $derived(lab.busy && !!lab.running && !!sel && strategyKey(lab.running.config.strategy) === sel.id);
  let opening = '';
  $effect(() => {
    // A failed fetch leaves its error on the card instead of being retried in a loop.
    const id = target;
    if (!id || lab.result?.id === id || opening === id) return;
    opening = id;
    lab.open(id);
  });
  function retry() {
    opening = '';
    if (target) lab.open(target);
  }

  // --- Signal notifications and the ledger's live record, for Sinyal nyata.
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
  const alertsOf = (i: IndicatorItem) => (i.alertKey ? (alerts?.items.filter((a) => a.indicator === i.alertKey) ?? []) : []);
  const alertPlaces = (i: IndicatorItem) => alertsOf(i).map((a) => `${friendlyName(a.tvSymbol)}, ${TIMEFRAME_NAMES[a.timeframe] ?? a.timeframe}`);
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
  const joinNames = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} dan ${xs.at(-1)}`);
  const pct = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'ta-up' : x < 0 ? 'ta-down' : '');

  // --- Deleting one's own script: a dialog that names what goes with it.
  let dialog: HTMLDialogElement | undefined = $state();
  let deleting = $state<IndicatorItem | null>(null);
  let busy = $state(false);
  let deleteError = $state('');
  function askDelete(i: IndicatorItem) {
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
      lab.strategy = items.find((x) => x.id !== i.id)?.id ?? '';
      pane = 'list';
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

<div class="ta-ind">
  <div class="ta-ind-list {pane === 'detail' ? 'max-lg:hidden' : ''}">
    {#if done && pane === 'list'}<p class="alert alert-soft alert-success mb-4 items-start text-sm lg:hidden" role="status"><Icon name="check" />{done}</p>{/if}
    <IndicatorList {items} selected={sel?.id ?? null} notifications={(i) => alertsOf(i).length} onpick={pick} />
  </div>

  <section class="ta-ind-main {pane === 'list' ? 'max-lg:hidden' : ''}" aria-labelledby="ind-h">
    <button type="button" class="btn btn-ghost btn-sm w-fit lg:hidden" onclick={() => (pane = 'list')}><Icon name="left" size={16} />Semua indikator</button>
    {#if done}<p class="alert alert-soft alert-success items-start text-sm max-lg:hidden" role="status"><Icon name="check" />{done}</p>{/if}

    {#if !sel}
      <div class="grid place-items-center p-10">
        {#if indicators.loaded}<p class="ta-muted">Belum ada indikator untuk akunmu.</p>{:else}<span class="loading loading-spinner" aria-label="Memuat"></span>{/if}
      </div>
    {:else}
      {@const latest = mine[0]}
      {@const v = latest ? verdictOf(latest) : null}
      {@const places = alertPlaces(sel)}
      {@const live = sel.engine && RECORDED.includes(sel.engine) ? liveOf(sel.engine) : null}
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="ind-h" class="ta-title">{sel.name}</h2>
          <span class="badge badge-soft {sel.kind === 'own' ? 'badge-accent' : sel.kind === 'published' ? 'badge-info' : 'badge-ghost'}">
            {sel.kind === 'own' ? 'Buatan saya' : sel.kind === 'published' ? 'Dari admin' : 'Bawaan'}
          </span>
          <span class="badge badge-soft {v ? v.badge : 'badge-ghost'} gap-1">{#if v}<Icon name={v.icon} size={14} />{/if}{v ? v.word : 'Belum diuji'}</span>
          {#if sel.drawable}
            <!-- The other charts, not Chart pasar below: that one always draws the indicator picked. -->
            <label class="ml-auto flex cursor-pointer items-center gap-2.5 rounded-field border border-base-300 py-1.5 pr-3 pl-2.5">
              <input type="checkbox" class="toggle toggle-sm" checked={sel.on} onchange={sel.toggle} />
              <span class="flex flex-col text-sm leading-tight"><span class="font-semibold">Tampil di chart</span><span class="text-xs ta-muted">Pasar dan Riset AI</span></span>
            </label>
          {/if}
        </div>
        {#if sel.description}<p class="max-w-[68ch] text-[1.0625rem] leading-relaxed ta-muted">{sel.description}</p>{/if}
      </div>

      <div role="tablist" class="tabs tabs-border flex-nowrap overflow-x-auto" aria-label="Bagian indikator">
        {#each TABS as t (t)}
          <button
            type="button"
            role="tab"
            id="ind-tab-{t}"
            data-tab={t}
            class="tab h-12 gap-2 font-semibold"
            class:tab-active={shownTab === t}
            aria-selected={shownTab === t}
            aria-controls="ind-panel-{t}"
            tabindex={shownTab === t ? 0 : -1}
            onclick={() => (tab = t)}
            onkeydown={(e) => tabKeys(e, TABS, shownTab, (k) => (tab = k))}><Icon name={TAB_ICON[t]} size={16} />{TAB_LABEL[t]}</button
          >
        {/each}
      </div>

      {#if shownTab === 'detail'}
        <div id="ind-panel-detail" role="tabpanel" aria-labelledby="ind-tab-detail" class="flex flex-col gap-5">
          {#if runningHere && lab.running}
            <div class="ta-verdict" data-tone="info" role="status">
              <span class="ta-verdict-icon"><span class="loading loading-spinner loading-md" aria-hidden="true"></span></span>
              <p class="ta-verdict-title">Sedang menguji…</p>
              <p class="ta-verdict-reason">{timeframeLabel(lab.running.config.timeframe)} di {joinNames(lab.running.config.symbols.map((s) => friendlyName(toTradingView(s))))}.</p>
              <p class="ta-verdict-note">Biasanya beberapa detik; riwayat panjang bisa 1–2 menit. Boleh pindah tab: hasilnya tersimpan di Riwayat.</p>
            </div>
            <div class="ta-card flex flex-col gap-3 p-5" aria-hidden="true">
              <span class="skeleton h-4 w-2/5"></span>
              <span class="skeleton h-48 w-full"></span>
              <span class="skeleton h-3 w-3/4"></span>
            </div>
          {:else if shown}
            {#key shown.id}<LabResult r={shown} onform={toForm} onlist={toList} />{/key}
          {:else if target}
            {#if lab.error}
              <div role="alert" class="alert alert-soft alert-error items-start text-sm">
                <Icon name="alert" size={16} />
                <span class="flex flex-col gap-2">Hasil uji gagal dimuat: {lab.error}<button type="button" class="btn btn-sm w-fit" onclick={retry}>Coba lagi</button></span>
              </div>
            {:else}
              <div class="ta-card flex flex-col gap-3 p-5" aria-busy="true">
                <span class="sr-only">Memuat hasil uji…</span>
                <span class="skeleton h-24 w-full" aria-hidden="true"></span>
                <span class="skeleton h-4 w-3/5" aria-hidden="true"></span>
                <span class="skeleton h-40 w-full" aria-hidden="true"></span>
              </div>
            {/if}
          {:else}
            <div class="flex flex-col gap-4 rounded-[calc(var(--radius-box)*1.6)] border-[1.5px] border-dashed border-base-300 p-6">
              <div class="flex items-center gap-3">
                <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Icon name="lab" size={22} stroke={2} /></span>
                <h3 class="ta-section-title">Belum pernah diuji</h3>
              </div>
              {#if testable.has(sel.id)}
                <p class="max-w-[62ch] leading-relaxed">
                  Lihat apakah indikator ini untung di riwayat, setelah biaya. Aset dan waktunya sudah terisi pilihan yang umum {cardWhere}; tekan <b>Jalankan uji</b>, biasanya
                  selesai dalam beberapa detik.
                </p>
                <ul class="ta-checks">
                  <li class="ta-check" data-state="skip">
                    <span class="ta-check-mark"><Icon name="check" size={16} /></span>
                    <span><span class="ta-check-title block">Lolos atau tidak lolos</span><span class="block text-sm ta-muted">Tiga syarat yang sama untuk semua indikator, dicek berurutan.</span></span>
                  </li>
                  <li class="ta-check" data-state="skip">
                    <span class="ta-check-mark"><Icon name="info" size={16} /></span>
                    <span><span class="ta-check-title block">Untung atau rugi per trade, setelah biaya</span><span class="block text-sm ta-muted">Dalam R: 1R adalah risiko satu trade, jarak entry ke stop loss.</span></span>
                  </li>
                </ul>
                {#if narrow}<button type="button" class="btn btn-primary w-fit" onclick={() => ((tab = 'uji'), (ujiTab = 'baru'))}><Icon name="lab" size={18} />Atur uji</button>{/if}
              {:else}
                <p class="max-w-[62ch] leading-relaxed">Indikator ini belum bisa diuji dengan paketmu. Lihat sinyalnya di tab Chart pasar.</p>
              {/if}
            </div>
          {/if}

          <div class="grid gap-4 xl:grid-cols-2">
            <section class="ta-card flex flex-col gap-3 p-4" aria-labelledby="ind-live-h">
              <h3 id="ind-live-h" class="flex items-center gap-2 font-semibold"><Icon name="bell" size={18} />Sinyal nyata</h3>
              <p class="text-sm">
                {#if live}
                  Dicatat live untuk semua member: {live.closed} sinyal selesai{live.open ? ` dan ${live.open} berjalan` : ''} dalam {record?.days} hari{live.closed ? `, ${pct(live.winRate)} untung` : ''}.
                {/if}
                {#if places.length}
                  {places.length} notifikasi sinyal aktif: {joinNames(places)}. Tiap sinyalnya dinilai di Beranda.
                {:else if sel.alertKey && sel.drawable}
                  Belum ada notifikasi untuk indikator ini. Pasang dari tombol Notifikasi di Chart pasar: tiap sinyal barunya dikabarkan, lalu dinilai di Beranda.
                {:else if !live}
                  Indikator ini tidak punya notifikasi sinyal.
                {/if}
              </p>
              {#if live?.closed}
                <p><span class="ta-big {tone(live.expectancy)}">{formatR(live.expectancy)}</span> <span class="text-sm ta-muted">per sinyal setelah biaya</span></p>
              {/if}
              {#if places.length && !latest?.verdict.pass}
                <p class="alert alert-soft alert-warning items-start text-sm"><Icon name="alert" size={16} />Uji dulu di riwayat sebelum mengandalkan sinyalnya.</p>
              {/if}
              <div class="flex flex-wrap gap-2">
                {#if places.length}
                  <button type="button" class="btn btn-sm" onclick={() => ws.setDock('alerts')}><Icon name="bell" size={16} />Atur notifikasi</button>
                {:else if sel.alertKey && sel.drawable}
                  <button type="button" class="btn btn-sm" onclick={() => (tab = 'chart')}><Icon name="chart" size={16} />Buka Chart pasar</button>
                {/if}
                {#if live}
                  <button type="button" class="btn btn-ghost btn-sm" onclick={() => (pickSource(sel.engine!), ws.setDock('signals'))}>Lihat rekam jejak live</button>
                {/if}
              </div>
            </section>

            <section class="ta-card flex flex-col gap-3 p-4" aria-labelledby="ind-manage-h">
              <h3 id="ind-manage-h" class="flex items-center gap-2 font-semibold"><Icon name="sliders" size={18} />Kelola</h3>
              {#if sel.drawable}
                <p class="text-sm ta-muted">
                  {sel.on ? 'Tampil di chart Pasar dan Riset AI.' : 'Tidak tampil di chart Pasar dan Riset AI.'} Sakelar Tampil di chart di atas mengubahnya; notifikasi tidak ikut berubah.
                </p>
              {/if}
              {#if sel.script}
                {@const script = sel.script}
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="btn btn-sm" onclick={() => scripts.open(script.id)}><Icon name="code" size={16} />Edit kode</button>
                  <button type="button" class="btn btn-sm btn-outline btn-error" onclick={() => askDelete(sel)}><Icon name="trash" size={16} />Hapus indikator</button>
                </div>
                <p class="text-sm ta-muted">{places.length ? `Menghapus juga mematikan ${places.length} notifikasi sinyal yang memakainya. ` : ''}Riwayat ujinya tetap tersimpan.</p>
              {:else if ghost}
                <p class="text-sm ta-muted">Sudah dihapus. Ujinya tetap bisa dibuka dan dihapus di Riwayat.</p>
              {:else}
                <p class="flex items-start gap-2 text-sm ta-muted">
                  <Icon name="lock" size={16} class="mt-0.5 shrink-0" />
                  <span>
                    {sel.kind === 'published'
                      ? 'Diterbitkan admin untuk paketmu. Hanya admin yang bisa menghapusnya, di Konsol admin → Indikator.'
                      : 'Indikator bawaan tidak bisa dihapus; admin bisa menonaktifkannya untuk semua member.'}
                    {#if auth.isAdmin}<a class="link link-accent font-medium" href="#/admin/indikator">Buka Konsol admin → Indikator</a>{/if}
                  </span>
                </p>
              {/if}
            </section>
          </div>
        </div>
      {:else if shownTab === 'chart'}
        <div id="ind-panel-chart" role="tabpanel" aria-labelledby="ind-tab-chart">
          <IndicatorChart item={sel} testable={testable.has(sel.id)} onadd={added} />
        </div>
      {/if}
    {/if}
  </section>

  <div
    id="ind-panel-uji"
    class="ta-ind-uji {pane === 'list' || (narrow && shownTab !== 'uji') ? 'max-lg:hidden' : ''}"
    role={narrow ? 'tabpanel' : undefined}
    aria-labelledby={narrow ? 'ind-tab-uji' : undefined}
  >
    {#if sel}
      <LabCard strategy={sel.id} name={sel.name} testable={testable.has(sel.id)} bind:tab={ujiTab} onopen={openRun} onstart={started} onlist={toList} />
    {/if}
  </div>
</div>

<dialog bind:this={dialog} class="modal" aria-labelledby="ind-del-h" aria-describedby="ind-del-d" onclose={() => (deleting = null)}>
  {#if deleting}
    {@const places = alertPlaces(deleting)}
    <div class="modal-box flex flex-col gap-3">
      <h2 id="ind-del-h" class="text-lg font-bold">Hapus “{deleting.name}”?</h2>
      <div id="ind-del-d" class="flex flex-col gap-2 text-sm">
        <p>
          Indikator ini hilang dari chart dan dari daftar indikator.
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
