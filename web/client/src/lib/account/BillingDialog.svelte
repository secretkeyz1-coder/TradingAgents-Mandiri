<script lang="ts">
  // A member's plan and payments: pick a plan and period, and a coupon if they
  // have one, get the amount to transfer (the price plus a unique code) and the
  // bank details, say it is paid, and see past orders with their invoices. An
  // admin confirms the payment (admin/PaymentsPage); a coupon that covers the whole
  // price activates the plan at once.
  import { FOUNDING, PERIOD_LABEL, PLANS, rupiah, type Period } from '../../../../shared/plans';
  import { api, type Billing, type CouponQuote, type Payment } from '../api';
  import { auth } from '../auth.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let billing = $state<Billing | null>(null);
  let period = $state<Period>('month');
  let note = $state('');
  let error = $state('');
  let busy = $state(false);
  let code = $state('');
  let quote = $state<CouponQuote | null>(null);
  let couponError = $state('');

  const STATUS: Record<Payment['status'], string> = {
    pending: 'menunggu pembayaran',
    claimed: 'diperiksa admin',
    paid: 'lunas',
    rejected: 'ditolak',
    cancelled: 'dibatalkan',
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const open = $derived(billing?.orders.find((o) => o.status === 'pending' || o.status === 'claimed') ?? null);
  const past = $derived(billing?.orders.filter((o) => o !== open && (o.amount > 0 || o.discount > 0)) ?? []);
  const seats = $derived(billing && (billing.founding.mine || billing.founding.left > 0));

  async function load() {
    try {
      billing = await api.billing();
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  load();

  async function act(fn: () => Promise<unknown>) {
    busy = true;
    error = '';
    try {
      await fn();
      await load();
      auth.user = await api.me();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  /** What the typed code takes off each plan, for the period shown. */
  async function check() {
    const typed = code.trim();
    if (!typed) return;
    couponError = '';
    try {
      quote = await api.couponQuote(typed, period);
    } catch (e) {
      quote = null;
      couponError = (e as Error).message;
    }
  }

  function choose(next: Period) {
    period = next;
    if (quote) check();
  }

  function dropCoupon() {
    code = '';
    quote = null;
    couponError = '';
  }

  /** The coupon's price for one plan, when it applies to that plan. */
  function deal(plan: 'pro' | 'creator') {
    const q = quote?.plans[plan];
    return q && 'total' in q ? q : null;
  }

  function refusal(plan: 'pro' | 'creator') {
    const q = quote?.plans[plan];
    return q && 'error' in q ? q.error : '';
  }

  const order = (plan: 'pro' | 'creator', founding = false) =>
    act(() => api.order({ plan, period: founding ? 'month' : period, founding, coupon: !founding && quote && deal(plan) ? quote.code : undefined }));
</script>

<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="billing-title">
  <div class="modal-box flex max-w-3xl flex-col gap-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 id="billing-title" class="text-lg font-semibold">Paket & tagihan</h2>
        {#if auth.user}
          <p class="text-sm text-base-content/70">
            Paketmu: <strong>{PLANS[auth.user.plan].name}</strong>{auth.user.onTrial ? ' (trial)' : ''}{auth.user.planUntil ? `, berlaku sampai ${day(auth.user.planUntil)}` : ''}
          </p>
        {/if}
      </div>
      <button class="btn btn-ghost btn-sm" onclick={onclose}>Tutup</button>
    </div>

    {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}

    {#if auth.isAdmin}
      <p class="text-sm">Akun admin memakai kapasitas Creator tanpa berlangganan. Pembayaran anggota ada di menu akun → Pembayaran.</p>
    {:else if !billing}
      <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
    {:else if open}
      <section class="flex flex-col gap-3 rounded-box border border-base-300 p-4">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="font-semibold">Pesanan {open.reference}</h3>
          <span class="badge badge-sm {open.status === 'claimed' ? 'badge-info' : 'badge-warning'} badge-soft">{STATUS[open.status]}</span>
        </div>
        <p class="text-sm">{PLANS[open.plan].name}{open.founding ? ' founding' : ''} per {PERIOD_LABEL[open.period]}</p>
        <div>
          <p class="text-sm text-base-content/70">Transfer tepat</p>
          <p class="text-3xl font-semibold tracking-tight tabular-nums">{rupiah(open.amount)}</p>
          <p class="text-xs text-base-content/70">
            Tiga digit terakhir ({open.uniqueCode}) adalah kode unik pesananmu, jadi transfer persis sejumlah ini. Batas bayar {day(new Date(new Date(open.createdAt).getTime() + billing.orderDays * 86_400_000).toISOString())}.
          </p>
          {#if open.discount}<p class="text-xs text-success">Sudah dipotong kupon {open.couponCode}: {rupiah(open.discount)}.</p>{/if}
        </div>
        <p class="rounded-box bg-base-200 p-3 text-sm whitespace-pre-line">{billing.instructions}</p>
        {#if open.status === 'pending'}
          <div class="flex flex-col gap-2">
            <input class="input input-sm w-full" maxlength="300" placeholder="Catatan untuk admin, mis. dari BCA a.n. Budi" bind:value={note} />
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-primary btn-sm" disabled={busy} onclick={() => act(() => api.claimOrder(open!.id, note.trim()))}>Saya sudah bayar</button>
              <a class="btn btn-ghost btn-sm" href={open.invoiceUrl} target="_blank" rel="noopener">Lihat tagihan</a>
              <button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => act(() => api.cancelOrder(open!.id))}>Batalkan pesanan</button>
            </div>
          </div>
        {:else}
          <p class="text-sm">Admin sedang memeriksa pembayaranmu. Paket aktif setelah dikonfirmasi; kabarnya dikirim lewat email{auth.user?.telegramChatId ? ' dan Telegram' : ''}.</p>
        {/if}
      </section>
    {:else if !billing.open}
      <p class="rounded-box bg-base-200 p-3 text-sm">Pembayaran belum dibuka. Hubungi admin untuk berlangganan.</p>
    {:else}
      {#if seats}
        <section class="flex flex-wrap items-center justify-between gap-3 rounded-box border border-accent/40 p-4">
          <div class="flex flex-col gap-0.5">
            <h3 class="font-semibold">Founding member: Pro {rupiah(billing.founding.price)}/bulan</h3>
            <p class="text-sm text-base-content/70">
              Harga terkunci selama kamu tetap berlangganan.{billing.founding.mine ? ' Kamu sudah founding member.' : ` Sisa ${billing.founding.left} dari ${FOUNDING.seats} kursi.`} Tidak bisa digabung dengan kupon.
            </p>
          </div>
          <button class="btn btn-primary btn-sm" disabled={busy} onclick={() => order('pro', true)}>Pesan Pro founding</button>
        </section>
      {/if}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-sm font-semibold">Pilih paket</h3>
        <div class="join" role="group" aria-label="Periode">
          <button class="btn btn-xs join-item" class:btn-active={period === 'month'} aria-pressed={period === 'month'} onclick={() => choose('month')}>Bulanan</button>
          <button class="btn btn-xs join-item" class:btn-active={period === 'year'} aria-pressed={period === 'year'} onclick={() => choose('year')}>Tahunan · hemat 2 bulan</button>
        </div>
      </div>
      <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => (e.preventDefault(), check())}>
        <label class="sr-only" for="coupon-code">Kode kupon</label>
        <input id="coupon-code" class="input input-sm w-44 uppercase" maxlength="40" autocomplete="off" placeholder="Kode kupon" bind:value={code} />
        <button class="btn btn-sm" type="submit" disabled={busy || !code.trim()}>Pakai kupon</button>
        {#if quote}<button class="btn btn-ghost btn-sm" type="button" onclick={dropCoupon}>Hapus kupon</button>{/if}
        {#if couponError}<p role="alert" class="w-full text-xs text-error">{couponError}</p>{/if}
      </form>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each [PLANS.pro, PLANS.creator] as plan (plan.id)}
          {@const id = plan.id as 'pro' | 'creator'}
          {@const offer = deal(id)}
          <section class="flex flex-col gap-3 rounded-box border border-base-300 p-4">
            <div>
              <h4 class="font-semibold">{plan.name}</h4>
              <p class="text-sm text-base-content/70">{plan.blurb}</p>
            </div>
            <div>
              <p class="text-2xl font-semibold tracking-tight tabular-nums">
                {rupiah(offer ? offer.total : plan.price[period])}<span class="text-sm font-normal text-base-content/70">/{PERIOD_LABEL[period]}</span>
              </p>
              {#if offer}
                <p class="text-xs text-success">Kupon {quote?.code} memotong {rupiah(offer.discount)} dari {rupiah(plan.price[period])}.</p>
              {:else if refusal(id)}
                <p class="text-xs text-base-content/70">{refusal(id)}.</p>
              {/if}
            </div>
            <ul class="flex flex-col gap-1 text-sm">
              {#each plan.highlights as item (item)}<li>· {item}</li>{/each}
            </ul>
            <button class="btn btn-sm mt-auto" disabled={busy} onclick={() => order(id)}>Pesan {plan.name}</button>
          </section>
        {/each}
      </div>
      <p class="text-xs text-base-content/70">
        Bayar lewat transfer bank atau QRIS. Pesanan berlaku {billing.orderDays} hari; paket aktif setelah admin memeriksa pembayaranmu, biasanya di hari yang sama.
        Memperpanjang paket yang sama menambah dari tanggal berakhirnya.
      </p>
    {/if}

    {#if past.length}
      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold">Riwayat</h3>
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead><tr><th>Tanggal</th><th>Referensi</th><th>Paket</th><th class="text-right">Jumlah</th><th>Status</th></tr></thead>
            <tbody>
              {#each past as o (o.id)}
                <tr>
                  <td class="whitespace-nowrap">{day(o.createdAt)}</td>
                  <td><a class="link link-hover font-mono text-xs" href={o.invoiceUrl} target="_blank" rel="noopener" title={o.status === 'paid' ? 'Bukti pembayaran' : 'Tagihan'}>{o.reference}</a></td>
                  <td>{PLANS[o.plan].name}/{PERIOD_LABEL[o.period]}{o.periodEnd && o.status === 'paid' ? `, s.d. ${day(o.periodEnd)}` : ''}</td>
                  <td class="text-right tabular-nums">
                    {rupiah(o.amount)}{#if o.couponCode}<span class="block text-xs text-base-content/70">kupon {o.couponCode}</span>{/if}
                  </td>
                  <td>{STATUS[o.status]}{o.adminNote && o.status === 'rejected' ? `: ${o.adminNote}` : ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  </div>
  <button class="modal-backdrop" aria-label="Tutup" onclick={onclose}></button>
</div>
