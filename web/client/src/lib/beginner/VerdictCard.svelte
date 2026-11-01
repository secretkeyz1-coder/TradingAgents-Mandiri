<script lang="ts">
  // One answer for the asset in focus, in plain words (server/src/routes.ts /verdict):
  // the user's latest analysis of it, else the daily AI brief's view, else a button
  // that runs a standard analysis on the day's quota. While one runs for this asset
  // the card says so, and shows the result once the history (jobs store) has it.
  import { api, type Verdict } from '../api';
  import { formatDateTime, formatDuration, today } from '../format';
  import { catalog } from '../stores/catalog.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { usage } from '../stores/usage.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { hasNoFundamentals } from '../tv';
  import { biasLean, friendlyName, ratingLean, toneOf, type Lean } from './plain';

  let verdict = $state<Verdict | undefined>(undefined);
  let error = $state('');
  let busy = $state(false);
  let loadedFor = '';
  let ticket = 0;

  const name = $derived(friendlyName(ws.symbol));
  const running = $derived(
    jobs.analyses.find((a) => a.kind === 'analysis' && a.ticker === ws.yahoo && (a.status === 'queued' || a.status === 'running')) ?? null,
  );
  // A string, so a history refresh that changes nothing does not reload the card.
  const runningId = $derived(running?.id ?? null);
  // The history is newest first: the latest run for this asset, when it failed.
  const failed = $derived.by(() => {
    const latest = jobs.analyses.find((a) => a.kind === 'analysis' && a.ticker === ws.yahoo);
    return latest?.status === 'failed' ? latest : null;
  });
  const left = $derived(usage.left('analyses'));
  const lean = $derived<Lean | null>(
    verdict?.source === 'analysis' ? ratingLean(verdict.rating) : verdict?.source === 'brief' ? biasLean(verdict.bias) : null,
  );

  // Load for the asset in focus, and again when a run for it starts or ends.
  $effect(() => {
    const ticker = ws.yahoo;
    void runningId;
    load(ticker);
  });

  async function load(ticker: string | null) {
    const mine = ++ticket;
    if (ticker !== loadedFor) verdict = undefined;
    loadedFor = ticker ?? '';
    error = '';
    if (!ticker) return;
    try {
      const v = await api.verdict(ticker);
      if (mine === ticket) verdict = v;
    } catch (e) {
      if (mine === ticket) error = (e as Error).message;
    }
  }

  // Ticks the elapsed time while a run is going.
  let now = $state(Date.now());
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  /** A standard analysis on the server's models: every analyst that has something to read, depth 1, in Indonesian. */
  async function ask() {
    const ticker = ws.yahoo;
    const d = catalog.value?.defaults;
    if (!ticker || !d) return;
    busy = true;
    error = '';
    try {
      await api.create({
        ticker,
        date: today(),
        analysts: ['market', 'social', 'news', ...(hasNoFundamentals(ticker) ? [] : ['fundamentals'])],
        depth: 1,
        language: 'Indonesian',
        provider: d.provider,
        quickModel: d.quickModel,
        deepModel: d.deepModel,
        backendUrl: d.backendUrl ?? undefined,
      });
      await jobs.refresh();
      usage.refresh();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const ICON: Record<Lean['direction'], string> = { 1: 'M7 17 17 7M8 7h9v9', 0: 'M5 12h14', [-1]: 'M7 7l10 10M17 8v9H8' };
  const BACKDROP: Record<Lean['direction'], string> = { 1: 'bg-success/10', 0: 'bg-base-200', [-1]: 'bg-error/10' };
</script>

<section class="flex flex-col gap-3 rounded-box border border-base-300 p-4" aria-labelledby="verdict-title">
  <div class="flex items-baseline justify-between gap-2">
    <h2 id="verdict-title" class="text-base font-semibold">Saran AI</h2>
    <span class="text-xs text-base-content/70">Riset otomatis, bukan saran investasi</span>
  </div>

  {#if !ws.yahoo}
    <p class="text-sm text-base-content/70">AI belum bisa menganalisa aset ini. Coba aset lain, misalnya Emas atau Bank Central Asia.</p>
  {:else if running}
    <div class="flex items-start gap-3" role="status">
      <span class="loading loading-dots loading-md mt-0.5 text-primary" aria-hidden="true"></span>
      <div class="flex flex-col gap-1">
        <p class="font-medium">AI sedang menganalisa {name}…</p>
        <p class="text-sm text-base-content/70">
          Butuh beberapa menit. Sudah berjalan {formatDuration(running.createdAt, new Date(now).toISOString())}. Kamu boleh pindah ke aset lain; hasilnya muncul di sini.
        </p>
      </div>
    </div>
  {:else if verdict === undefined && !error}
    <div class="flex flex-col gap-2" aria-busy="true">
      <div class="skeleton h-7 w-40"></div>
      <div class="skeleton h-4 w-full"></div>
      <div class="skeleton h-4 w-2/3"></div>
    </div>
  {:else if verdict && lean}
    <div class="flex items-start gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-full {BACKDROP[lean.direction]} {toneOf(lean.direction)}" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d={ICON[lean.direction]} /></svg>
      </span>
      <div class="flex min-w-0 flex-col gap-0.5">
        <p class="text-2xl font-semibold tracking-tight {toneOf(lean.direction)}">{lean.label}</p>
        <p class="text-sm">{lean.hint}</p>
      </div>
    </div>

    {#if verdict.source === 'analysis'}
      {#if verdict.summary}<p class="text-sm leading-relaxed">{verdict.summary}</p>{/if}
      <p class="text-xs text-base-content/70">
        Dari analisa AI untuk tanggal {new Date(`${verdict.date}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}{verdict.at
          ? `, selesai ${formatDateTime(verdict.at)}`
          : ''}.
      </p>
    {:else}
      <dl class="flex flex-col gap-2 text-sm">
        <div><dt class="font-medium">Alasan bisa naik</dt><dd class="text-base-content/80">{verdict.bull}</dd></div>
        <div><dt class="font-medium">Risiko bisa turun</dt><dd class="text-base-content/80">{verdict.bear}</dd></div>
        <div><dt class="font-medium">Yang perlu dipantau</dt><dd class="text-base-content/80">{verdict.watch}</dd></div>
      </dl>
      <p class="text-xs text-base-content/70">Dari ringkasan pasar AI, {formatDateTime(verdict.at)}. Untuk saran khusus {name}, minta analisa lengkap.</p>
    {/if}
  {:else if !error}
    <div class="flex flex-col gap-1">
      <p class="font-medium">Belum ada saran AI untuk {name}.</p>
      <p class="text-sm text-base-content/70">AI membaca harga, berita, dan sentimen pasar, lalu menyimpulkan satu saran dalam beberapa menit.</p>
    </div>
  {/if}

  {#if failed && !running}
    <p role="alert" class="text-sm text-error">Analisa terakhir ({formatDateTime(failed.createdAt)}) gagal. Coba minta lagi.</p>
  {/if}
  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}

  {#if ws.yahoo && !running && verdict !== undefined}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        class="btn btn-sm"
        class:btn-primary={!verdict || verdict.source === 'brief'}
        disabled={busy || !catalog.value || left === 0}
        onclick={ask}
      >
        {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
        {!verdict ? 'Minta saran AI' : verdict.source === 'brief' ? 'Minta analisa lengkap' : 'Minta saran baru'}
      </button>
      {#if verdict?.source === 'analysis' && verdict.hasReport}
        <a class="btn btn-ghost btn-sm" href={api.reportUrl(verdict.id)} target="_blank" rel="noopener">Baca laporan lengkap</a>
      {/if}
      <span class="text-xs text-base-content/70">
        {left === 0 ? 'Jatah analisa hari ini habis; terisi lagi pukul 00.00 WIB.' : Number.isFinite(left) ? `Memakai 1 dari ${left} jatah analisa tersisa hari ini.` : 'Memakai 1 jatah analisa.'}
      </span>
    </div>
  {/if}
</section>
