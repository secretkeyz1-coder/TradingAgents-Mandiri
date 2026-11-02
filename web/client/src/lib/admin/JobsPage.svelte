<script lang="ts">
  // Konsol admin → Analisa & backtest: the latest hundred of each across every account (GET
  // /api/analyses?scope=all), with whose they are, how they ended and why one failed, so a failing
  // model or a member's stuck run shows without opening the app as them. Before this page the app's
  // own lists had a "Semua pengguna" switch for admins; the app now shows everyone only their own.
  import { api, type AnalysisSummary, type BacktestSummary } from '../api';
  import { formatDateTime, ratingBadge } from '../format';
  import { toTradingView } from '../tv';

  let kind = $state<'analysis' | 'backtest'>('analysis');
  let analyses = $state<AnalysisSummary[]>([]);
  let backtests = $state<BacktestSummary[]>([]);
  let loaded = $state(false);
  let error = $state('');

  async function load() {
    try {
      [analyses, backtests] = await Promise.all([api.list(true), api.listBacktests(true)]);
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loaded = true;
    }
  }
  load();

  const STATUS: Record<string, string> = { queued: 'Antre', running: 'Berjalan', completed: 'Selesai', failed: 'Gagal', cancelled: 'Dibatalkan' };
  const tone = (s: string) => (s === 'completed' ? 'badge-success' : s === 'failed' ? 'badge-error' : s === 'running' || s === 'queued' ? 'badge-info' : 'badge-ghost');
  const rows = $derived(kind === 'analysis' ? analyses : backtests);
  const failed = $derived(rows.filter((r) => r.status === 'failed').length);
  /** Where a row opens in the app: an analysis on Riset AI, a backtest under Uji saran AI. */
  const link = (r: AnalysisSummary | BacktestSummary) =>
    r.kind === 'analysis' ? `#/riset?s=${encodeURIComponent(toTradingView(r.ticker))}&run=${r.id}` : `#/uji?bt=${r.id}&dock=backtest`;
</script>

<section class="flex flex-col gap-5" aria-labelledby="jobs-title">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 id="jobs-title" class="text-2xl font-semibold">Analisa & backtest</h1>
      <p class="text-sm text-base-content/70">Seratus terakhir dari semua akun. Member hanya melihat miliknya sendiri di aplikasi.</p>
    </div>
    <div class="flex items-center gap-2">
      <div class="join" role="group" aria-label="Jenis">
        <button class="btn btn-sm join-item" class:btn-active={kind === 'analysis'} aria-pressed={kind === 'analysis'} onclick={() => (kind = 'analysis')}>Analisa</button>
        <button class="btn btn-sm join-item" class:btn-active={kind === 'backtest'} aria-pressed={kind === 'backtest'} onclick={() => (kind = 'backtest')}>Uji saran AI</button>
      </div>
      <button class="btn btn-ghost btn-sm" onclick={load}>Muat ulang</button>
    </div>
  </div>
  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if !loaded}
    <p class="text-sm text-base-content/70">Memuat…</p>
  {:else if !rows.length}
    <p class="text-sm text-base-content/70">Belum ada.</p>
  {:else}
    {#if failed}<p class="text-sm">{failed} dari {rows.length} gagal; alasannya di bawah statusnya.</p>{/if}
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Dibuat</th>
            <th>Akun</th>
            <th>Aset</th>
            <th>Status</th>
            <th>Hasil</th>
            <th><span class="sr-only">Buka</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.id)}
            <tr>
              <td class="whitespace-nowrap text-xs tabular-nums">{formatDateTime(r.createdAt)}</td>
              <td>{r.owner ?? '–'}</td>
              <td class="font-mono text-xs">{r.ticker}</td>
              <td class="max-w-80">
                <span class="badge badge-sm badge-soft {tone(r.status)}">{STATUS[r.status] ?? r.status}</span>
                {#if r.status === 'failed' && r.error}<span class="mt-0.5 block truncate text-xs text-base-content/70" title={r.error}>{r.error}</span>{/if}
              </td>
              <td>{#if r.rating}<span class="badge badge-sm {ratingBadge(r.rating)}">{r.rating}</span>{/if}</td>
              <td class="text-right"><a class="link link-hover text-xs" href={link(r)}>Buka</a></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
