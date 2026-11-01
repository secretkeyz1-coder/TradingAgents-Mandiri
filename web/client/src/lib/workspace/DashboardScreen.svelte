<script lang="ts">
  // Beranda: how the member's signals are doing. The calls their notifications made over a
  // chosen period (server/src/alerts.ts GET /alerts/history: live signals only, R from targets
  // and stops), by day, by indicator and by asset, with the calls themselves; beside them what
  // runs now and what today holds (open calls, quota, scheduled analyses, price alerts). Each
  // part leads to the screen that acts on it.
  import { INDICATOR_NAMES, SIGNAL_STATUS, TIMEFRAME_LABELS } from '../alertLabels';
  import { api, INTERVALS, type Interval, type PriceLevels, type SignalCall, type SignalHistory } from '../api';
  import { ratingBadge } from '../format';
  import { usage } from '../stores/usage.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import ResultCurve from './ResultCurve.svelte';

  const PERIODS = [
    { days: 7, label: '7 hari' },
    { days: 30, label: '30 hari' },
    { days: 90, label: '90 hari' },
    { days: 365, label: '1 tahun' },
  ];
  type Filter = 'all' | 'win' | 'loss' | 'open';
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Semua' },
    { key: 'win', label: 'TP kena' },
    { key: 'loss', label: 'SL kena' },
    { key: 'open', label: 'Berjalan' },
  ];

  let days = $state(30);
  let data = $state<SignalHistory | null>(null);
  let error = $state('');
  let levels = $state<PriceLevels | null>(null);
  let filter = $state<Filter>('all');

  $effect(() => {
    const wanted = days;
    api
      .alertHistory(wanted)
      .then((next) => {
        if (wanted !== days) return;
        data = next;
        error = '';
      })
      .catch((e) => (error = (e as Error).message));
  });
  watch.load();
  usage.refresh();
  api
    .priceLevels()
    .then((l) => (levels = l))
    .catch(() => {
      /* the side column just leaves price alerts out */
    });

  const s = $derived(data?.summary);
  const period = $derived(PERIODS.find((p) => p.days === days)?.label ?? `${days} hari`);
  const name = (indicator: string) => INDICATOR_NAMES[indicator] ?? data?.scriptNames[indicator] ?? 'Skrip yang sudah dihapus';
  const tf = (t: string) => TIMEFRAME_LABELS[t as keyof typeof TIMEFRAME_LABELS] ?? t;
  const R = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2).replace('.', ',')}R`);
  const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)}%`);
  const rate = (t: { win: number; loss: number }) => (t.win + t.loss ? t.win / (t.win + t.loss) : null);
  const price = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : 6 });
  const running = (c: SignalCall) => c.status === 'open' && c.tracked;
  const outcome = (c: SignalCall) => (c.status === 'open' && !c.tracked ? 'tidak dipantau lagi' : SIGNAL_STATUS[c.status]);
  const tone = (c: SignalCall) =>
    c.status === 'win' ? 'badge-soft badge-success' : c.status === 'loss' ? 'badge-soft badge-error' : running(c) ? 'badge-soft badge-info' : 'badge-ghost';
  const calls = $derived((data?.calls ?? []).filter((c) => filter === 'all' || (filter === 'open' ? running(c) : c.status === filter)));
  const open = $derived((data?.calls ?? []).filter(running));
  const others = $derived(
    s
      ? (
          [
            [s.exit, 'keluar karena kondisi'],
            [s.expired, 'kedaluwarsa'],
            [s.replaced, 'diganti'],
            [s.stopped, 'tidak dipantau lagi'],
          ] as const
        ).filter(([n]) => n > 0)
      : [],
  );
  const waiting = $derived(levels?.items.filter((l) => l.active).slice(0, 5) ?? []);
  const quota = (u: { used: number; limit: number }) => (u.limit ? `${u.used} dari ${u.limit}` : `${u.used}, tanpa batas`);

  /** A call's asset on the Keputusan AI chart, at the call's timeframe. */
  function openAsset(c: Pick<SignalCall, 'tvSymbol' | 'timeframe'>) {
    ws.setChartView('ai');
    if ((INTERVALS as readonly string[]).includes(c.timeframe)) ws.setTimeframe(c.timeframe as Interval);
    ws.setSymbol(c.tvSymbol);
  }

  /** Signal notifications are set from the Keputusan AI chart's Notifikasi menu. */
  function openNotifications() {
    ws.setChartView('ai');
    ws.showChart();
  }
