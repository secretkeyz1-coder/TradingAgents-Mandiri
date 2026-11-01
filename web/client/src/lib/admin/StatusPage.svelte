<script lang="ts">
  // Service status inside the console: each part now and its share of clean
  // checks over the days on record, as the public /status page shows them; then
  // the server's own errors of the last 30 days (server/src/errors.ts), each under
  // the code the user saw, with its stack one click away.
  import { api, type ServerError, type ServiceState, type ServiceStatus } from '../api';

  let status = $state<ServiceStatus | null>(null);
  let errors = $state<{ items: ServerError[]; lastDay: number } | null>(null);
  let error = $state('');
  async function load() {
    try {
      [status, errors] = await Promise.all([api.serviceStatus(), api.adminErrors()]);
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  load();

  const SOURCE: Record<string, string> = {
    request: 'Request',
    prices: 'Notifikasi harga',
    scan: 'Pemindaian sinyal',
    analysis: 'Analisa',
    watchlist: 'Watchlist',
    brief: 'Ringkasan AI',
    ledger: 'Buku sinyal',
    creator: 'Rekam jejak Creator',
    reminders: 'Pengingat',
    status: 'Cek status',
    catalog: 'Katalog model',
    tokens: 'Meter token',
    jobs: 'Antrean job',
  };

  const STATE: Record<ServiceState, [string, string]> = {
    ok: ['Normal', 'badge-success'],
    degraded: ['Terganggu', 'badge-warning'],
    down: ['Gangguan', 'badge-error'],
    off: ['Belum diatur', 'badge-ghost'],
  };
  const average = (h: Record<string, number>) => {
    const v = Object.values(h);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const pct = (x: number) => `${(x * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
  const clock = (iso: string) =>
    `${new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} WIB`;
</script>

<section class="flex flex-col gap-5" aria-labelledby="status-title">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 id="status-title" class="text-2xl font-semibold">Status layanan</h1>
      <p class="text-sm text-base-content/70">{status ? `Diperiksa ${clock(status.checkedAt)}; server memeriksa lagi tiap 5 menit.` : 'Memuat…'}</p>
    </div>
    <div class="flex gap-2">
      <button class="btn btn-sm" onclick={load}>Muat ulang</button>
      <a class="btn btn-ghost btn-sm" href="/status" target="_blank" rel="noopener">Halaman publik</a>
    </div>
  </div>
  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if status}
    <ul class="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100">
      {#each status.parts as p (p.key)}
        {@const avg = average(p.history)}
        <li class="flex flex-wrap items-center gap-3 p-4">
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="font-medium">{p.name}</span>
            <span class="text-sm text-base-content/70">{p.detail}</span>
          </div>
          {#if avg !== null}<span class="text-sm tabular-nums text-base-content/70">{pct(avg)} tanpa gangguan, {Object.keys(p.history).length} hari</span>{/if}
          <span class="badge badge-soft {STATE[p.state][1]}">{STATE[p.state][0]}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if errors}
    <section class="flex flex-col gap-3" aria-labelledby="errors-title">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="errors-title" class="text-lg font-semibold">Error server</h2>
        <span class="text-sm text-base-content/70">{errors.lastDay} dalam 24 jam · disimpan 30 hari</span>
      </div>
      {#if !errors.items.length}
        <p class="text-sm text-success">Belum ada error tercatat.</p>
      {:else}
        <ul class="divide-y divide-base-300 rounded-box border border-base-300 bg-base-100">
          {#each errors.items as e (e.id)}
            <li class="flex flex-col gap-1 p-4">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="font-mono text-sm font-semibold">{e.code}</span>
                <span class="badge badge-soft badge-error badge-sm">{SOURCE[e.source] ?? e.source}</span>
                {#if e.path}<span class="font-mono text-sm text-base-content/70">{e.method} {e.path}</span>{/if}
                <span class="ml-auto text-sm text-base-content/70">{clock(e.createdAt)}</span>
              </div>
              <p class="text-sm break-words">{e.message}</p>
              {#if e.stack}
                <details>
                  <summary class="cursor-pointer text-sm text-base-content/70">Stack</summary>
                  <pre class="mt-2 max-h-64 overflow-auto rounded-box bg-base-200 p-3 text-xs whitespace-pre-wrap">{e.stack}</pre>
                </details>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>
