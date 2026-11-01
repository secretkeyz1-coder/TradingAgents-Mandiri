<script lang="ts">
  // The open analysis in full: the verdict first, then each analyst's report.
  import { api } from '../../api';
  import { formatDateTime, formatNumber, ratingTone, renderMarkdown, SECTION_LABELS } from '../../format';
  import { ws } from '../../stores/workspace.svelte';
  import StatusBadge from '../../StatusBadge.svelte';

  const run = $derived(ws.run);
</script>

{#if !run}
  <p class="p-6 text-sm text-base-content/70">Buka analisa dari Riwayat, atau jalankan analisa baru di Riset AI, tab Jalankan.</p>
{:else if run.loadError}
  <p class="p-6 text-sm text-error">Analisa tidak bisa dimuat: {run.loadError}</p>
{:else if run.analysis}
  {@const a = run.analysis}
  <div class="flex flex-col gap-4 p-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-mono text-lg font-semibold">{a.ticker}</h3>
          <StatusBadge status={run.status} />
        </div>
        <p class="text-sm text-base-content/70">
          Tanggal {a.tradeDate} · {a.request.provider} · {a.request.quickModel} / {a.request.deepModel} · {a.request.language} ·
          dibuat {formatDateTime(a.createdAt)}
        </p>
        <p class="font-mono text-xs tabular-nums text-base-content/70">
          {run.elapsed} · {formatNumber(run.stats?.llmCalls)} panggilan LLM · {formatNumber(run.stats?.toolCalls)} tool ·
          {formatNumber((run.stats?.tokensIn ?? 0) + (run.stats?.tokensOut ?? 0))} token
        </p>
      </div>
      {#if a.hasReportHtml}
        <a class="btn btn-sm" href={api.reportUrl(run.id)} target="_blank" rel="noopener">Laporan HTML ↗</a>
      {/if}
    </header>

    {#if run.error}
      <div role="alert" class="alert alert-error alert-soft items-start">
        <pre class="whitespace-pre-wrap font-sans text-sm">{run.error}</pre>
      </div>
    {/if}

    {#if run.decision}
      <section class="rounded-box border border-base-300 bg-base-200 p-4" aria-labelledby="verdict">
        <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h4 id="verdict" class="text-sm font-medium text-base-content/70">{SECTION_LABELS.final_trade_decision}</h4>
          {#if run.rating}<p class="text-2xl font-semibold {ratingTone(run.rating)}">{run.rating}</p>{/if}
        </div>
        <div class="md mt-2 max-w-[75ch]">{@html renderMarkdown(run.decision)}</div>
      </section>
    {:else if run.live}
      <p class="rounded-box border border-dashed border-base-300 p-4 text-sm text-base-content/70">
        Menunggu keputusan · {run.agentsDone} dari {run.agentCount} agent selesai.
      </p>
    {/if}

    {#each run.sections as section (section)}
      <details class="collapse collapse-arrow rounded-box border border-base-300" open={!run.decision}>
        <summary class="collapse-title font-medium">{SECTION_LABELS[section]}</summary>
        <div class="collapse-content">
          <div class="md max-w-[75ch]">{@html renderMarkdown(run.reports[section])}</div>
        </div>
      </details>
    {/each}
    {#if run.sections.length === 0 && !run.live}
      <p class="text-sm text-base-content/70">Tidak ada laporan analis untuk analisa ini.</p>
    {/if}
  </div>
{:else}
  <div class="grid place-items-center p-8"><span class="loading loading-spinner"></span></div>
{/if}
