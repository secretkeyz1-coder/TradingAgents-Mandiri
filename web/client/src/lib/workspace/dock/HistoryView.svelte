<script lang="ts">
  // Riset AI → Riwayat: every analysis; opening one also brings its symbol into focus.
  // Backtests are listed in their own tab, Uji strategi → Backtest.
  import { auth } from '../../auth.svelte';
  import { formatDateTime, ratingBadge } from '../../format';
  import { jobs } from '../../stores/jobs.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import StatusBadge from '../../StatusBadge.svelte';
  import { toTradingView } from '../../tv';

  let scope = $state<'all' | 'symbol'>('all');
  const mine = $derived(scope === 'symbol' && ws.yahoo ? ws.yahoo.toUpperCase() : null);
  const analyses = $derived(mine ? jobs.analyses.filter((a) => a.ticker === mine) : jobs.analyses);
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

  {#if analyses.length === 0}
    <p class="py-6 text-sm text-base-content/70">
      {#if !jobs.loaded}
        Memuat…
      {:else}
        Belum ada analisa{mine ? ` untuk ${mine}` : ''}. Mulai dari Riset AI, tab Jalankan.
      {/if}
    </p>
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
</div>
