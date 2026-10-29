<script lang="ts">
  // The open backtest: progress, the per-rating score, and each ticker's
  // decisions on its chart.
  import DecisionChart from '../../DecisionChart.svelte';
  import { formatDateTime, formatPercent, ratingBadge } from '../../format';
  import { jobs } from '../../stores/jobs.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import StatusBadge from '../../StatusBadge.svelte';
  import { toTradingView } from '../../tv';

  const bt = $derived(ws.backtest);
  let activeTicker = $state('');
  const shown = $derived(bt && bt.tickers.includes(activeTicker) ? activeTicker : (bt?.tickers[0] ?? ''));

  async function resume() {
    const next = await bt?.resume();
    if (next) {
      ws.openBacktest(next);
      jobs.refresh();
    }
  }

  async function remove() {
    if (bt && (await bt.remove())) {
      ws.closeBacktest();
      jobs.refresh();
    }
  }
</script>

{#if !bt}
  <p class="p-6 text-sm text-base-content/70">Buka backtest dari Riwayat, atau jalankan dari panel AI, tab Backtest.</p>
{:else if bt.loadError}
  <p class="p-6 text-sm text-error">Backtest tidak bisa dimuat: {bt.loadError}</p>
{:else if bt.backtest}
  {@const b = bt.backtest}
  {@const s = bt.result?.summary}
  <div class="flex flex-col gap-5 p-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-mono text-lg font-semibold">{bt.tickers.join(', ')}</h3>
          <StatusBadge status={b.status} />
        </div>
        <p class="text-sm text-base-content/70">
          {b.request.start} – {b.request.end} · tiap {b.request.everyNDays} hari · {b.request.provider} · {b.request.deepModel} · dibuat
          {formatDateTime(b.createdAt)}
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5">
        {#if bt.live}
          <button class="btn btn-sm" onclick={() => bt.cancel()} disabled={bt.busy}>Batalkan</button>
        {:else}
          {#if bt.result && (s?.pending || bt.result.failures.length)}
            <button class="btn btn-sm" onclick={resume} disabled={bt.busy} title="Lewati sel yang sudah jadi, nilai ulang yang pending">
              Lanjutkan dan nilai ulang
            </button>
          {/if}
          <button class="btn btn-ghost btn-sm" onclick={remove} disabled={bt.busy}>Hapus</button>
        {/if}
      </div>
    </header>

    {#if bt.error}
      <div role="alert" class="alert alert-error alert-soft items-start">
        <pre class="whitespace-pre-wrap font-sans text-sm">{bt.error}</pre>
      </div>
    {/if}

    {#if bt.live && bt.progress}
      <div class="flex flex-col gap-1.5">
        <p class="text-sm tabular-nums">
          Sel {Math.min(bt.progress.done + 1, bt.progress.total)} dari {bt.progress.total}
          {#if bt.progress.ticker}· {bt.progress.ticker}{bt.progress.date ? ` · ${bt.progress.date}` : ''}{/if}
          <span class="text-base-content/70">· {bt.elapsed}</span>
        </p>
        <progress class="progress progress-accent w-full" value={bt.progress.done} max={bt.progress.total}></progress>
      </div>
    {/if}

    {#if s}
      <div class="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <dl class="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <div>
            <dt class="text-xs text-base-content/70">Arah benar</dt>
            <dd class="text-2xl font-semibold tabular-nums">{bt.hitRate == null ? '—' : `${Math.round(bt.hitRate * 100)}%`}</dd>
            <dd class="text-xs text-base-content/70">{bt.directional.length} keputusan berarah</dd>
          </div>
          <div>
            <dt class="text-xs text-base-content/70">Sel dinilai</dt>
            <dd class="text-2xl font-semibold tabular-nums">{s.resolved}</dd>
            <dd class="text-xs text-base-content/70">{s.pending} pending · {s.unscored} tanpa rating</dd>
          </div>
          <div>
            <dt class="text-xs text-base-content/70">Jendela</dt>
            <dd class="text-lg font-semibold">{s.holding.replace('trading days', 'hari bursa')}</dd>
            <dd class="text-xs text-base-content/70">vs IHSG untuk .JK</dd>
          </div>
        </dl>
        <div class="min-w-0 overflow-x-auto">
          <table class="table table-sm">
            <thead><tr><th>Rating</th><th class="text-right">Jumlah</th><th class="text-right">Arah benar</th><th class="text-right">Rata-rata alpha</th></tr></thead>
            <tbody>
              {#each Object.entries(s.byRating) as [rating, score] (rating)}
                <tr>
                  <td><span class="badge badge-sm {ratingBadge(rating)}">{rating}</span></td>
                  <td class="text-right tabular-nums">{score.count}</td>
                  <td class="text-right tabular-nums">{score.hitRate == null ? 'tanpa arah' : `${Math.round(score.hitRate * 100)}%`}</td>
                  <td class="text-right tabular-nums" class:text-success={score.meanAlpha > 0} class:text-error={score.meanAlpha < 0}>
                    {formatPercent(score.meanAlpha)}
                  </td>
                </tr>
              {:else}
                <tr><td colspan="4" class="text-base-content/70">Belum ada sel yang selesai dinilai.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    {#if bt.result}
      <section class="flex flex-col gap-3 border-t border-base-300 pt-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h4 class="text-sm font-semibold">Keputusan di chart</h4>
          <div class="flex items-center gap-2">
            {#if bt.tickers.length > 1}
              <div role="tablist" class="tabs tabs-box tabs-xs">
                {#each bt.tickers as t (t)}
                  <button role="tab" class="tab font-mono" class:tab-active={t === shown} onclick={() => (activeTicker = t)}>{t}</button>
                {/each}
              </div>
            {/if}
            <button class="btn btn-ghost btn-xs" onclick={() => ws.setSymbol(toTradingView(shown))}>Fokuskan</button>
          </div>
        </div>
        {#key shown}
          <DecisionChart symbol={shown} decisions={bt.decisionsFor(shown)} height={300} />
        {/key}
      </section>

      {#if bt.result.failures.length || bt.result.settlementFailures.length}
        <section class="border-t border-base-300 pt-4">
          <h4 class="mb-1 text-sm font-semibold">Sel yang gagal</h4>
          <ul class="flex flex-col gap-1 text-sm">
            {#each bt.result.failures as f (f.ticker + f.date)}
              <li><span class="font-mono">{f.ticker} {f.date}</span>: {f.error}</li>
            {/each}
            {#each bt.result.settlementFailures as f, i (i)}
              <li><span class="font-mono">{f.ticker}</span> (penilaian): {f.error}</li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </div>
{:else}
  <div class="grid place-items-center p-8"><span class="loading loading-spinner"></span></div>
{/if}
