<script module lang="ts">
  /** A strategy Indikator saya asked Uji indikator to open on ("engine:fib", "catalog:<id>", "script:<id>"). */
  let asked = $state<string | null>(null);

  /** Open Uji indikator on this strategy (Indikator saya's "Uji"). */
  export function pickStrategy(key: string) {
    asked = key;
  }
</script>

<script lang="ts">
  // Uji indikator (server/src/lab.ts): test a built-in engine, an indicator the admin published or one
  // of your scripts on a long history with costs, and see whether it holds on the part of the data it was
  // not shaped on. Set up on the left in three numbered steps and run; the result opens on the right
  // (LabResult). The history under the form opens any earlier run in the same place, and a deleted one can
  // be brought back for a few seconds. The state lives in stores/lab, so leaving the tab keeps a running
  // test and its result. A phone shows one side at a time: the form and history, or the open result.
  import { friendlyName } from '../../beginner/plain';
  import { formatDateTime, formatR } from '../../format';
  import { indicators } from '../../stores/indicators.svelte';
  import { lab, LAB_PERIODS, LAB_TIMEFRAMES, periodLabel, timeframeLabel, verdictOf } from '../../stores/lab.svelte';
  import { scripts } from '../../stores/scripts.svelte';
  import { usage } from '../../stores/usage.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { CRYPTO_VENUES, toTradingView } from '../../tv';
  import AssetChips from '../AssetChips.svelte';
  import Icon from '../Icon.svelte';
  import LabResult from './LabResult.svelte';

  /** Engines the chart's catalog does not describe. */
  const ENGINE_NOTES: Record<string, string> = { donchian: 'Masuk saat harga menembus batas atas atau bawah kanal Donchian.' };

  lab.load();
  usage.refresh();
  if (!indicators.loaded) indicators.load();
  scripts.load();

  /** On a phone, the form and history shown over an open result. */
  let showForm = $state(false);

  const meta = $derived(lab.meta);
  const choices = $derived(
    meta ? [...Object.keys(meta.engines).map((k) => `engine:${k}`), ...meta.catalog.map((c) => `catalog:${c.id}`), ...meta.scripts.map((s) => `script:${s.id}`)] : [],
  );
  $effect(() => {
    // One the plan no longer opens (or a removed script) gives way to the first on offer.
    if (choices.length && !choices.includes(lab.strategy)) lab.strategy = choices[0];
  });
  $effect(() => {
    // Indikator saya's "Uji": take the strategy once the list offers it, with the form in view.
    if (asked && choices.includes(asked)) {
      lab.strategy = asked;
      asked = null;
      showForm = true;
    }
  });
  const engine = $derived(lab.strategy.startsWith('engine:') ? meta?.engines[lab.strategy.slice(7)] : null);
  const timeframes = $derived(LAB_TIMEFRAMES.filter((t) => !engine || engine.timeframes.includes(t.value)));
  $effect(() => {
    if (!timeframes.some((t) => t.value === lab.timeframe)) lab.timeframe = timeframes[0].value;
  });
  $effect(() => {
    if (!LAB_PERIODS[lab.timeframe].includes(lab.days)) lab.days = LAB_PERIODS[lab.timeframe].at(-2) ?? LAB_PERIODS[lab.timeframe][0];
  });

  const strategyName = $derived.by(() => {
    const [kind, id] = lab.strategy.split(':');
    if (kind === 'engine') return meta?.engines[id]?.label ?? id;
    if (kind === 'catalog') return meta?.catalog.find((c) => c.id === id)?.name ?? 'Indikator';
    return meta?.scripts.find((s) => s.id === id)?.name ?? 'Skrip';
  });
  const strategyNote = $derived.by(() => {
    const [kind, id] = lab.strategy.split(':');
    if (kind === 'engine') return indicators.catalog.find((c) => c.builtin === id)?.description || ENGINE_NOTES[id] || '';
    if (kind === 'catalog') return indicators.catalog.find((c) => c.key === lab.strategy)?.description || 'Diterbitkan admin untuk paketmu.';
    return scripts.items.find((s) => s.id === id)?.pine ? 'Skrip buatanmu, diterjemahkan dari Pine.' : 'Skrip buatanmu.';
  });

  const quota = $derived(usage.value?.lab);
  const left = $derived(quota ? Math.max(0, quota.limit - quota.used) : null);
  const name = (s: string) => friendlyName(toTradingView(s));
  const joinId = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} dan ${xs.at(-1)}`);
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'ta-up' : x < 0 ? 'ta-down' : '');
  const detailShown = $derived((lab.busy || !!lab.result) && !showForm);

  function start() {
    showForm = false;
    lab.run(strategyName);
  }

  function openRun(id: string) {
    showForm = false;
    lab.open(id);
  }
</script>

<div class="ta-split">
  <aside class="ta-side {detailShown ? 'max-lg:hidden' : ''}" aria-label="Uji baru dan riwayat uji">
    <section class="ta-card p-5" aria-labelledby="lab-new">
      <div class="mb-4 flex items-baseline justify-between gap-2">
        <h2 id="lab-new" class="ta-section-title">Uji baru</h2>
        <span class="text-sm ta-muted">3 langkah, lalu jalankan</span>
      </div>
      {#if lab.note}<p class="alert alert-soft alert-info mb-4 items-start text-sm"><Icon name="info" />{lab.note}</p>{/if}

      <ol class="ta-steps">
        <li class="ta-step">
          <span class="ta-step-n" aria-hidden="true">1</span>
          <label for="lab-strategy" class="ta-step-t">Pilih indikator</label>
          <div class="ta-step-b">
            <select id="lab-strategy" class="select w-full" bind:value={lab.strategy} aria-describedby={strategyNote ? 'lab-strategy-note' : undefined}>
              {#if Object.keys(meta?.engines ?? {}).length}
                <optgroup label="Bawaan">
                  {#each Object.entries(meta?.engines ?? {}) as [key, e] (key)}<option value="engine:{key}">{e.label}</option>{/each}
                </optgroup>
              {/if}
              {#if meta?.catalog.length}
                <optgroup label="Dari admin">
                  {#each meta.catalog as c (c.id)}<option value="catalog:{c.id}">{c.name}</option>{/each}
                </optgroup>
              {/if}
              {#if meta?.scripts.length}
                <optgroup label="Buatan saya">
                  {#each meta.scripts as s (s.id)}<option value="script:{s.id}">{s.name}</option>{/each}
                </optgroup>
              {/if}
            </select>
            {#if strategyNote}<p id="lab-strategy-note" class="text-sm ta-muted">{strategyNote}</p>{/if}
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <button type="button" class="link link-accent font-medium" onclick={() => ws.setDock('library')}>Kelola di Indikator saya</button>
              <button type="button" class="link link-accent font-medium" onclick={() => scripts.open(null)}>Buat indikator baru</button>
            </div>
          </div>
        </li>
        <li class="ta-step">
          <span class="ta-step-n" aria-hidden="true">2</span>
          <span class="ta-step-t" id="lab-assets">Pilih aset</span>
          <div class="ta-step-b" role="group" aria-labelledby="lab-assets">
            <AssetChips bind:symbols={lab.symbols} />
          </div>
        </li>
        <li class="ta-step">
          <span class="ta-step-n" aria-hidden="true">3</span>
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

      <details class="mt-5 rounded-field border border-base-300">
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
            {lab.costs === 'maker' ? 'Kripto: maker sama dengan taker, 0,2% per trade (fee dasar Binance 0,1% per sisi). ' : ''}Saham IDX: 0,4% per trade untuk order pasar
            maupun limit (fee broker sekitar 0,15% beli dan 0,25% jual, termasuk pajak jual 0,1%).
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

      <div class="mt-5 flex flex-col gap-2">
        <button type="button" class="btn btn-primary btn-lg w-full" onclick={start} disabled={lab.busy || !lab.symbols.length || left === 0}>
          {#if lab.busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Menguji…{:else}Jalankan uji{/if}
        </button>
        {#if quota}
          <div class="flex justify-between text-sm ta-muted"><span>Sisa uji hari ini</span><span class="tabular-nums">{left} dari {quota.limit}</span></div>
          <progress class="progress progress-primary w-full" value={left} max={quota.limit} aria-label="Sisa uji hari ini: {left} dari {quota.limit}"></progress>
        {/if}
        {#if left === 0}<p class="text-sm text-warning">Jatah uji hari ini sudah terpakai ({quota?.limit} per 24 jam). Coba lagi nanti.</p>{/if}
        {#if !lab.symbols.length}<p class="text-sm ta-muted">Tambah minimal satu aset di langkah 2.</p>{/if}
        {#if lab.error}<p role="alert" class="text-sm text-error">{lab.error}</p>{/if}
      </div>
    </section>

    <section class="ta-card" aria-labelledby="lab-history">
      <div class="flex items-center justify-between gap-2 border-b border-base-300 px-5 py-3">
        <h2 id="lab-history" class="font-semibold">Riwayat uji</h2>
        {#if lab.shown.length}<span class="text-sm ta-muted">{lab.shown.length} uji</span>{/if}
      </div>
      {#if lab.deleting}
        <div class="flex items-center gap-3 border-b border-base-300 px-5 py-2.5 text-sm">
          <Icon name="trash" size={16} />
          <span class="min-w-0 flex-1">Uji <b>{lab.deleting.name}</b> dihapus.</span>
          <button type="button" class="btn btn-sm" onclick={() => lab.undo()}>Urungkan</button>
        </div>
      {/if}
      <ul class="ta-rows">
        {#if lab.busy && lab.running}
          <li>
            <div class="ta-row" aria-current="true">
              <span class="min-w-0 flex-1">
                <span class="ta-row-title">{lab.running.name} · {timeframeLabel(lab.running.config.timeframe)}</span>
                <span class="ta-row-sub">{joinId(lab.running.config.symbols.map(name))} · baru saja</span>
                <span class="badge badge-soft badge-info mt-1.5 gap-1.5"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Menguji…</span>
              </span>
            </div>
          </li>
        {/if}
        {#each lab.shown as run (run.id)}
          {@const v = verdictOf(run)}
          <li>
            <button type="button" class="ta-row" aria-current={lab.result?.id === run.id ? 'true' : undefined} onclick={() => openRun(run.id)}>
              <span class="min-w-0 flex-1">
                <span class="ta-row-title">{run.name} · {timeframeLabel(run.config.timeframe)}</span>
                <span class="ta-row-sub">{joinId(run.config.symbols.map(name))} · {formatDateTime(run.createdAt)}</span>
                <span class="badge badge-soft {v.badge} mt-1.5 gap-1"><Icon name={v.icon} size={14} stroke={2.4} />{v.word}</span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block font-semibold tabular-nums {tone(run.total?.oos.net)}">{formatR(run.total?.oos.net)}</span>
                <span class="ta-row-sub">{run.total?.oos.n ?? 0} trade</span>
              </span>
            </button>
          </li>
        {:else}
          {#if !lab.busy}
            <li class="px-3 py-4 text-sm ta-muted">{lab.loaded ? 'Belum ada uji. Tiap uji yang kamu jalankan tersimpan di sini bersama hasilnya.' : 'Memuat…'}</li>
          {/if}
        {/each}
      </ul>
      {#if lab.shown.length}<p class="px-5 pb-4 text-xs ta-muted">Angka kanan: rata-rata per trade di data uji, setelah biaya. Buka satu uji untuk menghapusnya.</p>{/if}
    </section>
  </aside>

  <section class="ta-detail {detailShown ? '' : 'max-lg:hidden'}" aria-label="Hasil uji">
    {#if detailShown}
      <button type="button" class="btn btn-ghost btn-sm w-fit lg:hidden" onclick={() => (showForm = true)}><Icon name="left" size={16} />Uji baru dan riwayat</button>
    {/if}
    {#if lab.busy && lab.running}
      <div class="ta-verdict" data-tone="info">
        <span class="ta-verdict-icon"><span class="loading loading-spinner loading-md" aria-hidden="true"></span></span>
        <p class="ta-verdict-title">Sedang menguji…</p>
        <p class="ta-verdict-reason">
          {lab.running.name} · {timeframeLabel(lab.running.config.timeframe)} di {joinId(lab.running.config.symbols.map(name))}, {periodLabel(lab.running.config.days)}.
        </p>
        <p class="ta-verdict-note">Biasanya beberapa detik; riwayat panjang bisa 1–2 menit. Boleh pindah tab: hasilnya tersimpan di Riwayat uji.</p>
      </div>
      <div class="ta-card flex flex-col gap-3 p-5" aria-hidden="true">
        <span class="skeleton h-4 w-2/5"></span>
        <span class="skeleton h-48 w-full"></span>
        <span class="skeleton h-3 w-3/4"></span>
      </div>
    {:else if lab.result}
      {#key lab.result.id}<LabResult r={lab.result} onform={() => (showForm = true)} />{/key}
    {:else}
      <div class="flex flex-col gap-5 rounded-[calc(var(--radius-box)*1.6)] border-[1.5px] border-dashed border-base-300 p-7">
        <div class="flex items-center gap-3">
          <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Icon name="lab" size={22} stroke={2} /></span>
          <h2 class="ta-title">{lab.shown.length ? 'Pilih uji di riwayat' : 'Hasil ujimu muncul di sini'}</h2>
        </div>
        <p class="max-w-[62ch] text-[1.0625rem] leading-relaxed">
          {#if lab.shown.length}
            Buka uji lama dari Riwayat uji, atau atur uji baru di kiri lalu tekan <b>Jalankan uji</b>.
          {:else}
            Langkah 1 sampai 3 di kiri sudah terisi pilihan yang umum dipakai. Tekan <b>Jalankan uji</b> untuk melihat hasil pertamamu, biasanya dalam beberapa detik.
          {/if}
        </p>
        {#if !lab.shown.length}
          <div class="flex flex-col gap-2.5">
            <p class="text-sm font-semibold ta-muted">Yang akan kamu lihat</p>
            <ul class="ta-checks">
              <li class="ta-check" data-state="skip">
                <span class="ta-check-mark"><Icon name="check" size={16} /></span>
                <span><span class="ta-check-title block">Lolos atau tidak lolos</span><span class="block text-sm ta-muted">Tiga syarat yang sama untuk semua indikator, dicek berurutan.</span></span>
              </li>
              <li class="ta-check" data-state="skip">
                <span class="ta-check-mark"><Icon name="info" size={16} /></span>
                <span><span class="ta-check-title block">Untung atau rugi per trade, setelah biaya</span><span class="block text-sm ta-muted">Dalam R: 1R adalah risiko satu trade, jarak entry ke stop loss.</span></span>
              </li>
              <li class="ta-check" data-state="skip">
                <span class="ta-check-mark"><Icon name="signals" size={16} /></span>
                <span><span class="ta-check-title block">Kurva data awal, lalu data uji</span><span class="block text-sm ta-muted">Bagian akhir riwayat yang belum pernah dipakai memeriksa hasilnya.</span></span>
              </li>
            </ul>
          </div>
          <p class="text-sm ta-muted">
            Belum tahu mau menguji apa? <button type="button" class="link link-accent" onclick={() => ws.setDock('library')}>Lihat semua indikator di Indikator saya</button>.
          </p>
        {/if}
      </div>
    {/if}
  </section>
</div>
