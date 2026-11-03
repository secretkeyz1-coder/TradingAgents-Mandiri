<script lang="ts">
  // The test card on Uji strategi → Indikator (server/src/lab.ts): one card, two tabs. Uji baru tests the indicator
  // picked in the list on a long history with costs, set up in two numbered steps (assets, time) plus the advanced
  // settings, with the day's quota under the button. Riwayat lists the tests, this indicator's or all of them: a
  // row opens its result in the middle, its own button deletes it, and a delete can be undone for a few seconds
  // (stores/lab sends it later). The state lives in stores/lab, so a running test and a half-filled form survive
  // leaving the tab. Its buttons are type="button" and its tabs follow the ARIA tabs pattern (tabKeys).
  import type { LabRunSummary } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { formatDateTime, formatR } from '../../format';
  import { lab, LAB_PERIODS, LAB_TIMEFRAMES, periodLabel, strategyKey, timeframeLabel, verdictOf } from '../../stores/lab.svelte';
  import { usage } from '../../stores/usage.svelte';
  import { CRYPTO_VENUES, toTradingView } from '../../tv';
  import AssetChips from '../AssetChips.svelte';
  import Icon from '../Icon.svelte';
  import { tabKeys } from '../tabKeys';

  let {
    strategy,
    name,
    testable,
    tab = $bindable('baru'),
    onopen,
    onstart,
    onlist,
  }: {
    /** The picked indicator's strategy key (engine:<name>, catalog:<id>, script:<id>). */
    strategy: string;
    name: string;
    /** Whether this account's plan lets Uji test it. */
    testable: boolean;
    tab?: 'baru' | 'riwayat';
    /** A test opened from Riwayat: its indicator gets picked and its result shown in the middle. */
    onopen: (run: LabRunSummary) => void;
    /** A test just started: the middle shows it running. */
    onstart: () => void;
    /** "Ganti": to the list of indicators. */
    onlist: () => void;
  } = $props();

  usage.refresh();

  const TABS = ['baru', 'riwayat'] as const;
  const engine = $derived(strategy.startsWith('engine:') ? lab.meta?.engines[strategy.slice(7)] : null);
  const timeframes = $derived(LAB_TIMEFRAMES.filter((t) => !engine || engine.timeframes.includes(t.value)));
  $effect(() => {
    if (!timeframes.some((t) => t.value === lab.timeframe)) lab.timeframe = timeframes[0].value;
  });
  $effect(() => {
    if (!LAB_PERIODS[lab.timeframe].includes(lab.days)) lab.days = LAB_PERIODS[lab.timeframe].at(-2) ?? LAB_PERIODS[lab.timeframe][0];
  });

  const quota = $derived(usage.value?.lab);
  const left = $derived(quota ? Math.max(0, quota.limit - quota.used) : null);
  const label = (s: string) => friendlyName(toTradingView(s));
  const joinNames = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} dan ${xs.at(-1)}`);
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'ta-up' : x < 0 ? 'ta-down' : '');

  let filter = $state<'ini' | 'semua'>('ini');
  const mine = $derived(lab.shown.filter((r) => strategyKey(r.config.strategy) === strategy));
  const listed = $derived(filter === 'ini' ? mine : lab.shown);
  const runningRow = $derived(lab.busy && lab.running && (filter === 'semua' || strategyKey(lab.running.config.strategy) === strategy) ? lab.running : null);

  function start() {
    lab.strategy = strategy;
    onstart();
    lab.run(name);
  }
</script>

<section class="ta-card" aria-label="Uji indikator">
  <div role="tablist" class="tabs tabs-border px-3" aria-label="Uji">
    {#each TABS as t (t)}
      <button
        type="button"
        role="tab"
        id="lab-tab-{t}"
        data-tab={t}
        class="tab h-12 flex-1 gap-2 font-semibold"
        class:tab-active={tab === t}
        aria-selected={tab === t}
        aria-controls="lab-panel-{t}"
        tabindex={tab === t ? 0 : -1}
        onclick={() => (tab = t)}
        onkeydown={(e) => tabKeys(e, TABS, tab, (k) => (tab = k))}
      >
        {#if t === 'baru'}<Icon name="lab" size={16} />Uji baru{:else}<Icon name="clock" size={16} />Riwayat{#if mine.length}<span class="badge badge-sm tabular-nums">{mine.length}</span>{/if}{/if}
      </button>
    {/each}
  </div>

  {#if tab === 'baru'}
    <div id="lab-panel-baru" role="tabpanel" aria-labelledby="lab-tab-baru" class="flex flex-col gap-4 p-5">
      <p class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-field bg-base-200 px-3 py-2 text-sm">
        <span class="min-w-0">Menguji <b>{name}</b></span>
        <button type="button" class="link link-accent ml-auto font-medium" onclick={onlist}>Ganti</button>
      </p>
      {#if !testable}
        <p class="alert alert-soft alert-warning items-start text-sm"><Icon name="alert" size={16} />Indikator ini belum bisa diuji dengan paketmu. Pilih indikator lain di daftar.</p>
      {:else}
        {#if lab.note}<p class="alert alert-soft alert-info items-start text-sm"><Icon name="info" />{lab.note}</p>{/if}
        <ol class="ta-steps">
          <li class="ta-step">
            <span class="ta-step-n" aria-hidden="true">1</span>
            <span class="ta-step-t" id="lab-assets">Pilih aset</span>
            <div class="ta-step-b" role="group" aria-labelledby="lab-assets">
              <AssetChips bind:symbols={lab.symbols} />
            </div>
          </li>
          <li class="ta-step">
            <span class="ta-step-n" aria-hidden="true">2</span>
            <span class="ta-step-t" id="lab-time">Atur waktu</span>
            <div class="ta-step-b" role="group" aria-labelledby="lab-time">
              <div class="join w-full" role="group" aria-label="Timeframe">
                {#each timeframes as t (t.value)}
                  <button
                    type="button"
                    class="btn btn-sm join-item flex-1 px-1"
                    class:btn-neutral={lab.timeframe === t.value}
                    aria-pressed={lab.timeframe === t.value}
                    onclick={() => (lab.timeframe = t.value)}>{t.label}</button
                  >
                {/each}
              </div>
              <label class="flex items-center justify-between gap-3 text-sm">
                <span class="ta-muted">Periode</span>
                <select class="select select-sm w-auto" bind:value={lab.days}>
                  {#each LAB_PERIODS[lab.timeframe] as d (d)}<option value={d}>{periodLabel(d)}</option>{/each}
                </select>
              </label>
              <p class="text-xs ta-muted">Makin panjang, makin banyak trade yang bisa dinilai.</p>
            </div>
          </li>
        </ol>

        <details class="rounded-field border border-base-300">
          <summary class="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-sm font-medium">
            <Icon name="sliders" size={16} />Pengaturan lanjutan
            <span class="text-xs font-normal ta-muted">
              {lab.costs === 'taker' ? 'order pasar' : 'order limit'} · data uji {Math.round((1 - lab.split) * 100)}% · {lab.expiry} candle · {CRYPTO_VENUES.find((v) => v.id === lab.venue)?.label ??
                lab.venue}
            </span>
          </summary>
          <div class="grid gap-3 border-t border-base-300 p-3 text-sm">
            <label class="flex flex-col gap-1">
              Biaya per trade
              <select class="select select-sm w-full" bind:value={lab.costs} aria-describedby="lab-costs-note">
                <option value="taker">Order pasar (taker)</option>
                <option value="maker">Order limit (maker)</option>
              </select>
            </label>
            <p id="lab-costs-note" class="-mt-2 text-xs ta-muted">
              {lab.costs === 'maker' ? 'Kripto: maker sama dengan taker, 0,2% per trade (fee dasar Binance 0,1% per sisi). ' : ''}Saham IDX: 0,4% per trade untuk order
              pasar maupun limit (fee broker sekitar 0,15% beli dan 0,25% jual, termasuk pajak jual 0,1%).
            </p>
            <label class="flex flex-col gap-1">
              Bagian data uji
              <select class="select select-sm w-full" bind:value={lab.split}>
                <option value={0.8}>20% terakhir</option>
                <option value={0.7}>30% terakhir</option>
                <option value={0.6}>40% terakhir</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              Sinyal kedaluwarsa setelah (candle)
              <input type="number" class="input input-sm w-full" min="4" max="500" bind:value={lab.expiry} />
            </label>
            <label class="flex flex-col gap-1">
              Bursa untuk kripto
              <select class="select select-sm w-full" bind:value={lab.venue}>
                {#each CRYPTO_VENUES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
              </select>
            </label>
          </div>
        </details>

        <div class="flex flex-col gap-2">
          <button type="button" class="btn btn-primary btn-lg w-full" onclick={start} disabled={lab.busy || !lab.symbols.length || left === 0}>
            {#if lab.busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Menguji…{:else}Jalankan uji{/if}
          </button>
          {#if quota}
            <div class="flex justify-between text-sm ta-muted"><span>Sisa uji hari ini</span><span class="tabular-nums">{left} dari {quota.limit}</span></div>
            <progress class="progress progress-primary w-full" value={left} max={quota.limit} aria-label="Sisa uji hari ini: {left} dari {quota.limit}"></progress>
          {/if}
          {#if left === 0}<p class="text-sm text-warning">Jatah uji hari ini sudah terpakai ({quota?.limit} per 24 jam). Coba lagi nanti.</p>{/if}
          {#if lab.busy && lab.running && strategyKey(lab.running.config.strategy) !== strategy}<p class="text-sm ta-muted">Uji {lab.running.name} masih berjalan; satu uji sekaligus.</p>{/if}
          {#if !lab.symbols.length}<p class="text-sm ta-muted">Tambah minimal satu aset di langkah 1.</p>{/if}
          {#if lab.error}<p role="alert" class="text-sm text-error">{lab.error}</p>{/if}
        </div>
      {/if}
    </div>
  {:else}
    <div id="lab-panel-riwayat" role="tabpanel" aria-labelledby="lab-tab-riwayat" class="flex flex-col">
      <div class="px-4 pt-4">
        <div class="join w-full" role="group" aria-label="Uji yang ditampilkan">
          <button type="button" class="btn btn-sm join-item flex-1" class:btn-neutral={filter === 'ini'} aria-pressed={filter === 'ini'} onclick={() => (filter = 'ini')}>
            Indikator ini · {mine.length}
          </button>
          <button type="button" class="btn btn-sm join-item flex-1" class:btn-neutral={filter === 'semua'} aria-pressed={filter === 'semua'} onclick={() => (filter = 'semua')}>
            Semua · {lab.shown.length}
          </button>
        </div>
      </div>
      {#if lab.deleting}
        <div class="mx-4 mt-3 flex items-center gap-3 rounded-field bg-base-200 py-1.5 pr-1.5 pl-3 text-sm" role="status">
          <Icon name="trash" size={16} />
          <span class="min-w-0 flex-1">Uji <b>{lab.deleting.name} · {timeframeLabel(lab.deleting.config.timeframe)}</b> dihapus.</span>
          <button type="button" class="btn btn-sm" onclick={() => lab.undo()}>Urungkan</button>
        </div>
      {/if}
      <ul class="ta-rows">
        {#if runningRow}
          <li>
            <div class="ta-row" aria-current="true">
              <span class="min-w-0 flex-1">
                <span class="ta-row-title">{filter === 'semua' ? `${runningRow.name} · ` : ''}{timeframeLabel(runningRow.config.timeframe)}</span>
                <span class="ta-row-sub">{joinNames(runningRow.config.symbols.map(label))} · baru saja</span>
                <span class="badge badge-soft badge-info mt-1.5 gap-1.5"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Menguji…</span>
              </span>
            </div>
          </li>
        {/if}
        {#each listed as run (run.id)}
          {@const v = verdictOf(run)}
          <li class="flex items-center gap-1">
            <button type="button" class="ta-row min-w-0 flex-1" aria-current={lab.result?.id === run.id ? 'true' : undefined} onclick={() => onopen(run)}>
              <span class="min-w-0 flex-1">
                <span class="ta-row-title">{filter === 'semua' ? `${run.name} · ` : ''}{timeframeLabel(run.config.timeframe)}</span>
                <span class="ta-row-sub">{joinNames(run.config.symbols.map(label))} · {formatDateTime(run.createdAt)}</span>
                <span class="badge badge-soft {v.badge} mt-1.5 gap-1"><Icon name={v.icon} size={14} stroke={2.4} />{v.word}</span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block font-semibold tabular-nums {tone(run.total?.oos.net)}">{formatR(run.total?.oos.net)}</span>
                <span class="ta-row-sub">{run.total?.oos.n ?? 0} trade</span>
              </span>
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-square btn-sm shrink-0 text-base-content/70 hover:text-error"
              aria-label="Hapus uji {run.name}, {timeframeLabel(run.config.timeframe)}, {formatDateTime(run.createdAt)}"
              onclick={() => lab.remove(run)}><Icon name="trash" size={16} /></button
            >
          </li>
        {:else}
          {#if !runningRow}
            <li class="px-3 py-4 text-sm ta-muted">
              {#if !lab.loaded}Memuat…{:else if filter === 'ini'}Belum ada uji untuk indikator ini. Atur di tab Uji baru.{:else}Belum ada uji. Tiap uji yang kamu jalankan tersimpan di sini bersama hasilnya.{/if}
            </li>
          {/if}
        {/each}
      </ul>
      {#if listed.length}
        <p class="px-5 pb-4 text-xs ta-muted">Angka kanan: rata-rata per trade di data uji, setelah biaya. Uji yang dihapus bisa diurungkan selama beberapa detik.</p>
      {/if}
    </div>
  {/if}
</section>