</script>

{#snippet stat(label: string, value: string, note = '', toneClass = '')}
  <div class="flex min-w-0 flex-col gap-0.5">
    <dt class="text-xs text-base-content/70">{label}</dt>
    <dd class="text-2xl font-semibold tabular-nums {toneClass}">{value}</dd>
    {#if note}<dd class="text-xs text-base-content/70">{note}</dd>{/if}
  </div>
{/snippet}

<div class="h-full overflow-auto">
  <h1 class="sr-only">Beranda</h1>
  <div class="mx-auto grid w-full max-w-6xl gap-x-8 gap-y-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
    <section class="flex min-w-0 flex-col gap-5" aria-labelledby="signals-title">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="flex flex-col gap-0.5">
          <h2 id="signals-title" class="text-lg font-semibold tracking-tight">Sinyalmu</h2>
          <p class="text-sm text-base-content/70">
            Call dari notifikasi sinyalmu dan hasilnya{s ? `, dengan ${s.alerts} dari ${s.max} notifikasi aktif` : ''}.
          </p>
        </div>
        <div class="join" role="group" aria-label="Periode">
          {#each PERIODS as p (p.days)}
            <button class="btn btn-sm join-item" class:btn-active={days === p.days} aria-pressed={days === p.days} onclick={() => (days = p.days)}>{p.label}</button>
          {/each}
        </div>
      </div>

      {#if error}
        <p role="alert" class="text-sm text-error">{error}</p>
      {:else if !data || !s}
        <span class="loading loading-spinner" aria-label="Memuat"></span>
      {:else}
        {#if !data.telegram}
          <p class="text-sm text-warning">
            Telegram belum tersambung: call tetap tercatat di sini, tapi tidak dikirim ke HP-mu. Sambungkan di menu akun → Profil → Notifikasi.
          </p>
        {/if}

        {#if !s.total}
          <div class="flex flex-col items-start gap-3 rounded-box border border-dashed border-base-300 p-5">
            <p class="max-w-[60ch] text-sm">
              Belum ada call dalam {period} terakhir. Pasang notifikasi sinyal dari tombol Notifikasi di chart Keputusan AI: setiap sinyal baru dan
              hasilnya (TP atau SL) tercatat di sini.
            </p>
            <button class="btn btn-sm btn-primary" onclick={openNotifications}>Buka chart Keputusan AI</button>
          </div>
        {:else}
          <dl class="grid grid-cols-3 gap-x-6 gap-y-4 border-y border-base-300 py-4 sm:grid-cols-6">
            {@render stat('Call', String(s.total))}
            {@render stat('TP kena', String(s.win))}
            {@render stat('SL kena', String(s.loss))}
            {@render stat('Rasio menang', pct(s.winRate), `dari ${s.win + s.loss} yang kena TP/SL`)}
            {@render stat('Total R', R(s.r), '', s.r > 0 ? 'text-success' : s.r < 0 ? 'text-error' : '')}
            {@render stat('Berjalan', String(s.open))}
          </dl>
          {#if others.length}
            <p class="-mt-2 text-xs text-base-content/70">
              Juga {others.map(([n, label]) => `${n} ${label}`).join(', ')}: dihitung sebagai call, tapi tidak masuk R karena harga keluarnya tidak tercatat.
            </p>
          {/if}

          <section class="flex flex-col gap-2" aria-labelledby="curve-title">
            <h3 id="curve-title" class="text-sm font-semibold">R kumulatif, menurut tanggal sinyal</h3>
            {#if data.daily.some((d) => d.win + d.loss > 0)}
              <ResultCurve days={data.daily} />
            {:else}
              <p class="text-sm text-base-content/70">Belum ada call yang selesai di TP atau SL dalam periode ini.</p>
            {/if}
          </section>

          <div class="grid gap-6 xl:grid-cols-2">
            <section class="min-w-0" aria-labelledby="by-indicator-title">
              <h3 id="by-indicator-title" class="mb-1 text-sm font-semibold">Per indikator</h3>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr><th>Indikator</th><th class="text-right">Call</th><th class="text-right">TP</th><th class="text-right">SL</th><th class="text-right">Rasio</th><th class="text-right">R</th></tr>
                  </thead>
                  <tbody class="tabular-nums">
                    {#each data.byIndicator as g (g.indicator + g.timeframe)}
                      <tr>
                        <td>{name(g.indicator)} {tf(g.timeframe)}</td>
                        <td class="text-right">{g.total}</td>
                        <td class="text-right">{g.win}</td>
                        <td class="text-right">{g.loss}</td>
                        <td class="text-right">{pct(rate(g))}</td>
                        <td class="text-right" class:text-success={g.r > 0} class:text-error={g.r < 0}>{R(g.r)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </section>
            <section class="min-w-0" aria-labelledby="by-asset-title">
              <h3 id="by-asset-title" class="mb-1 text-sm font-semibold">Per aset</h3>
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr><th>Aset</th><th class="text-right">Call</th><th class="text-right">TP</th><th class="text-right">SL</th><th class="text-right">Rasio</th><th class="text-right">R</th></tr>
                  </thead>
                  <tbody class="tabular-nums">
                    {#each data.bySymbol as g (g.tvSymbol)}
                      <tr>
                        <td><button class="link link-hover font-mono font-semibold" onclick={() => ws.setSymbol(g.tvSymbol)}>{g.symbol}</button></td>
                        <td class="text-right">{g.total}</td>
                        <td class="text-right">{g.win}</td>
                        <td class="text-right">{g.loss}</td>
                        <td class="text-right">{pct(rate(g))}</td>
                        <td class="text-right" class:text-success={g.r > 0} class:text-error={g.r < 0}>{R(g.r)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section class="flex flex-col gap-2" aria-labelledby="calls-title">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 id="calls-title" class="text-sm font-semibold">Riwayat call</h3>
              <div class="join" role="group" aria-label="Saring menurut hasil">
                {#each FILTERS as f (f.key)}
                  <button class="btn btn-xs join-item" class:btn-active={filter === f.key} aria-pressed={filter === f.key} onclick={() => (filter = f.key)}>{f.label}</button>
                {/each}
              </div>
            </div>
            {#if !calls.length}
              <p class="text-sm text-base-content/70">Tidak ada call dengan hasil ini dalam periode ini.</p>
            {:else}
              <div class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr><th>Waktu sinyal</th><th>Aset</th><th>Indikator</th><th>Arah</th><th>Entry · SL · TP</th><th>Hasil</th><th class="text-right">R</th></tr>
                  </thead>
                  <tbody>
                    {#each calls as c (c.id)}
                      <tr>
                        <td class="whitespace-nowrap text-xs tabular-nums">{c.signalTime}</td>
                        <td><button class="link link-hover font-mono font-semibold" onclick={() => openAsset(c)}>{c.symbol}</button></td>
                        <td class="whitespace-nowrap">{name(c.indicator)} {tf(c.timeframe)}</td>
                        <td class="font-medium" class:text-success={c.side === 'BUY'} class:text-error={c.side === 'SELL'}>{c.side}</td>
                        <td class="whitespace-nowrap font-mono text-xs tabular-nums">{price(c.entry)} · {price(c.stopLoss)} · {price(c.takeProfit)}</td>
                        <td><span class="badge badge-sm whitespace-nowrap {tone(c)}">{outcome(c)}</span></td>
                        <td class="text-right tabular-nums" class:text-success={(c.r ?? 0) > 0} class:text-error={(c.r ?? 0) < 0}>{R(c.r)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              {#if data.calls.length >= 200}
                <p class="text-xs text-base-content/70">Daftar ini memuat 200 call terbaru; angka di atas menghitung semua call dalam periode ini.</p>
              {/if}
            {/if}
          </section>
        {/if}
      {/if}
    </section>

    <aside class="flex min-w-0 flex-col gap-7 lg:border-l lg:border-base-300 lg:pl-8" aria-label="Hari ini">
      <section aria-labelledby="running-title">
        <h2 id="running-title" class="text-sm font-semibold">Sedang berjalan</h2>
        {#if !data}
          <p class="mt-1 text-sm text-base-content/70">Memuat…</p>
        {:else if !open.length}
          <p class="mt-1 text-sm text-base-content/70">Tidak ada call yang masih berjalan.</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-3">
            {#each open.slice(0, 6) as c (c.id)}
              <li class="flex flex-col gap-0.5 text-sm">
                <span class="flex items-center gap-2">
                  <button class="link link-hover font-mono font-semibold" onclick={() => openAsset(c)}>{c.symbol}</button>
                  <span class="text-xs font-medium" class:text-success={c.side === 'BUY'} class:text-error={c.side === 'SELL'}>{c.side}</span>
                  <span class="ml-auto truncate text-xs text-base-content/70">{name(c.indicator)} {tf(c.timeframe)}</span>
                </span>
                <span class="font-mono text-xs tabular-nums text-base-content/70">E {price(c.entry)} · SL {price(c.stopLoss)} · TP {price(c.takeProfit)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section aria-labelledby="quota-title">
        <h2 id="quota-title" class="text-sm font-semibold">Kuota hari ini</h2>
        {#if usage.value}
          <dl class="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt>Analisa AI</dt>
            <dd class="text-right tabular-nums">{quota(usage.value.analyses)}</dd>
            <dt>Chat agent</dt>
            <dd class="text-right tabular-nums">{quota(usage.value.chat)}</dd>
          </dl>
          <p class="mt-1 text-xs text-base-content/70">Direset pukul 00.00 WIB.</p>
        {:else}
          <p class="mt-1 text-sm text-base-content/70">Memuat…</p>
        {/if}
      </section>

      <section aria-labelledby="watch-title">
        <div class="flex items-baseline justify-between gap-2">
          <h2 id="watch-title" class="text-sm font-semibold">Analisa terjadwal</h2>
          <button class="link link-hover text-xs" onclick={() => ws.setDock('watch')}>Kelola</button>
        </div>
        {#if !watch.value}
          <p class="mt-1 text-sm text-base-content/70">Memuat…</p>
        {:else if !watch.value.items.length}
          <p class="mt-1 text-sm text-base-content/70">Belum ada. Klik Analisa harian di atas chart untuk menambah simbol.</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-1.5">
            {#each watch.value.items.slice(0, 5) as item (item.symbol)}
              <li class="flex items-center justify-between gap-2 text-sm">
                <button class="link link-hover font-mono" onclick={() => ws.setSymbol(item.tvSymbol)}>{item.symbol}</button>
                {#if item.last?.rating}
                  <button class="badge badge-sm {ratingBadge(item.last.rating)}" onclick={() => ws.openRun(item.last!.id, { symbol: item.tvSymbol })}>{item.last.rating}</button>
                {:else}
                  <span class="text-xs text-base-content/70">belum ada hasil</span>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section aria-labelledby="levels-title">
        <div class="flex items-baseline justify-between gap-2">
          <h2 id="levels-title" class="text-sm font-semibold">Alert harga</h2>
          <button class="link link-hover text-xs" onclick={() => ws.setDock('alerts')}>Kelola</button>
        </div>
        {#if !levels}
          <p class="mt-1 text-sm text-base-content/70">Memuat…</p>
        {:else if !waiting.length}
          <p class="mt-1 text-sm text-base-content/70">Tidak ada yang menunggu.</p>
        {:else}
          <ul class="mt-2 flex flex-col gap-1.5">
            {#each waiting as l (l.id)}
              <li class="flex items-center justify-between gap-2 text-sm">
                <button class="link link-hover font-mono" onclick={() => ws.setSymbol(l.tvSymbol)}>{l.symbol}</button>
                <span class="tabular-nums">
                  <span class={l.direction === 'above' ? 'text-success' : 'text-error'}>{l.direction === 'above' ? 'Naik ke' : 'Turun ke'}</span>
                  {price(l.price)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </aside>
  </div>
</div>
