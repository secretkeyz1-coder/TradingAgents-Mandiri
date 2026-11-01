<script lang="ts">
  // Riset AI for the symbol in focus: ask the agent (Tanya), or run a full analysis and
  // follow it (Jalankan: the open analysis at a glance, the latest decision on record, the
  // form). The history, report and log of the same work sit in the bottom panel under this
  // destination; backtests have their own, Uji strategi.
  import { ratingBadge, ratingTone, renderMarkdown } from '../format';
  import { jobs } from '../stores/jobs.svelte';
  import { AI_MODES, ws } from '../stores/workspace.svelte';
  import StatusBadge from '../StatusBadge.svelte';
  import { toTradingView } from '../tv';
  import AnalysisForm from './AnalysisForm.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import PanelClose from './PanelClose.svelte';

  /** `bare`: on a phone the screen's tab row stands in for the header (PhoneScreen). */
  let { bare = false, onclose }: { bare?: boolean; onclose?: () => void } = $props();

  const run = $derived(ws.run);
  const latest = $derived(
    ws.yahoo
      ? jobs.analyses.find((a) => a.ticker === ws.yahoo!.toUpperCase() && a.status === 'completed' && a.rating && a.id !== run?.id)
      : undefined,
  );

  function dot(s: string | undefined) {
    if (s === 'completed') return 'status-success';
    if (s === 'in_progress') return 'status-info motion-safe:animate-pulse';
    return 'status-neutral opacity-40';
  }

  async function removeRun() {
    if (run && (await run.remove())) {
      ws.closeRun();
      jobs.refresh();
    }
  }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Riset AI">
  {#if !bare}
    <header class="flex h-10 shrink-0 items-center gap-2 border-b border-base-300 px-3">
      <h2 class="text-sm font-semibold whitespace-nowrap">Riset AI</h2>
      <div role="tablist" class="tabs tabs-box tabs-xs ml-auto" aria-label="Riset AI">
        {#each AI_MODES as m (m.key)}
          <button role="tab" class="tab" class:tab-active={ws.aiMode === m.key} aria-selected={ws.aiMode === m.key} onclick={() => ws.setAiMode(m.key)}>
            {m.label}
          </button>
        {/each}
      </div>
      {#if onclose}<PanelClose label="Tutup panel Riset AI" onclick={onclose} />{/if}
    </header>
  {/if}

  {#if ws.aiMode === 'chat'}
    <div class="flex min-h-0 flex-1 flex-col p-3">
      {#if ws.yahoo}
        <ChatPanel />
      {:else}
        <p class="text-sm text-base-content/70">{ws.symbol} belum bisa dipetakan ke data engine (Yahoo Finance).</p>
      {/if}
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      {#if run}
        <article class="flex flex-col gap-2 rounded-box border border-base-300 p-3" aria-label="Analisa terbuka">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm font-semibold">{run.ticker || '…'}</span>
            <StatusBadge status={run.status} />
            <span class="ml-auto font-mono text-xs tabular-nums text-base-content/70">{run.elapsed}</span>
          </div>
          {#if run.loadError}
            <p class="text-sm text-error">{run.loadError}</p>
          {:else if run.decision}
            <p class="text-xs text-base-content/70">Keputusan · {run.analysis?.tradeDate}</p>
            <p class="text-2xl font-semibold leading-tight {ratingTone(run.rating)}">{run.rating ?? '—'}</p>
            <div class="md line-clamp-6 text-sm">{@html renderMarkdown(run.decision)}</div>
            <button class="link link-hover w-fit text-sm" onclick={() => ws.setDock('report')}>Baca laporan lengkap</button>
          {:else if run.live}
            <p class="text-sm tabular-nums">
              {run.agentCount ? `${run.agentsDone} dari ${run.agentCount} agent selesai` : 'Menyiapkan agent…'}
            </p>
            <progress class="progress progress-accent w-full" value={run.agentsDone} max={run.agentCount || 1}></progress>
            <ul class="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              {#each run.teams as team (team.name)}
                {#each team.agents as agent (agent)}
                  <li class="flex items-center gap-1.5 truncate">
                    <span class="status status-xs {dot(run.agents[agent])}" aria-hidden="true"></span>{agent}
                  </li>
                {/each}
              {/each}
            </ul>
          {/if}
          {#if run.error}
            <p class="line-clamp-4 text-xs text-error">{run.error}</p>
          {/if}
          {#if run.ticker && ws.yahoo !== run.ticker}
            <p class="text-xs text-base-content/70">
              Analisa ini untuk {run.ticker}.
              <button class="link" onclick={() => ws.setSymbol(toTradingView(run.ticker))}>Fokuskan</button>
            </p>
          {/if}
          <div class="flex flex-wrap gap-1.5">
            {#if run.live}
              <button class="btn btn-xs" onclick={() => run.cancel()} disabled={run.busy}>Batalkan</button>
            {:else}
              <button class="btn btn-ghost btn-xs" onclick={removeRun} disabled={run.busy}>Hapus</button>
            {/if}
            <button class="btn btn-ghost btn-xs" onclick={() => ws.setDock('log')}>Log</button>
            <button class="btn btn-ghost btn-xs ml-auto" onclick={() => ws.closeRun()}>Tutup</button>
          </div>
        </article>
      {/if}

      {#if latest}
        <button
          class="flex items-center justify-between gap-2 rounded-box border border-base-300 px-3 py-2 text-left text-sm hover:bg-base-200"
          onclick={() => ws.openRun(latest.id)}
        >
          <span>
            <span class="block text-xs text-base-content/70">Keputusan terakhir · {latest.tradeDate}</span>
            Buka analisa
          </span>
          <span class="badge badge-sm {ratingBadge(latest.rating)}">{latest.rating}</span>
        </button>
      {/if}

      <div>
        <h3 class="mb-2 text-sm font-semibold">Analisa baru</h3>
        {#if ws.yahoo}
          <AnalysisForm mode="analysis" />
        {:else}
          <p class="text-sm text-base-content/70">{ws.symbol} belum bisa dipetakan ke data engine (Yahoo Finance).</p>
        {/if}
      </div>

      <p class="mt-auto text-xs text-base-content/70">Hasil analisa dibuat model AI dan bukan saran investasi.</p>
    </div>
  {/if}
</section>
