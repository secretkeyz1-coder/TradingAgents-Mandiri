<script lang="ts">
  // Start an analysis, or an Uji saran AI (a backtest of the AI's calls), for the symbol in focus. A
  // backtest's assets are chips picked from the asset finder (AssetChips), its frequency is said in
  // words, and what it costs in quota is said before it starts. Both may name up to three of the
  // account's indicators for the AI to read, computed only from candles up to each analysis date
  // (ADR 0017); the ones on the chart are picked until the user picks otherwise. Members run the
  // standard analysis on the server's models (shared/analysis.ts, server/src/models.ts); an admin's
  // own team, depth, language, provider and models are set in the admin console
  // (stores/analysisSettings) and only named here in one line.
  import { api } from '../api';
  import { auth } from '../auth.svelte';
  import { friendlyName } from '../beginner/plain';
  import { gridDates, today } from '../format';
  import { analysisSettings as adminSettings } from '../stores/analysisSettings.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { indicators } from '../stores/indicators.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { scripts } from '../stores/scripts.svelte';
  import { usage } from '../stores/usage.svelte';
  import { ws } from '../stores/workspace.svelte';
  import VerifyNote from '../VerifyNote.svelte';
  import { STANDARD_DEPTH, STANDARD_LANGUAGE, standardAnalysts } from '../../../../shared/analysis';
  import { MAX_READINGS, READING_TIMEFRAMES, readingTimeframe, type ReadingTimeframe } from '../../../../shared/readings';
  import AssetChips from './AssetChips.svelte';

  /** "2026-11-02" → "Senin, 2 November 2026". */
  const longDate = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  let { mode }: { mode: 'analysis' | 'backtest' } = $props();

  // Must match MAX_BACKTEST_CELLS on the server (default 40).
  const MAX_CELLS = 40;
  /** How often a backtest analyses, in words. */
  const EVERY: [days: number, label: string][] = [
    [1, 'Tiap hari'],
    [3, 'Tiap 3 hari'],
    [7, 'Tiap minggu'],
    [14, 'Tiap 2 minggu'],
    [30, 'Tiap bulan'],
  ];

  let submitting = $state(false);
  let submitError = $state('');

  let date = $state(today());
  // A backtest starts on the asset in focus; more are added as chips.
  let tickers = $state<string[]>(ws.yahoo ? [ws.yahoo] : []);
  let start = $state(new Date(Date.now() - 90 * 86_400_000).toLocaleDateString('en-CA'));
  let end = $state(today());
  let everyNDays = $state(14);

  const options = $derived(catalog.value);
  const ticker = $derived(ws.yahoo ?? '');
  const dates = $derived(gridDates(start, end, everyNDays).length);
  const cellCount = $derived(tickers.length * dates);
  const depthLabel = $derived(options?.depths.find((d) => d.value === adminSettings.depth)?.label ?? '');

  // Every backtest cell is a full analysis, so it counts against the daily cap one by one.
  usage.refresh();
  const quota = $derived(usage.value?.analyses);
  const need = $derived(mode === 'analysis' ? 1 : cellCount);
  const overQuota = $derived(need > usage.left('analyses'));

  $effect(() => {
    if (options) adminSettings.restore(options);
  });

  const READING_LABELS: Record<ReadingTimeframe, string> = { '15m': '15 menit', '1h': '1 jam', '1d': 'Harian' };
  if (!indicators.loaded) indicators.load();
  scripts.load();

  /** Every indicator the account can use: the built-ins and published ones (the admin's catalog), then its own scripts. */
  const choices = $derived([
    ...indicators.catalog.map((c) => ({ key: c.key, name: c.name })),
    ...scripts.items.map((s) => ({ key: `script:${s.id}`, name: s.name })),
  ]);
  /** What the chart shows now: what the AI reads until the user picks otherwise. */
  const onChart = $derived(
    [
      indicators.scalperOn && 'scalper',
      indicators.pobOn && 'pob',
      indicators.fibOn && 'fib',
      ...indicators.catalogIds,
      ...indicators.scriptIds.map((id) => `script:${id}`),
    ]
      .filter((k): k is string => !!k && choices.some((c) => c.key === k))
      .slice(0, MAX_READINGS),
  );
  let chosen = $state<string[] | null>(null);
  const picked = $derived(chosen ?? onChart);
  /** An analysis reads the chart's timeframe until the user picks one; a backtest spans months, so daily bars. */
  let chosenTimeframe = $state<ReadingTimeframe | null>(null);
  const readingTf = $derived(
    chosenTimeframe ?? (mode === 'analysis' && (READING_TIMEFRAMES as readonly string[]).includes(ws.timeframe) ? (ws.timeframe as ReadingTimeframe) : '1d'),
  );
  /** An admin whose own team leaves out the Market Analyst: nobody would read them. */
  const unread = $derived(auth.isAdmin && !adminSettings.analysts.includes('market'));
  const reads = $derived(unread ? [] : picked.map((key) => ({ key, timeframe: readingTimeframe(key, readingTf) })));
  const readingNote = $derived.by(() => {
    if (!picked.length) return 'Tanpa indikator pilihan, AI memakai indikator standarnya saja (RSI, MACD, rata-rata bergerak).';
    const pob = picked.includes('pob') && readingTf === '1d' ? ' PoB BYSTRA dibaca dari candle 1 jam.' : '';
    if (mode === 'analysis') return `AI membaca sinyal dan level indikator ini sampai tanggal analisa.${pob}`;
    const short = readingTf === '15m' ? ' Candle 15 menit saham hanya ada sekitar sebulan terakhir; tanggal yang lebih lama dibaca tanpa indikator itu.' : '';
    return `Di tiap tanggal uji, indikator dihitung hanya dari candle sampai tanggal itu, jadi AI tidak melihat data sesudahnya.${pob}${short}`;
  });

  function pick(key: string) {
    chosen = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key].slice(0, MAX_READINGS);
  }

  /** What a request carries: an admin's own settings, else the standard analysis (the server also sets a member's models). */
  function settings() {
    const own = adminSettings.value;
    if (auth.isAdmin) return own;
    return { ...own, analysts: standardAnalysts(mode === 'analysis' ? [ticker] : tickers), depth: STANDARD_DEPTH, language: STANDARD_LANGUAGE };
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    submitError = '';
    const shared = settings();
    if (!shared.quickModel || !shared.deepModel) {
      submitError = auth.isAdmin ? 'Model analisa belum diatur. Atur di Konsol admin → Pengaturan analisa.' : 'Pilihan model belum termuat. Muat ulang halaman.';
      return;
    }
    if (mode === 'analysis' && !ticker) {
      submitError = 'Simbol ini belum bisa dianalisa engine.';
      return;
    }
    if (mode === 'backtest' && (tickers.length === 0 || cellCount === 0)) {
      submitError = 'Isi ticker dan rentang tanggal yang menghasilkan minimal satu sel.';
      return;
    }
    submitting = true;
    try {
      if (mode === 'analysis') {
        const { id } = await api.create({ ...shared, ticker, date, ...(reads.length ? { indicators: reads } : {}) });
        ws.openRun(id, { show: false });
        ws.setDock('log');
      } else {
        const { id } = await api.createBacktest({ ...shared, tickers, start, end, everyNDays, ...(reads.length ? { indicators: reads } : {}) });
        ws.openBacktest(id);
      }
      jobs.refresh();
      usage.refresh();
    } catch (e) {
      submitError = (e as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<form class="flex flex-col gap-3" onsubmit={submit}>
  {#if catalog.error}
    <p role="alert" class="text-sm text-error">Opsi model gagal dimuat: {catalog.error}</p>
  {/if}

  {#if mode === 'analysis'}
    <fieldset class="fieldset py-0">
      <legend class="fieldset-legend pt-0">Tanggal analisa</legend>
      <input class="input input-sm w-full" type="date" bind:value={date} max={today()} required />
      <!-- The date field's own format follows the browser's language; this line is always Indonesian. -->
      {#if date}<span class="text-xs text-base-content/70">{longDate(date)}{date === today() ? ' (hari ini)' : ''}</span>{/if}
    </fieldset>
  {:else}
    <fieldset class="fieldset py-0">
      <legend class="fieldset-legend pt-0">Aset (maks 5)</legend>
      <AssetChips bind:symbols={tickers} />
    </fieldset>
    <div class="grid grid-cols-2 gap-2">
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Dari</legend>
        <input class="input input-sm w-full" type="date" bind:value={start} max={end} required />
      </fieldset>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Sampai</legend>
        <input class="input input-sm w-full" type="date" bind:value={end} min={start} max={today()} required />
      </fieldset>
    </div>
    <fieldset class="fieldset py-0">
      <legend class="fieldset-legend pt-0">Seberapa sering dianalisa</legend>
      <select class="select select-sm w-full" bind:value={everyNDays}>
        {#each EVERY as [n, label] (n)}<option value={n}>{label}</option>{/each}
      </select>
    </fieldset>
    <p class="text-xs tabular-nums" class:text-warning={cellCount > MAX_CELLS} class:text-base-content={cellCount <= MAX_CELLS}>
      <strong>{cellCount} analisa</strong> = {tickers.length} aset × {dates} tanggal.
      {#if cellCount > MAX_CELLS}Batas {MAX_CELLS}; persempit rentang atau jarangkan analisanya.{:else}Tiap analisa memakai 1 kuota analisa AI.{/if}
    </p>
  {/if}

  <fieldset class="fieldset py-0">
    <legend class="fieldset-legend pt-0">Indikator yang ikut dibaca AI <span class="font-normal text-base-content/70">(maks {MAX_READINGS})</span></legend>
    {#if unread}
      <p class="text-xs text-base-content/70">
        Market Analyst sedang mati di <a class="link" href="#/admin/analisa">Pengaturan analisa</a>, jadi tidak ada yang membaca indikator.
      </p>
    {:else if choices.length}
      <div class="flex flex-wrap gap-1.5">
        {#each choices as c (c.key)}
          {@const on = picked.includes(c.key)}
          <label class="flex cursor-pointer items-center gap-1.5 rounded-field border px-2 py-1 text-sm {on ? 'border-primary' : 'border-base-300'}">
            <input type="checkbox" class="checkbox checkbox-xs" checked={on} disabled={!on && picked.length >= MAX_READINGS} onchange={() => pick(c.key)} />
            {c.name}
          </label>
        {/each}
      </div>
      <label class="flex items-center gap-2 text-xs">
        Dihitung dari candle
        <select class="select select-xs w-auto" value={readingTf} onchange={(e) => (chosenTimeframe = e.currentTarget.value as ReadingTimeframe)}>
          {#each READING_TIMEFRAMES as tf (tf)}<option value={tf}>{READING_LABELS[tf]}</option>{/each}
        </select>
      </label>
      <span class="text-xs text-base-content/70">{readingNote}</span>
    {:else}
      <p class="text-xs text-base-content/70">Belum ada indikator. <a class="link" href="#/uji?dock=library">Buka Indikator saya</a></p>
    {/if}
  </fieldset>

  {#if auth.isAdmin}
    <p class="rounded-field border border-base-300 px-3 py-2 text-xs text-base-content/70">
      Pengaturan admin: {adminSettings.providerKey || '…'} · {adminSettings.deepModel || '…'} · {depthLabel} · {adminSettings.language} · {adminSettings.analysts.length} analis.
      <a class="link" href="#/admin/analisa">Ubah di Konsol admin</a>
    </p>
  {/if}

  {#if submitError}
    <p role="alert" class="text-sm text-error">{submitError}</p>
  {/if}

  <button
    class="btn btn-primary btn-sm whitespace-nowrap"
    type="submit"
    disabled={!options ||
      submitting ||
      (auth.isAdmin && adminSettings.analysts.length === 0) ||
      (mode === 'analysis' && !ticker) ||
      (mode === 'backtest' && (cellCount === 0 || cellCount > MAX_CELLS || tickers.length > 5)) ||
      overQuota ||
      auth.unverified}
  >
    {#if submitting}<span class="loading loading-spinner loading-xs"></span>{/if}
    {#if mode === 'analysis'}Analisa {ticker ? friendlyName(ws.symbol) : 'simbol ini'}{:else}Mulai uji · {cellCount} analisa{/if}
  </button>
  {#if auth.unverified}
    <VerifyNote />
  {:else if mode === 'analysis'}
    <p class="text-xs text-base-content/70">
      {options?.typicalMinutes ? `Biasanya selesai dalam ±${options.typicalMinutes} menit.` : 'Butuh beberapa menit.'} Kamu boleh pindah layar; hasilnya muncul di Riwayat.
    </p>
  {/if}
  {#if quota?.limit}
    <p class="text-xs tabular-nums" class:text-warning={overQuota} class:text-base-content={!overQuota}>
      Kuota hari ini: {quota.used} / {quota.limit} analisa{#if overQuota}. Tidak cukup untuk {need}; reset pukul 00.00 WIB.{/if}
    </p>
  {/if}
</form>
