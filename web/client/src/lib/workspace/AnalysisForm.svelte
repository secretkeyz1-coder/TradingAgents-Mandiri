<script lang="ts">
  // Start an analysis, or an Uji saran AI (a backtest of the AI's calls), for the symbol in focus. A
  // backtest's assets are chips picked from the asset finder (AssetChips), its frequency is said in
  // words, and what it costs in quota is said before it starts. Members run the standard analysis on
  // the server's models (shared/analysis.ts, server/src/models.ts); an admin's own team, depth,
  // language, provider and models are set in the admin console (stores/analysisSettings) and only
  // named here in one line.
  import { api } from '../api';
  import { auth } from '../auth.svelte';
  import { friendlyName } from '../beginner/plain';
  import { gridDates, today } from '../format';
  import { analysisSettings as adminSettings } from '../stores/analysisSettings.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { usage } from '../stores/usage.svelte';
  import { ws } from '../stores/workspace.svelte';
  import VerifyNote from '../VerifyNote.svelte';
  import { STANDARD_DEPTH, STANDARD_LANGUAGE, standardAnalysts } from '../../../../shared/analysis';
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
        const { id } = await api.create({ ...shared, ticker, date });
        ws.openRun(id, { show: false });
        ws.setDock('log');
      } else {
        const { id } = await api.createBacktest({ ...shared, tickers, start, end, everyNDays });
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
