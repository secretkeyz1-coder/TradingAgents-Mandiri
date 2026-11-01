<script lang="ts">
  // Service status inside the console: each part now and its share of clean
  // checks over the days on record, as the public /status page shows them.
  import { api, type ServiceState, type ServiceStatus } from '../api';

  let status = $state<ServiceStatus | null>(null);
  let error = $state('');
  async function load() {
    try {
      status = await api.serviceStatus();
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  load();

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
</section>
