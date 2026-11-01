<script lang="ts">
  // Admin only: the business at a glance, and the payments to check. Match the
  // amount (its last three digits are the order's unique code) against the bank
  // statement, then confirm: the member's plan runs from its current end, or
  // from today, and they get a receipt by e-mail and Telegram.
  import { PERIOD_LABEL, PLANS, rupiah } from '../../../../shared/plans';
  import { api, type AdminOverview, type AdminPayment } from '../api';

  let { onclose }: { onclose: () => void } = $props();

  let tab = $state<'open' | 'paid' | 'all'>('open');
  let rows = $state<AdminPayment[]>([]);
  let overview = $state<AdminOverview | null>(null);
  let error = $state('');
  let notice = $state('');
  let rejecting = $state<string | null>(null);
  let reason = $state('');
  let busy = $state(false);

  const STATUS: Record<AdminPayment['status'], string> = {
    pending: 'belum dibayar',
    claimed: 'diklaim sudah bayar',
    paid: 'lunas',
    rejected: 'ditolak',
    cancelled: 'dibatalkan',
  };
  const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function load() {
    try {
      [rows, overview] = await Promise.all([api.adminPayments(tab), api.adminOverview()]);
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  $effect(() => {
    void tab;
    load();
  });

  async function act(fn: () => Promise<unknown>, done: string) {
    busy = true;
    error = notice = '';
    try {
      await fn();
      notice = done;
      rejecting = null;
      reason = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
    await load();
  }
</script>

<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="payments-title">
  <div class="modal-box flex max-w-5xl flex-col gap-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 id="payments-title" class="text-lg font-semibold">Pembayaran</h2>
        <p class="text-sm text-base-content/70">Cocokkan jumlah transfer (tiga digit terakhir = kode unik) dengan mutasi rekening, lalu konfirmasi.</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick={onclose}>Tutup</button>
    </div>

    {#if overview}
      <div class="stats stats-vertical w-full border border-base-300 sm:stats-horizontal">
        <div class="stat">
          <div class="stat-title">Anggota</div>
          <div class="stat-value text-2xl tabular-nums">{overview.members}</div>
          <div class="stat-desc">+{overview.newWeek} minggu ini · {overview.verified} terverifikasi</div>
        </div>
        <div class="stat">
          <div class="stat-title">Paket aktif</div>
          <div class="stat-value text-2xl tabular-nums">{overview.pro + overview.creator}</div>
          <div class="stat-desc">Pro {overview.pro} · Creator {overview.creator} · trial {overview.trials}</div>
        </div>
        <div class="stat">
          <div class="stat-title">Pendapatan bulan ini</div>
          <div class="stat-value text-2xl tabular-nums">{rupiah(overview.revenue.month)}</div>
          <div class="stat-desc">30 hari terakhir {rupiah(overview.revenue.last30)}</div>
        </div>
        <div class="stat">
          <div class="stat-title">Perlu diperiksa</div>
          <div class="stat-value text-2xl tabular-nums">{overview.orders.claimed}</div>
          <div class="stat-desc">{overview.orders.open} pesanan terbuka</div>
        </div>
      </div>
    {/if}

    <div role="tablist" class="tabs tabs-border tabs-sm">
      <button role="tab" class="tab" class:tab-active={tab === 'open'} onclick={() => (tab = 'open')}>Terbuka</button>
      <button role="tab" class="tab" class:tab-active={tab === 'paid'} onclick={() => (tab = 'paid')}>Lunas</button>
      <button role="tab" class="tab" class:tab-active={tab === 'all'} onclick={() => (tab = 'all')}>Semua</button>
    </div>

    {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
    {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}

    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr><th>Waktu</th><th>Anggota</th><th>Paket</th><th class="text-right">Jumlah</th><th>Referensi</th><th>Status</th><th><span class="sr-only">Aksi</span></th></tr>
        </thead>
        <tbody>
          {#each rows as p (p.id)}
            <tr>
              <td class="whitespace-nowrap">{when(p.claimedAt ?? p.createdAt)}</td>
              <td>
                <span class="font-mono">{p.user.username}</span>
                <span class="block text-xs text-base-content/70">{p.user.email ?? ''}{p.user.phone ? ` · ${p.user.phone}` : ''}</span>
              </td>
              <td class="whitespace-nowrap">{PLANS[p.plan].name}{p.founding ? ' founding' : ''}/{PERIOD_LABEL[p.period]}</td>
              <td class="text-right tabular-nums">
                {rupiah(p.amount)}{#if p.uniqueCode}<span class="block text-xs text-base-content/70">kode {p.uniqueCode}</span>{/if}
                {#if p.couponCode}<span class="block text-xs text-base-content/70">kupon {p.couponCode}, −{rupiah(p.discount)}</span>{/if}
              </td>
              <td><a class="link link-hover font-mono text-xs" href={p.invoiceUrl} target="_blank" rel="noopener">{p.reference}</a></td>
              <td>
                {STATUS[p.status]}
                {#if p.note}<span class="block text-xs text-base-content/70">"{p.note}"</span>{/if}
                {#if p.adminNote && p.status !== 'claimed' && p.status !== 'pending'}<span class="block text-xs text-base-content/70">{p.adminNote}</span>{/if}
              </td>
              <td class="text-right">
                {#if p.status === 'pending' || p.status === 'claimed'}
                  {#if rejecting === p.id}
                    <form class="join" onsubmit={(e) => (e.preventDefault(), act(() => api.rejectPayment(p.id, reason.trim()), `Pembayaran ${p.reference} ditolak.`))}>
                      <input class="input join-item input-xs w-48" required minlength="3" maxlength="300" placeholder="Alasan, dikirim ke anggota" bind:value={reason} />
                      <button class="btn btn-xs join-item" type="submit" disabled={busy}>Tolak</button>
                      <button class="btn btn-ghost btn-xs join-item" type="button" onclick={() => (rejecting = null)}>Batal</button>
                    </form>
                  {:else}
                    <div class="flex justify-end gap-1">
                      <button class="btn btn-primary btn-xs" disabled={busy} onclick={() => act(() => api.confirmPayment(p.id), `Pembayaran ${p.reference} dikonfirmasi; paket ${p.user.username} aktif.`)}>Konfirmasi lunas</button>
                      <button class="btn btn-ghost btn-xs" disabled={busy} onclick={() => ((rejecting = p.id), (reason = ''))}>Tolak</button>
                    </div>
                  {/if}
                {:else if p.periodEnd && p.status === 'paid'}
                  <span class="text-xs text-base-content/70">s.d. {new Date(p.periodEnd).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                {/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="7" class="text-base-content/70">{tab === 'open' ? 'Tidak ada pembayaran yang menunggu.' : 'Belum ada pembayaran.'}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
  <button class="modal-backdrop" aria-label="Tutup" onclick={onclose}></button>
</div>
