<script lang="ts">
  // Every analysis and backtest; opening one also brings its symbol into focus.
  import { auth } from '../../auth.svelte';
  import { formatDateTime, ratingBadge } from '../../format';
  import { jobs } from '../../stores/jobs.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import StatusBadge from '../../StatusBadge.svelte';
  import { toTradingView } from '../../tv';

  let scope = $state<'all' | 'symbol'>('all');
  const mine = $derived(scope === 'symbol' && ws.yahoo ? ws.yahoo.toUpperCase() : null);
  const analyses = $derived(mine ? jobs.analyses.filter((a) => a.ticker === mine) : jobs.analyses);
  const backtests = $derived(mine ? jobs.backtests.filter((b) => b.ticker.split(',').includes(mine)) : jobs.backtests);
</script>

<div class="flex flex-col gap-3 p-3">
  <div class="flex flex-wrap items-center gap-2">
    <div class="join">
      <button class="btn btn-xs join-item" class:btn-active={scope === 'all'} onclick={() => (scope = 'all')}>Semua</button>
      <button class="btn btn-xs join-item font-mono" class:btn-active={scope === 'symbol'} disabled={!ws.yahoo} onclick={() => (scope = 'symbol')}>
        {ws.yahoo ?? 'Simbol ini'}
      </button>
    </div>
    {#if auth.isAdmin}
      <label class="ml-auto flex cursor-pointer items-center gap-1.5 text-xs">
        <input type="checkbox" class="toggle toggle-xs" checked={jobs.everyone} onchange={(e) => jobs.setEveryone(e.currentTarget.checked)} />
        Semua pengguna
      </label>
    {/if}
    <button class="btn btn-ghost btn-xs" class:ml-auto={!auth.isAdmin} onclick={() => jobs.refresh()}>Muat ulang</button>
  </div>
  {#if jobs.error}<p class="text-sm text-error">{jobs.error}</p>{/if}

  <div class="grid gap-6 xl:grid-cols-2">
    <section class="min-w-0">
      <h3 class="mb-1 text-sm font-semibold">Analisa</h3>
      {#if analyses.length === 0}
        <p class="py-6 text-sm text-base-content/70">{jobs.loaded ? 'Belum ada analisa. Jalankan dari panel AI.' : 'Memuat…'}</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Ticker</th>
                {#if jobs.everyone}<th>Pemilik</th>{/if}
                <th>Tanggal</th>
                <th>Status</th>
                <th>Keputusan</th>
                <th class="hidden md:table-cell">Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {#each analyses as a (a.id)}
                <tr class:bg-base-200={ws.run?.id === a.id}>
                  <td>
                    <button class="link link-hover font-mono font-semibold" onclick={() => ws.openRun(a.id, { symbol: toTradingView(a.ticker) })}>
                      {a.ticker}
                    </button>
                  </td>
                  {#if jobs.everyone}<td class="font-mono text-xs">{a.owner ?? '–'}</td>{/if}
                  <td class="tabular-nums">{a.tradeDate}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{#if a.rating}<span class="badge badge-sm {ratingBadge(a.rating)}">{a.rating}</span>{:else}–{/if}</td>
                  <td class="hidden text-xs text-base-content/70 md:table-cell">{formatDateTime(a.createdAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="min-w-0">
      <h3 class="mb-1 text-sm font-semibold">Backtest</h3>
      {#if backtests.length === 0}
        <p class="py-6 text-sm text-base-content/70">{jobs.loaded ? 'Belum ada backtest. Jalankan dari panel AI, tab Backtest.' : 'Memuat…'}</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Ticker</th>
                {#if jobs.everyone}<th>Pemilik</th>{/if}
                <th>Rentang</th>
                <th>Status</th>
                <th class="hidden md:table-cell">Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {#each backtests as b (b.id)}
                <tr class:bg-base-200={ws.backtest?.id === b.id}>
                  <td>
                    <button
                      class="link link-hover font-mono font-semibold"
                      onclick={() => ws.openBacktest(b.id, { symbol: toTradingView(b.ticker.split(',')[0]) })}
                    >
                      {b.ticker.split(',').join(', ')}
                    </button>
                  </td>
                  {#if jobs.everyone}<td class="font-mono text-xs">{b.owner ?? '–'}</td>{/if}
                  <td class="whitespace-nowrap text-xs tabular-nums">{b.request.start} – {b.request.end} · {b.request.everyNDays} hr</td>
                  <td>
                    <StatusBadge
                      status={b.status}
                      detail={b.progress && (b.status === 'running' || b.status === 'queued') ? `${b.progress.done}/${b.progress.total}` : ''}
                    />
                  </td>
                  <td class="hidden text-xs text-base-content/70 md:table-cell">{formatDateTime(b.createdAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  </div>
</div>
