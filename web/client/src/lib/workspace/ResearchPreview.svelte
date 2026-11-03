<script lang="ts">
  // Riset AI's start, its right column (ADR 0019): the asset picked on the left, as the AI sees it. Its price and
  // chart with the AI's past calls marked (AssetView, the one Pemula shows), the latest call in words (/verdict),
  // its own research history, and the one place to start: a full analysis (AnalysisForm, folded to one line of
  // settings) or a question to the agent, which opens the chart with the AI panel on the answer.
  import { api, type Verdict } from '../api';
  import { auth } from '../auth.svelte';
  import AssetView from '../beginner/AssetView.svelte';
  import { biasLean, friendlyName, questionsFor, ratingLean } from '../beginner/plain';
  import { formatDateTime, formatDay, formatDuration, readIndicators, STATUS_LABELS } from '../format';
  import { callOf } from '../marks';
  import { agent } from '../stores/agent.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { usage } from '../stores/usage.svelte';
  import { ws } from '../stores/workspace.svelte';
  import VerifyNote from '../VerifyNote.svelte';
  import AnalysisForm from './AnalysisForm.svelte';
  import Icon from './Icon.svelte';

  const TONE = { 1: 'pass', 0: 'info', [-1]: 'loss' } as const;
  const ICON = { 1: 'arrowUp', 0: 'minus', [-1]: 'arrowDown' } as const;
  /** "2026-11-02" → "Senin, 2 November 2026". */
  const longDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  usage.refresh();

  let choice = $state<'analysis' | 'chat'>('analysis');
  let question = $state('');
  let verdict = $state<Verdict | undefined>(undefined);
  let verdictError = $state('');
  let ticket = 0;

  const name = $derived(friendlyName(ws.symbol));
  /** This asset's analyses, newest first. */
  const mine = $derived(ws.yahoo ? jobs.analyses.filter((a) => a.kind === 'analysis' && a.ticker === ws.yahoo) : []);
  const running = $derived(mine.find((a) => a.status === 'queued' || a.status === 'running') ?? null);
  // A string, so a history refresh that changes nothing does not reload the call.
  const runningId = $derived(running?.id ?? null);
  const failed = $derived(mine[0]?.status === 'failed' ? mine[0] : null);
  const marks = $derived(
    mine
      .filter((a) => a.status === 'completed' && a.rating)
      .slice(0, 12)
      .map((a) => {
        const lean = ratingLean(a.rating);
        return { day: a.tradeDate, dir: lean.direction, text: lean.label };
      }),
  );
  const lean = $derived(verdict?.source === 'analysis' ? ratingLean(verdict.rating) : verdict?.source === 'brief' ? biasLean(verdict.bias) : null);
  const chatLeft = $derived(usage.left('chat'));
  const canAsk = $derived(!!ws.yahoo && !auth.unverified && chatLeft !== 0 && !agent.sending);
  const chatNote = $derived(
    chatLeft === 0 ? 'Kuota tanya hari ini habis; terisi lagi pukul 00.00 WIB.' : Number.isFinite(chatLeft) ? `Tiap pesan memakai 1 kuota tanya; sisa ${chatLeft} hari ini.` : 'Tiap pesan memakai 1 kuota tanya.',
  );

  // The latest call on the asset in focus, and again when a run for it starts or ends.
  $effect(() => {
    const ticker = ws.yahoo;
    void runningId;
    load(ticker);
  });

  async function load(ticker: string | null) {
    const t = ++ticket;
    verdict = undefined;
    verdictError = '';
    if (!ticker) return;
    try {
      const v = await api.verdict(ticker);
      if (t === ticket) verdict = v;
    } catch (e) {
      if (t === ticket) verdictError = (e as Error).message;
    }
  }

  // Ticks the elapsed time while a run is going.
  let now = $state(Date.now());
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  /** A question to the agent: the chart opens with the AI panel on its answer. */
  function ask(text: string) {
    const message = text.trim();
    if (!message || !canAsk) return;
    ws.research(ws.symbol);
    ws.setAiMode('chat');
    agent.send(message);
    question = '';
  }

  function askAbout(label: string) {
    choice = 'chat';
    question = `Kenapa keputusan AI terakhir untuk ${name} "${label}"? Apa yang bisa mengubahnya?`;
  }

  function openLog(id: string) {
    ws.openRun(id, { symbol: ws.symbol });
    ws.setDock('log');
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  <div class="ta-card p-4 sm:p-5">
    <AssetView heading="h2" {marks}>
      {#snippet actions()}
        <button type="button" class="btn btn-sm gap-1.5" onclick={() => ws.research(ws.symbol)}><Icon name="chart" size={16} />Buka chart lengkap</button>
      {/snippet}
    </AssetView>
  </div>

  {#if !ws.yahoo}
    <p class="ta-card p-5 text-sm">AI belum bisa meriset {name}. Pilih aset lain di daftar, misalnya Emas atau Bank Central Asia.</p>
  {:else}
    <div class="ta-research-two">
      <section class="ta-card flex flex-col gap-3 p-5 [grid-area:verdict]" aria-labelledby="verdict-title">
        <h3 id="verdict-title" class="ta-section-title">Keputusan AI terakhir</h3>
        {#if verdict === undefined && !verdictError}
          <div class="flex flex-col gap-2" aria-busy="true">
            <div class="skeleton h-24 w-full"></div>
            <div class="skeleton h-4 w-2/3"></div>
          </div>
        {:else if verdict && lean}
          {@const v = verdict}
          {@const l = lean}
          <div class="ta-verdict" data-tone={TONE[l.direction]}>
            <span class="ta-verdict-icon"><Icon name={ICON[l.direction]} size={26} stroke={2.2} /></span>
            <p class="ta-verdict-title">{l.label}</p>
            <p class="ta-verdict-note">{v.source === 'analysis' ? `Analisa lengkap untuk ${longDay(v.date)}` : `Dari ringkasan pasar AI, ${formatDateTime(v.at)}`}</p>
            <p class="ta-verdict-reason line-clamp-5 text-base">{v.source === 'analysis' ? v.summary || l.hint : l.hint}</p>
          </div>
          {#if v.source === 'brief'}
            <dl class="flex flex-col gap-2 text-sm">
              <div><dt class="font-medium">Alasan bisa naik</dt><dd class="ta-muted">{v.bull}</dd></div>
              <div><dt class="font-medium">Risiko bisa turun</dt><dd class="ta-muted">{v.bear}</dd></div>
              <div><dt class="font-medium">Yang perlu dipantau</dt><dd class="ta-muted">{v.watch}</dd></div>
            </dl>
          {/if}
          <div class="flex flex-wrap gap-2">
            {#if v.source === 'analysis'}
              <button type="button" class="btn btn-sm" onclick={() => ws.openRun(v.id, { symbol: ws.symbol })}>Baca laporan lengkap</button>
            {/if}
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => askAbout(l.label)}>Tanya soal keputusan ini</button>
          </div>
        {:else if verdictError}
          <p role="alert" class="text-sm text-error">Keputusan terakhir belum bisa dimuat. <button type="button" class="link" onclick={() => load(ws.yahoo)}>Coba lagi</button></p>
        {:else}
          <div class="flex flex-col gap-1 rounded-box border-[1.5px] border-dashed border-base-300 p-4">
            <p class="font-semibold">Belum pernah diriset</p>
            <p class="text-sm ta-muted">Analisa pertama untuk {name} memakai 1 kuota dan selesai dalam beberapa menit.</p>
          </div>
        {/if}
        {#if failed && !running}
          <p class="ta-flag" role="status">
            <Icon name="alert" size={16} />
            <span class="min-w-0 flex-1">Analisa terakhir ({formatDateTime(failed.createdAt)}) gagal sebelum selesai.</span>
            <button type="button" class="link" onclick={() => openLog(failed.id)}>Lihat log</button>
          </p>
        {/if}
      </section>

      <section class="ta-card flex flex-col gap-4 p-5 [grid-area:start]" aria-labelledby="start-title">
        <div class="flex items-center gap-3">
          <span class="ta-step-n" aria-hidden="true">2</span>
          <h3 id="start-title" class="ta-section-title">Mulai riset {name}</h3>
        </div>
        {#if running}
          <div class="ta-flag" data-tone="info" role="status">
            <span class="loading loading-dots loading-sm text-info" aria-hidden="true"></span>
            <span class="min-w-0 flex-1">AI sedang menganalisa {name}, sudah {formatDuration(running.createdAt, new Date(now).toISOString())}.</span>
            <button type="button" class="btn btn-sm" onclick={() => ws.openRun(running.id, { symbol: ws.symbol })}>Ikuti analisanya</button>
          </div>
        {/if}
        <div class="flex flex-col gap-2" role="group" aria-label="Cara riset">
          <button type="button" class="ta-choice" aria-pressed={choice === 'analysis'} onclick={() => (choice = 'analysis')}>
            <span class="ta-choice-icon"><Icon name="ai" /></span>
            <span class="min-w-0">
              <span class="ta-nx-title">Analisa lengkap</span>
              <span class="ta-nx-sub">Tim analis AI membaca harga, berita, dan sentimen, lalu memutuskan beserta alasannya. Memakai 1 kuota analisa.</span>
            </span>
          </button>
          <button type="button" class="ta-choice" aria-pressed={choice === 'chat'} onclick={() => (choice = 'chat')}>
            <span class="ta-choice-icon"><Icon name="chat" /></span>
            <span class="min-w-0">
              <span class="ta-nx-title">Tanya AI</span>
              <span class="ta-nx-sub">Tanya jawab cepat soal grafik dan berita {name}. Memakai 1 kuota tanya per pesan.</span>
            </span>
          </button>
        </div>
        {#if choice === 'analysis'}
          <AnalysisForm mode="analysis" folded />
        {:else}
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap gap-2">
              {#each questionsFor(name) as q (q)}
                <button type="button" class="btn btn-sm h-auto min-h-8 py-1.5 text-left font-normal whitespace-normal" disabled={!canAsk} onclick={() => ask(q)}>{q}</button>
              {/each}
            </div>
            <form class="flex items-end gap-2" onsubmit={(e) => (e.preventDefault(), ask(question))}>
              <label class="sr-only" for="research-ask">Pertanyaan untuk AI tentang {name}</label>
              <textarea id="research-ask" class="textarea min-h-12 flex-1" rows="2" placeholder="Tanya apa saja soal {name}…" bind:value={question}></textarea>
              <button class="btn btn-primary" disabled={!canAsk || !question.trim()}>Kirim</button>
            </form>
            {#if auth.unverified}
              <VerifyNote />
            {:else}
              <p class="text-xs ta-muted">{chatNote} Jawabannya muncul di panel AI di sebelah chart.</p>
            {/if}
          </div>
        {/if}
      </section>

      <section class="ta-card flex flex-col gap-1 p-5 [grid-area:history]" aria-labelledby="history-title">
        <div class="flex items-baseline justify-between gap-2">
          <h3 id="history-title" class="ta-section-title">Riwayat riset {name}</h3>
          {#if mine.length}<span class="text-sm ta-muted">{mine.length} riset</span>{/if}
        </div>
        {#if mine.length}
          <ul class="flex flex-col">
            {#each mine.slice(0, 5) as a (a.id)}
              {@const c = a.status === 'completed' && a.rating ? callOf(a.rating) : null}
              {@const reads = readIndicators(a.request)}
              <li class="flex items-center gap-3 border-t border-base-300 py-2.5 first:border-t-0">
                <span class="w-14 shrink-0 text-sm tabular-nums ta-muted">{formatDay(a.tradeDate)}</span>
                {#if c}
                  <span class="ta-chip" data-dir={c.dir}><Icon name={c.icon} size={12} stroke={2.4} />{c.label}</span>
                {:else}
                  <span class="ta-chip" data-dir={a.status === 'failed' ? 'warn' : a.status === 'queued' || a.status === 'running' ? 'run' : undefined}>{STATUS_LABELS[a.status]}</span>
                {/if}
                <span class="min-w-0 flex-1 truncate text-sm ta-muted" title={reads || undefined}>{reads ? `Membaca ${reads}` : 'Analisa lengkap'}</span>
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => (a.status === 'failed' ? openLog(a.id) : ws.openRun(a.id, { symbol: ws.symbol }))}>
                  {a.status === 'failed' ? 'Lihat log' : 'Buka'}
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm ta-muted">Belum ada riset untuk aset ini.</p>
        {/if}
      </section>
    </div>
  {/if}
  <p class="text-xs ta-muted">Hasil analisa dibuat model AI dan bukan saran investasi.</p>
</div>
