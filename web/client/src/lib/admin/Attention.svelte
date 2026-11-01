<script lang="ts">
  // The console's "needs doing" list: payments waiting for a check, and parts
  // of the service that are down, struggling or not set up yet (server/src/status.ts).
  import { api, type ServiceStatus } from '../api';

  let waiting = $state<number | null>(null);
  let status = $state<ServiceStatus | null>(null);
  let loaded = $state(false);
  Promise.allSettled([api.adminPayments('open').then((r) => (waiting = r.length)), api.serviceStatus().then((s) => (status = s))]).then(
    () => (loaded = true),
  );

  const TONE = { warning: 'status-warning', error: 'status-error', info: 'status-info' } as const;
  type Item = { text: string; detail: string; href: string; action: string; tone: keyof typeof TONE };
  const items = $derived.by(() => {
    const out: Item[] = [];
    if (waiting) {
      out.push({ text: `${waiting} pembayaran menunggu konfirmasi`, detail: 'Cocokkan jumlahnya dengan mutasi rekening.', href: '#/admin/pembayaran', action: 'Periksa', tone: 'warning' });
    }
    for (const p of status?.parts ?? []) {
      if (p.state === 'down') out.push({ text: `${p.name} sedang gangguan`, detail: p.detail, href: '#/admin/status', action: 'Lihat status', tone: 'error' });
      else if (p.state === 'degraded') out.push({ text: `${p.name} terganggu`, detail: p.detail, href: '#/admin/status', action: 'Lihat status', tone: 'warning' });
      else if (p.state === 'off') out.push({ text: `${p.name} belum diatur`, detail: p.detail, href: '#/admin/pengaturan', action: 'Lihat pengaturan', tone: 'info' });
    }
    return out;
  });
</script>

<section class="rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="attention-title">
  <h2 id="attention-title" class="text-base font-semibold">Perlu tindakan</h2>
  {#if !loaded}
    <p class="mt-2 text-sm text-base-content/70">Memuat…</p>
  {:else if !items.length}
    <p class="mt-2 text-sm text-success">Tidak ada yang perlu ditangani sekarang.</p>
  {:else}
    <ul class="mt-1 divide-y divide-base-300">
      {#each items as item (item.text)}
        <li class="flex flex-wrap items-center gap-3 py-3">
          <span class="status {TONE[item.tone]}" aria-hidden="true"></span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="font-medium">{item.text}</span>
            <span class="text-sm text-base-content/70">{item.detail}</span>
          </div>
          <a class="btn btn-sm" href={item.href}>{item.action}</a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
