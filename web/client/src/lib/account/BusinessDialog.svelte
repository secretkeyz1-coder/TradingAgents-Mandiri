<script lang="ts">
  // Admin only: the business in one view (server/src/business.ts). Paying
  // members and the monthly recurring revenue they make, money in per month,
  // how trials convert, renewals due and paid plans that lapsed, coupon use,
  // and what the model work costs in tokens. Each chart has its numbers in a
  // table beside it.
  import { PLANS, rupiah } from '../../../../shared/plans';
  import { api, type BusinessReport } from '../api';

  let { onclose }: { onclose: () => void } = $props();

  let report = $state<BusinessReport | null>(null);
  let error = $state('');
  api
    .adminBusiness()
    .then((r) => (report = r))
    .catch((e) => (error = (e as Error).message));

  const PLAN_ROWS = ['pro', 'creator'] as const;
  const KIND: Record<string, string> = {
    analysis: 'Analisa multi-agent',
    backtest: 'Backtest',
    agent: 'Agent chart',
    translate: 'Terjemahan Pine Script',
    brief: 'Ringkasan pasar (situs)',
  };
  const compact = (n: number) => n.toLocaleString('id-ID', { notation: 'compact', maximumFractionDigits: 1 });
  const month = (m: string, style: 'short' | 'long') =>
    new Date(`${m}-01T12:00:00Z`).toLocaleDateString('id-ID', style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' });
  const date = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const paying = $derived(report ? PLAN_ROWS.reduce((n, p) => n + report!.subscribers.paid[p].month + report!.subscribers.paid[p].year, 0) : 0);
  const conversion = $derived(report && report.conversion.trials ? Math.round((report.conversion.converted / report.conversion.trials) * 100) : null);
  const revenuePeak = $derived(report ? Math.max(1, ...report.revenue.map((m) => m.amount)) : 1);
  /** The last 30 days in WIB, with the days nothing was used filled in as zero. */
  const tokenDays = $derived.by(() => {
    if (!report) return [];
    const used = new Map(report.tokens.days.map((d) => [d.day, d.input + d.output]));
    return Array.from({ length: 30 }, (_, i) => {
      const day = new Date(Date.now() + 7 * 3_600_000 - (29 - i) * 86_400_000).toISOString().slice(0, 10);
      return { day, total: used.get(day) ?? 0 };
    });
  });
  const tokenPeak = $derived(Math.max(1, ...tokenDays.map((d) => d.total)));
</script>

<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="business-title">
  <!-- A grid, not a flex column: a column would squeeze the scrolling stats strip to nothing in a full modal. -->
  <div class="modal-box grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 id="business-title" class="text-lg font-semibold">Dashboard bisnis</h2>
        <p class="text-sm text-base-content/70">Rupiah tanpa kode unik transfer. Akun admin tidak dihitung.</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick={onclose}>Tutup</button>
    </div>

    {#if error}
      <p role="alert" class="text-sm text-error">{error}</p>
    {:else if !report}
      <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
    {:else}
      <div class="stats stats-vertical w-full border border-base-300 lg:stats-horizontal">
        <div class="stat">
          <div class="stat-title whitespace-normal">Pendapatan bulanan berulang</div>
          <div class="stat-value text-2xl tabular-nums">{rupiah(report.mrr)}</div>
          <div class="stat-desc whitespace-normal">dari {paying} pelanggan berbayar; tahunan dihitung per bulan</div>
        </div>
        <div class="stat">
          <div class="stat-title whitespace-normal">Trial jadi berbayar</div>
          <div class="stat-value text-2xl tabular-nums">{conversion === null ? '–' : `${conversion}%`}</div>
          <div class="stat-desc whitespace-normal">{report.conversion.converted} dari {report.conversion.trials} trial, 90 hari terakhir</div>
        </div>
        <div class="stat">
          <div class="stat-title whitespace-normal">Perlu perpanjang</div>
          <div class="stat-value text-2xl tabular-nums">{report.renewals.week}</div>
          <div class="stat-desc whitespace-normal">dalam 7 hari; {report.renewals.month} dalam 30 hari</div>
        </div>
        <div class="stat">
          <div class="stat-title whitespace-normal">Tidak memperpanjang</div>
          <div class="stat-value text-2xl tabular-nums">{report.lapsed}</div>
          <div class="stat-desc whitespace-normal">paket berbayar yang berakhir, 30 hari terakhir</div>
        </div>
      </div>

      <section class="flex flex-col gap-3" aria-labelledby="revenue-title">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="revenue-title" class="text-sm font-semibold">Pendapatan per bulan</h3>
          <p class="text-xs text-base-content/60">12 bulan terakhir; arahkan kursor ke batang untuk angkanya</p>
        </div>
        <div class="flex h-36 items-stretch gap-0.5 border-b border-base-300" aria-hidden="true">
          {#each report.revenue as m (m.month)}
            <div class="flex flex-1 flex-col justify-end hover:bg-base-content/5" title={`${month(m.month, 'long')}: ${rupiah(m.amount)}, ${m.orders} pembayaran`}>
              <div class="w-full rounded-t-[4px] bg-accent" style:height={`${(m.amount / revenuePeak) * 100}%`}></div>
            </div>
          {/each}
        </div>
        <div class="flex gap-0.5" aria-hidden="true">
          {#each report.revenue as m (m.month)}<span class="flex-1 text-center text-[11px] text-base-content/60">{month(m.month, 'short')}</span>{/each}
        </div>
        <details class="text-sm">
          <summary class="cursor-pointer text-xs text-base-content/70">Tabel pendapatan per bulan</summary>
          <div class="mt-2 overflow-x-auto">
            <table class="table table-xs">
              <thead><tr><th>Bulan</th><th class="text-right">Pendapatan</th><th class="text-right">Pembayaran</th></tr></thead>
              <tbody>
                {#each report.revenue as m (m.month)}
                  <tr><td>{month(m.month, 'long')}</td><td class="text-right tabular-nums">{rupiah(m.amount)}</td><td class="text-right tabular-nums">{m.orders}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div class="grid gap-6 lg:grid-cols-2">
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold">Pelanggan sekarang</h3>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead><tr><th>Paket</th><th class="text-right">Bulanan</th><th class="text-right">Tahunan</th></tr></thead>
              <tbody>
                {#each PLAN_ROWS as plan (plan)}
                  <tr>
                    <td>{PLANS[plan].name}</td>
                    <td class="text-right tabular-nums">{report.subscribers.paid[plan].month}</td>
                    <td class="text-right tabular-nums">{report.subscribers.paid[plan].year}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="text-xs text-base-content/70">
            Juga {report.subscribers.trials} akun dalam masa coba dan {report.subscribers.granted} akun berpaket tanpa membayar (diberi admin atau kupon penuh).
          </p>
        </section>

        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold">Berakhir dalam 30 hari</h3>
          {#if report.renewals.soon.length}
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead><tr><th>Akun</th><th>Paket</th><th>Berakhir</th></tr></thead>
                <tbody>
                  {#each report.renewals.soon as r (r.username)}
                    <tr><td class="font-mono">{r.username}</td><td>{PLANS[r.plan].name}</td><td class="whitespace-nowrap">{date(r.until)}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="text-xs text-base-content/70">Pengingat dikirim otomatis 7, 3, dan 1 hari sebelumnya.</p>
          {:else}
            <p class="text-sm text-base-content/70">Tidak ada paket berbayar yang berakhir dalam 30 hari.</p>
          {/if}
        </section>
      </div>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold">Kupon yang terpakai</h3>
        {#if report.coupons.length}
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead><tr><th>Kode</th><th class="text-right">Lunas</th><th class="text-right">Total potongan</th></tr></thead>
              <tbody>
                {#each report.coupons as c (c.code)}
                  <tr><td class="font-mono whitespace-nowrap">{c.code}</td><td class="text-right tabular-nums">{c.uses}</td><td class="text-right tabular-nums">{rupiah(c.discount)}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="text-sm text-base-content/70">Belum ada pembayaran lunas yang memakai kupon.</p>
        {/if}
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="tokens-title">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="tokens-title" class="text-sm font-semibold">Token model AI, 30 hari terakhir</h3>
          <p class="text-sm tabular-nums">
            {compact(report.tokens.total.input + report.tokens.total.output)} token
            <span class="text-base-content/60">({compact(report.tokens.total.input)} masuk, {compact(report.tokens.total.output)} keluar)</span>{#if report.tokens.total.cost !== null},
              perkiraan {rupiah(report.tokens.total.cost)}{/if}
          </p>
        </div>
        {#if report.tokens.total.input + report.tokens.total.output === 0}
          <p class="text-sm text-base-content/70">Belum ada pemakaian yang tercatat. Token mulai dicatat sejak versi ini berjalan.</p>
        {:else}
          <div class="flex h-24 items-stretch gap-0.5 border-b border-base-300" aria-hidden="true">
            {#each tokenDays as d (d.day)}
              <div class="flex flex-1 flex-col justify-end hover:bg-base-content/5" title={`${date(`${d.day}T12:00:00Z`)}: ${compact(d.total)} token`}>
                <div class="w-full rounded-t-[4px] bg-accent" style:height={`${(d.total / tokenPeak) * 100}%`}></div>
              </div>
            {/each}
          </div>
          <div class="grid gap-6 lg:grid-cols-2">
            <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead><tr><th>Pekerjaan</th><th class="text-right">Token</th>{#if report.tokens.priced}<th class="text-right">Perkiraan</th>{/if}</tr></thead>
              <tbody>
                {#each report.tokens.kinds as k (k.kind)}
                  <tr>
                    <td>{KIND[k.kind] ?? k.kind}</td>
                    <td class="text-right tabular-nums">{compact(k.input + k.output)}</td>
                    {#if report.tokens.priced}<td class="text-right tabular-nums">{rupiah(k.cost ?? 0)}</td>{/if}
                  </tr>
                {/each}
              </tbody>
            </table>
            </div>
            <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead><tr><th>Akun terbanyak</th><th>Paket</th><th class="text-right">Token</th>{#if report.tokens.priced}<th class="text-right">Perkiraan</th>{/if}</tr></thead>
              <tbody>
                {#each report.tokens.users as u (u.username)}
                  <tr>
                    <td class="font-mono">{u.username}</td>
                    <td>{PLANS[u.plan].name}</td>
                    <td class="text-right tabular-nums">{compact(u.input + u.output)}</td>
                    {#if report.tokens.priced}<td class="text-right tabular-nums">{rupiah(u.cost ?? 0)}</td>{/if}
                  </tr>
                {:else}
                  <tr><td colspan="4" class="text-base-content/70">Sejauh ini hanya pekerjaan server.</td></tr>
                {/each}
              </tbody>
            </table>
            </div>
          </div>
          <details class="text-sm">
            <summary class="cursor-pointer text-xs text-base-content/70">Per model, dan tabel harian</summary>
            <div class="mt-2 grid gap-6 lg:grid-cols-2">
              <table class="table table-xs">
                <thead><tr><th>Model</th><th class="text-right">Masuk</th><th class="text-right">Keluar</th></tr></thead>
                <tbody>
                  {#each report.tokens.models as m (m.model)}
                    <tr><td class="font-mono">{m.model}</td><td class="text-right tabular-nums">{compact(m.input)}</td><td class="text-right tabular-nums">{compact(m.output)}</td></tr>
                  {/each}
                </tbody>
              </table>
              <table class="table table-xs">
                <thead><tr><th>Tanggal</th><th class="text-right">Token</th></tr></thead>
                <tbody>
                  {#each tokenDays.filter((d) => d.total > 0) as d (d.day)}
                    <tr><td>{date(`${d.day}T12:00:00Z`)}</td><td class="text-right tabular-nums">{compact(d.total)}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </details>
        {/if}
        {#if !report.tokens.priced}
          <p class="text-xs text-base-content/70">Isi LLM_COST_IDR_PER_MTOK di server (rupiah per sejuta token masuk dan keluar, mis. "15000,60000") untuk melihat perkiraan biaya.</p>
        {/if}
      </section>
    {/if}
  </div>
  <button class="modal-backdrop" aria-label="Tutup" onclick={onclose}></button>
</div>
