<script lang="ts">
  // Admin only: discount codes (server/src/coupons.ts). Make a code that takes a
  // share of the price or rupiah off it, for some plans and periods or all, with
  // a cap and a last day if wanted; see how often each was used; switch one off.
  import { PERIOD_LABEL, PLANS, rupiah } from '../../../../shared/plans';
  import { api, type Coupon, type NewCoupon } from '../api';

  const PLAN_CHOICES = ['pro', 'creator'] as const;
  const PERIOD_CHOICES = ['month', 'year'] as const;
  const blank = (): NewCoupon => ({ code: '', kind: 'percent', value: 20, plans: [], periods: [], maxUses: null, lastDay: null, note: null });

  let rows = $state<Coupon[] | null>(null);
  let form = $state<NewCoupon>(blank());
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  const day = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const off = (c: Pick<Coupon, 'kind' | 'value'>) => (c.kind === 'percent' ? `${c.value}%` : rupiah(c.value));
  const scope = (c: Pick<Coupon, 'plans' | 'periods'>) =>
    `${c.plans.length ? c.plans.map((p) => PLANS[p].name).join(' dan ') : 'Semua paket'}, ${c.periods.length ? c.periods.map((p) => `per ${PERIOD_LABEL[p]}`).join(' dan ') : 'bulanan dan tahunan'}`;
  const ended = (c: Coupon) => Boolean(c.expiresAt && new Date(c.expiresAt).getTime() < Date.now());
  const toggled = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  async function load() {
    try {
      rows = await api.adminCoupons();
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  load();

  async function act(fn: () => Promise<unknown>, done: string) {
    busy = true;
    error = notice = '';
    try {
      await fn();
      notice = done;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
    await load();
  }

  function create(e: SubmitEvent) {
    e.preventDefault();
    const body: NewCoupon = { ...form, code: form.code.trim(), maxUses: form.maxUses || null, lastDay: form.lastDay || null, note: form.note?.trim() || null };
    act(async () => {
      await api.createCoupon(body);
      form = blank();
    }, `Kupon ${body.code.toUpperCase()} dibuat.`);
  }
</script>

<!-- A grid, not a flex column: a column would squeeze the scrolling table to nothing. -->
<section class="grid grid-cols-[minmax(0,1fr)] gap-5" aria-labelledby="coupons-title">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h1 id="coupons-title" class="text-2xl font-semibold">Kupon</h1>
        <p class="text-sm text-base-content/70">Anggota mengetik kode saat memesan. Satu akun memakai satu kode sekali; harga founding tidak bisa digabung dengan kupon.</p>
      </div>
    </div>

    {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
    {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}

    <form class="grid gap-3 rounded-box border border-base-300 p-4 sm:grid-cols-2" onsubmit={create}>
      <h3 class="font-semibold sm:col-span-2">Kupon baru</h3>
      <label class="flex flex-col gap-1 text-sm">
        Kode
        <input class="input input-sm w-full uppercase" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_\-]+" autocomplete="off" placeholder="HEMAT20" bind:value={form.code} />
      </label>
      <div class="flex gap-2">
        <label class="flex flex-1 flex-col gap-1 text-sm">
          Potongan
          <input class="input input-sm w-full" type="number" required min="1" max={form.kind === 'percent' ? 100 : undefined} bind:value={form.value} />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          Satuan
          <select class="select select-sm" bind:value={form.kind}>
            <option value="percent">persen</option>
            <option value="amount">rupiah</option>
          </select>
        </label>
      </div>
      <fieldset class="flex flex-col gap-1.5 text-sm">
        <legend class="mb-1">Paket <span class="text-base-content/60">(kosong berarti semua)</span></legend>
        <div class="flex gap-4">
          {#each PLAN_CHOICES as p (p)}
            <label class="flex items-center gap-2">
              <input type="checkbox" class="checkbox checkbox-sm" checked={form.plans.includes(p)} onchange={() => (form.plans = toggled(form.plans, p))} />
              {PLANS[p].name}
            </label>
          {/each}
        </div>
      </fieldset>
      <fieldset class="flex flex-col gap-1.5 text-sm">
        <legend class="mb-1">Periode <span class="text-base-content/60">(kosong berarti keduanya)</span></legend>
        <div class="flex gap-4">
          {#each PERIOD_CHOICES as p (p)}
            <label class="flex items-center gap-2">
              <input type="checkbox" class="checkbox checkbox-sm" checked={form.periods.includes(p)} onchange={() => (form.periods = toggled(form.periods, p))} />
              {p === 'month' ? 'Bulanan' : 'Tahunan'}
            </label>
          {/each}
        </div>
      </fieldset>
      <label class="flex flex-col gap-1 text-sm">
        Kuota pemakaian <span class="text-base-content/60">(kosong berarti tanpa batas)</span>
        <input class="input input-sm w-full" type="number" min="1" bind:value={form.maxUses} />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Hari terakhir berlaku <span class="text-base-content/60">(kosong berarti tanpa batas)</span>
        <input class="input input-sm w-full" type="date" bind:value={form.lastDay} />
      </label>
      <label class="flex flex-col gap-1 text-sm sm:col-span-2">
        Catatan untuk admin
        <input class="input input-sm w-full" maxlength="200" placeholder="mis. promo grup Telegram November" bind:value={form.note} />
      </label>
      <div class="sm:col-span-2">
        <button class="btn btn-primary btn-sm" type="submit" disabled={busy}>Buat kupon</button>
      </div>
    </form>

    {#if rows === null}
      <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr><th>Kode</th><th>Potongan</th><th>Berlaku untuk</th><th class="text-right">Terpakai</th><th>Hari terakhir</th><th>Aktif</th></tr>
          </thead>
          <tbody>
            {#each rows as c (c.id)}
              <tr class:opacity-60={!c.active || ended(c)}>
                <td>
                  <span class="font-mono font-semibold">{c.code}</span>
                  {#if c.note}<span class="block text-xs text-base-content/70">{c.note}</span>{/if}
                </td>
                <td class="whitespace-nowrap">{off(c)}</td>
                <td class="text-xs">{scope(c)}</td>
                <td class="text-right tabular-nums">
                  {c.paid}{c.maxUses ? ` dari ${c.maxUses}` : ''}
                  {#if c.open}<span class="block text-xs text-base-content/70">{c.open} menunggu bayar</span>{/if}
                  {#if c.discountGiven}<span class="block text-xs text-base-content/70">potongan {rupiah(c.discountGiven)}</span>{/if}
                </td>
                <td class="whitespace-nowrap text-xs">{c.expiresAt ? `${day(c.expiresAt)}${ended(c) ? ', sudah lewat' : ''}` : 'tanpa batas'}</td>
                <td>
                  <input
                    type="checkbox"
                    class="toggle toggle-sm"
                    aria-label={`Kupon ${c.code} aktif`}
                    checked={c.active}
                    disabled={busy}
                    onchange={() => act(() => api.setCouponActive(c.id, !c.active), `Kupon ${c.code} ${c.active ? 'dimatikan' : 'diaktifkan'}.`)}
                  />
                </td>
              </tr>
            {:else}
              <tr><td colspan="6" class="text-base-content/70">Belum ada kupon. Buat yang pertama di atas.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
</section>
