<script lang="ts">
  // Start an analysis, or an Uji saran AI (a backtest of the AI's calls), for the symbol in focus. A
  // backtest is three numbered steps (assets, dates, the indicators the AI reads) and then what it costs
  // in quota, said before it starts, with a way to fit it: the form opens already fitted to what is left
  // today, so a Free member never arrives at a button that cannot be pressed. Both may name up to three of
  // the account's indicators for the AI to read, computed only from candles up to each analysis date
  // (ADR 0017); the ones on the chart are picked until the user picks otherwise. Members run the standard
  // analysis on the server's models (shared/analysis.ts, server/src/models.ts); an admin's own team,
  // depth, language, provider and models are set in the admin console (stores/analysisSettings) and only
  // named here in one line. The start button is the only thing that starts: it is a plain button, so
  // Enter in a date field or a stray button in the asset picker can never spend the quota.
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
  import Icon from './Icon.svelte';

  /** "2026-11-02" → "Senin, 2 November 2026". */
  const longDate = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  /** `folded`: Riset AI's start (ResearchPreview), where the settings fold to one line above a large start button. */
  let { mode, folded = false }: { mode: 'analysis' | 'backtest'; folded?: boolean } = $props();

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
  /** Folded: whether the settings are open under their one-line summary. */
  let open = $state(false);

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
  const left = $derived(usage.left('analyses'));
  const need = $derived(mode === 'analysis' ? 1 : cellCount);
  const overQuota = $derived(need > left);
  /** The dates that still fit today's quota, at this frequency and for these assets. */
  const fitDates = $derived(Number.isFinite(left) ? Math.floor(left / Math.max(1, tickers.length)) : Infinity);
  const quotaHelp = $derived.by(() => {
    if (!overQuota) return '';
    if (quota && need > quota.limit) return `Paketmu maksimal ${quota.limit} analisa per hari; uji ini butuh ${need}. Jarangkan analisanya atau persempit rentang.`;
    return `Sisa kuota hari ini ${left} analisa; uji ini butuh ${need}. Persempit rentang sekarang, atau tunggu kuota penuh lagi pukul 00.00 WIB.`;
  });
  let fittedNote = $state('');

  /** The latest dates that fit today's quota, keeping the end date and the frequency. */
  function fitToQuota(note: string) {
    if (!Number.isFinite(fitDates) || fitDates < 1) return;
    const last = new Date(`${end}T00:00:00Z`).getTime();
    start = new Date(last - (fitDates - 1) * everyNDays * 86_400_000).toISOString().slice(0, 10);
    fittedNote = note;
  }
  // Opened over today's quota (the 90-day default needs 7 analyses, a Free plan has 2): fit it once, and say so.
  let autoFitted = false;
  $effect(() => {
    if (mode !== 'backtest' || autoFitted || !usage.value) return;
    autoFitted = true;
    if (cellCount > left && fitDates >= 1) fitToQuota('Rentang disesuaikan ke sisa kuotamu hari ini. Perpanjang lagi kalau kuotanya cukup.');
  });

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
  /** The picked indicators by name, for the folded summary. */
  const pickedNames = $derived(choices.filter((c) => picked.includes(c.key)).map((c) => c.name).join(', '));

  function pick(key: string) {
    chosen = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key].slice(0, MAX_READINGS);
  }

  /** What a request carries: an admin's own settings, else the standard analysis (the server also sets a member's models). */
  function settings() {
    const own = adminSettings.value;
    if (auth.isAdmin) return own;
    return { ...own, analysts: standardAnalysts(mode === 'analysis' ? [ticker] : tickers), depth: STANDARD_DEPTH, language: STANDARD_LANGUAGE };
  }

  const blocked = $derived(
    !options ||
      submitting ||
      (auth.isAdmin && adminSettings.analysts.length === 0) ||
      (mode === 'analysis' && !ticker) ||
      (mode === 'backtest' && (cellCount === 0 || cellCount > MAX_CELLS || tickers.length > 5)) ||
      overQuota ||
      auth.unverified,
  );

  async function submit() {
    submitError = '';
    if (blocked) return;
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
      submitError = 'Pilih minimal satu aset dan rentang tanggal yang menghasilkan minimal satu analisa.';
      return;
    }
    submitting = true;
    try {
      if (mode === 'analysis') {
        const { id } = await api.create({ ...shared, ticker, date, ...(reads.length ? { indicators: reads } : {}) });
        // From Riset AI's start the asset was only previewed: opening its run also puts it first among the recent ones.
        ws.openRun(id, { show: false, symbol: folded ? ws.symbol : '' });
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

{#snippet adminLine()}
  <p class="rounded-field border border-base-300 px-3 py-2 text-xs text-base-content/70">
    Pengaturan admin: {adminSettings.providerKey || '…'} · {adminSettings.deepModel || '…'} · {depthLabel} · {adminSettings.language} · {adminSettings.analysts.length} analis.
    <a class="link" href="#/admin/analisa">Ubah di Konsol admin</a>
  </p>
{/snippet}

{#snippet readings()}
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
    <p class="text-xs text-base-content/70">Belum ada indikator. <a class="link" href="#/uji">Buka Indikator</a></p>
  {/if}
{/snippet}

<form class="flex flex-col gap-3" onsubmit={(e) => e.preventDefault()}>
  {#if catalog.error}
    <p role="alert" class="text-sm text-error">
      Opsi analisa gagal dimuat. <button type="button" class="link" onclick={() => catalog.load()}>Coba lagi</button> atau muat ulang halaman.
    </p>
  {/if}

  {#if mode === 'analysis'}
    {#if folded}
      <div class="ta-setsum">
        <Icon name="sliders" size={16} />
        <span><b>{date === today() ? 'Hari ini' : longDate(date)}</b></span>
        <span aria-hidden="true">·</span>
        <span>Indikator <b>{pickedNames || 'standar AI'}</b></span>
        <span aria-hidden="true">·</span>
        <span>Candle <b>{READING_LABELS[readingTf].toLowerCase()}</b></span>
        <button type="button" class="link link-hover ml-auto font-medium text-base-content" aria-expanded={open} aria-controls="analysis-settings" onclick={() => (open = !open)}>
          {open ? 'Tutup' : 'Ubah'}
        </button>
      </div>
    {/if}
    {#if !folded || open}
      <div id="analysis-settings" class="flex flex-col gap-3">
        <label class="fieldset py-0">
          <span class="fieldset-legend pt-0">Tanggal analisa</span>
          <input class="input input-sm w-full" type="date" bind:value={date} max={today()} required />
          <!-- The date field's own format follows the browser's language; this line is always Indonesian. -->
          {#if date}<span class="text-xs text-base-content/70">{longDate(date)}{date === today() ? ' (hari ini)' : ''}</span>{/if}
        </label>
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend pt-0">Indikator yang ikut dibaca AI <span class="font-normal text-base-content/70">(maks {MAX_READINGS})</span></legend>
          {@render readings()}
        </fieldset>
        {#if folded && auth.isAdmin}{@render adminLine()}{/if}
      </div>
    {/if}
  {:else}
    {#if fittedNote}<p class="alert alert-soft alert-info items-start text-sm"><Icon name="info" />{fittedNote}</p>{/if}
    <ol class="ta-steps">
      <li class="ta-step">
        <span class="ta-step-n" aria-hidden="true">1</span>
        <span class="ta-step-t" id="bt-assets">Pilih aset</span>
        <div class="ta-step-b" role="group" aria-labelledby="bt-assets">
          <AssetChips bind:symbols={tickers} />
          <p class="text-xs ta-muted">Tiap aset di tiap tanggal memakai 1 kuota analisa.</p>
        </div>
      </li>
      <li class="ta-step">
        <span class="ta-step-n" aria-hidden="true">2</span>
        <span class="ta-step-t" id="bt-dates">Pilih tanggal</span>
        <div class="ta-step-b" role="group" aria-labelledby="bt-dates">
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1 text-sm">
              <span class="ta-muted">Dari</span>
              <input class="input input-sm w-full" type="date" bind:value={start} max={end} required />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span class="ta-muted">Sampai</span>
              <input class="input input-sm w-full" type="date" bind:value={end} min={start} max={today()} required />
            </label>
          </div>
          <label class="flex items-center justify-between gap-3 text-sm">
            <span class="ta-muted">Seberapa sering</span>
            <select class="select select-sm w-auto" bind:value={everyNDays}>
              {#each EVERY as [n, label] (n)}<option value={n}>{label}</option>{/each}
            </select>
          </label>
          <p class="text-xs ta-muted">{dates} tanggal, dari {longDate(start)} sampai {longDate(end)}.</p>
        </div>
      </li>
      <li class="ta-step">
        <span class="ta-step-n" aria-hidden="true">3</span>
        <span class="ta-step-t" id="bt-reads">Indikator yang dibaca AI</span>
        <div class="ta-step-b" role="group" aria-labelledby="bt-reads" aria-describedby="bt-reads-note">
          <p id="bt-reads-note" class="text-sm ta-muted">Opsional, paling banyak {MAX_READINGS}.</p>
          {@render readings()}
        </div>
      </li>
    </ol>

    <div class="mt-2 flex flex-col gap-2 border-t border-base-300 pt-4">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-semibold tabular-nums">Butuh {cellCount} analisa</span>
        {#if quota && Number.isFinite(left)}<span class="text-sm ta-muted tabular-nums">sisa kuota hari ini {left}</span>{/if}
      </div>
      {#if quota && Number.isFinite(left)}
        <progress class="progress w-full {overQuota ? 'progress-error' : 'progress-success'}" value={Math.min(cellCount, left)} max={Math.max(left, 1)} aria-label="Butuh {cellCount} dari sisa {left} analisa"></progress>
      {/if}
      {#if cellCount > MAX_CELLS}<p class="text-sm text-warning">Satu uji paling banyak {MAX_CELLS} analisa; persempit rentang atau jarangkan analisanya.</p>{/if}
      {#if quotaHelp}
        <p class="alert alert-soft alert-error items-start text-sm"><Icon name="alert" />{quotaHelp}</p>
        {#if fitDates >= 1}
          <button type="button" class="btn btn-sm w-full" onclick={() => fitToQuota(`Rentang disesuaikan: ${Math.min(fitDates, dates)} tanggal terakhir, ${tickers.length} aset.`)}>
            Sesuaikan ke kuota: {fitDates} tanggal terakhir
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if auth.isAdmin && !folded}{@render adminLine()}{/if}

  {#if submitError}
    <p role="alert" class="text-sm text-error">{submitError}</p>
  {/if}

  <button class="btn btn-primary whitespace-nowrap {mode === 'backtest' || folded ? 'btn-lg w-full' : 'btn-sm'}" type="button" onclick={submit} disabled={blocked}>
    {#if submitting}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else if folded}<Icon name="play" />{/if}
    {#if mode === 'analysis'}{folded ? 'Mulai analisa' : 'Analisa'} {ticker ? friendlyName(ws.symbol) : 'simbol ini'}{:else}Mulai uji · {cellCount} analisa{/if}
  </button>
  {#if auth.unverified}
    <VerifyNote />
  {:else if mode === 'analysis' && folded}
    <p class="text-sm tabular-nums" class:text-warning={overQuota}>
      {overQuota
        ? 'Kuota analisa hari ini habis; terisi lagi pukul 00.00 WIB.'
        : Number.isFinite(left)
          ? `Memakai 1 dari ${left} kuota analisa yang tersisa hari ini.`
          : 'Memakai 1 kuota analisa.'}
      <span class="ta-muted">
        {options?.typicalMinutes ? `Biasanya selesai ±${options.typicalMinutes} menit;` : 'Butuh beberapa menit;'} kamu boleh pindah layar, hasilnya muncul di Riwayat.
      </span>
    </p>
  {:else if mode === 'analysis'}
    <p class="text-xs text-base-content/70">
      {options?.typicalMinutes ? `Biasanya selesai dalam ±${options.typicalMinutes} menit.` : 'Butuh beberapa menit.'} Kamu boleh pindah layar; hasilnya muncul di Riwayat.
    </p>
  {/if}
  {#if mode === 'analysis' && !folded && quota?.limit}
    <p class="text-xs tabular-nums" class:text-warning={overQuota} class:text-base-content={!overQuota}>
      Kuota hari ini: {quota.used} / {quota.limit} analisa{#if overQuota}. Tidak cukup untuk {need}; kuota penuh lagi pukul 00.00 WIB.{/if}
    </p>
  {/if}
</form>
