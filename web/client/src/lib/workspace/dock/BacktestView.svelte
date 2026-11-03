<script lang="ts">
  // Uji strategi → Uji saran AI: how often the AI's call was right in the past. Set up on the left
  // (AnalysisForm: assets, dates, the indicators it reads, and the quota it costs, said before it starts),
  // with every earlier test under it carrying its score; the open one fills the right: how many calls were
  // right, by rating, the calls on the chart, and what failed. "Right" is the engine's: the asset against a
  // benchmark over the holding window (IHSG for .JK, which web/worker adds, else tradingagents'
  // benchmark_map default, the S&P 500), and the page says so in words. A phone shows one side at a time.
  import type { BacktestSummary } from '../../api';
  import { auth } from '../../auth.svelte';
  import { friendlyName, ratingLean } from '../../beginner/plain';
  import DecisionChart from '../../DecisionChart.svelte';
  import { formatDateTime, formatPercent, RATING_DIRECTION, readIndicators, rightBeyondChance } from '../../format';
  import { jobs } from '../../stores/jobs.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import StatusBadge from '../../StatusBadge.svelte';
  import { toTradingView } from '../../tv';
  import AnalysisForm from '../AnalysisForm.svelte';
  import Icon from '../Icon.svelte';

  jobs.refresh();

  const bt = $derived(ws.backtest);
  let activeTicker = $state('');
  const shown = $derived(bt && bt.tickers.includes(activeTicker) ? activeTicker : (bt?.tickers[0] ?? ''));
  /** On a phone, the form and history shown over an open test. */
  let showForm = $state(false);
  let lastId = '';
  $effect(() => {
    // A test just started or opened comes into view.
    const id = bt?.id ?? '';
    if (id && id !== lastId) showForm = false;
    lastId = id;
  });
  const detailShown = $derived(!!bt && !showForm);

  const name = (t: string) => friendlyName(toTradingView(t));
  const names = (tickers: string[]) => tickers.map(name).join(', ');
  const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const span = (r: { start: string; end: string }) => (r.start === r.end ? day(r.start) : `${day(r.start)} – ${day(r.end)}`);
  const every = (n: number) => (n === 1 ? 'tiap hari' : n === 7 ? 'tiap minggu' : n === 14 ? 'tiap 2 minggu' : n === 30 ? 'tiap bulan' : `tiap ${n} hari`);
  /** What a call is scored against, per tradingagents' benchmark_map (web/worker adds IHSG for .JK). */
  const yardstick = (tickers: string[]) =>
    [tickers.some((t) => t.toUpperCase().endsWith('.JK')) && 'saham .JK dibanding IHSG', tickers.some((t) => !t.toUpperCase().endsWith('.JK')) && 'aset lain dibanding S&P 500 (SPY)']
      .filter(Boolean)
      .join('; ');

  /** A history row's state, in one chip. */
  function chip(b: BacktestSummary): { text: string; cls: string; spin: boolean } {
    if (b.status === 'queued') return { text: 'Menunggu giliran', cls: 'badge-ghost', spin: false };
    if (b.status === 'running') return { text: b.progress ? `Berjalan ${b.progress.done} dari ${b.progress.total}` : 'Berjalan', cls: 'badge-info', spin: true };
    if (b.status === 'failed') return { text: 'Gagal', cls: 'badge-error', spin: false };
    if (b.status === 'cancelled') return { text: 'Dibatalkan', cls: 'badge-ghost', spin: false };
    if (b.score?.calls) return { text: `Benar ${b.score.hits} dari ${b.score.calls}`, cls: 'badge-neutral', spin: false };
    return { text: 'Belum bisa dinilai', cls: 'badge-ghost', spin: false };
  }

  function pick(b: BacktestSummary) {
    showForm = false;
    ws.openBacktest(b.id, { symbol: toTradingView(b.ticker.split(',')[0]) });
  }

  const cells = $derived(bt?.result?.cells ?? []);
  const calls = $derived(bt?.directional.length ?? 0);
  const hits = $derived(bt ? bt.directional.filter((c) => c.alpha! * RATING_DIRECTION[c.rating] > 0).length : 0);
  const holds = $derived(cells.filter((c) => (RATING_DIRECTION[c.rating] ?? 0) === 0).length);
  const pending = $derived(bt?.result?.summary?.pending ?? 0);
  const holding = $derived((bt?.result?.summary?.holding ?? '5 trading days').replace('trading days', 'hari bursa'));
  /** The right calls out of these that guessing would rarely reach: fewer can still be luck. */
  const need = $derived(rightBeyondChance(calls));
  /** Stopped before its end (a restart, a deploy, Batalkan): nothing scored yet, but the dates it finished are kept. */
  const stopped = $derived(!!bt?.backtest && (bt.backtest.status === 'failed' || bt.backtest.status === 'cancelled') && !bt.result);
  /** Sweeps made since run ids are given at the start can go on from where they stopped. */
  const resumable = $derived(stopped && !!bt?.backtest?.request.runId);
  /** Each rating: its calls, how many were right, and how far they beat the benchmark in their own direction. */
  const byRating = $derived.by(() => {
    const order = ['Buy', 'Overweight', 'Hold', 'Underweight', 'Sell'];
    const groups = new Map<string, { count: number; calls: number; hits: number; edges: number[] }>();
    for (const c of cells) {
      const g = groups.get(c.rating) ?? { count: 0, calls: 0, hits: 0, edges: [] };
      const dir = RATING_DIRECTION[c.rating] ?? 0;
      g.count++;
      if (!c.pending && c.alpha != null && dir !== 0) {
        g.calls++;
        if (c.alpha * dir > 0) g.hits++;
        g.edges.push(c.alpha * dir);
      }
      groups.set(c.rating, g);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([rating, g]) => ({ rating, label: ratingLean(rating).label, ...g, edge: g.edges.length ? g.edges.reduce((a, b) => a + b, 0) / g.edges.length : null }));
  });

  async function resume() {
    const next = await bt?.resume();
    if (next) {
      ws.openBacktest(next);
      jobs.refresh();
    }
  }

  async function remove() {
    if (bt && (await bt.remove())) {
      ws.closeBacktest();
      jobs.refresh();
    }
  }
</script>

<div class="ta-split">
  <aside class="ta-side {detailShown ? 'max-lg:hidden' : ''}" aria-label="Uji baru dan riwayat uji AI">
    <section class="ta-card p-5" aria-labelledby="bt-new">
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <h2 id="bt-new" class="ta-section-title">Uji baru</h2>
        <span class="text-sm ta-muted">3 langkah, lalu mulai</span>
      </div>
      <p class="mb-4 text-sm ta-muted">
        AI menganalisa aset di tanggal-tanggal lampau dengan data sampai tanggal itu, lalu arah sarannya dinilai dari 5 hari bursa sesudahnya. Ini menilai
        arah saran, bukan hasil trading.
      </p>
      <AnalysisForm mode="backtest" />
    </section>

    <section class="ta-card" aria-labelledby="bt-history">
      <div class="flex items-center justify-between gap-2 border-b border-base-300 px-5 py-3">
        <h2 id="bt-history" class="font-semibold">Riwayat uji AI</h2>
        <button type="button" class="btn btn-ghost btn-xs" onclick={() => jobs.refresh()}><Icon name="refresh" size={14} />Muat ulang</button>
      </div>
      {#if jobs.error}<p role="alert" class="px-5 pt-3 text-sm text-error">{jobs.error}</p>{/if}
      <ul class="ta-rows">
        {#each jobs.backtests as b (b.id)}
          {@const c = chip(b)}
          <li>
            <button type="button" class="ta-row" aria-current={ws.backtest?.id === b.id ? 'true' : undefined} onclick={() => pick(b)}>
              <span class="min-w-0 flex-1">
                <span class="ta-row-title">{names(b.ticker.split(','))}</span>
                <span class="ta-row-sub">{span(b.request)} · {every(b.request.everyNDays)}{jobs.everyone && b.owner ? ` · ${b.owner}` : ''}</span>
                {#if b.status === 'failed' && b.error}<span class="ta-row-sub truncate" title={b.error}>{b.error}</span>{/if}
              </span>
              <span class="badge badge-soft {c.cls} shrink-0 gap-1.5">{#if c.spin}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}{c.text}</span>
            </button>
          </li>
        {:else}
          <li class="px-3 py-4 text-sm ta-muted">{jobs.loaded ? 'Belum ada. Isi Uji baru di atas untuk memulai.' : 'Memuat…'}</li>
        {/each}
      </ul>
    </section>
  </aside>

  <section class="ta-detail {detailShown ? '' : 'max-lg:hidden'}" aria-label="Hasil uji saran AI">
    {#if detailShown}
      <button type="button" class="btn btn-ghost btn-sm w-fit lg:hidden" onclick={() => (showForm = true)}><Icon name="left" size={16} />Uji baru dan riwayat</button>
    {/if}
    {#if !bt}
      <div class="flex flex-col gap-5 rounded-[calc(var(--radius-box)*1.6)] border-[1.5px] border-dashed border-base-300 p-7">
        <div class="flex items-center gap-3">
          <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Icon name="backtest" size={22} stroke={2} /></span>
          <h2 class="ta-title">{jobs.backtests.length ? 'Pilih uji di riwayat' : 'Hasil uji AI muncul di sini'}</h2>
        </div>
        <p class="max-w-[62ch] text-[1.0625rem] leading-relaxed">
          {jobs.backtests.length ? 'Buka uji lama dari Riwayat uji AI, atau atur uji baru di kiri.' : 'Atur aset dan tanggal di kiri. Biaya kuotanya terlihat sebelum kamu menekan Mulai uji.'}
        </p>
        <dl class="grid max-w-[70ch] gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
          <dt class="font-semibold">Benar</dt>
          <dd class="ta-muted">
            Saran beli benar bila aset mengungguli patokannya dalam 5 hari bursa sesudahnya, walau harganya ikut turun; saran jual benar bila aset kalah dari
            patokannya. Contoh: saran beli BTC tetap benar bila BTC turun 1% sementara S&P 500 turun 3%. Patokannya IHSG untuk saham .JK, S&P 500 untuk
            aset lain.
          </dd>
          <dt class="font-semibold">Tunggu dulu</dt>
          <dd class="ta-muted">Tidak punya arah, jadi tidak dinilai.</dd>
          <dt class="font-semibold">Data per tanggal</dt>
          <dd class="ta-muted">
            Data yang dibaca AI dan indikator berhenti di tanggal itu. Tapi model AI-nya dilatih dengan data yang lebih baru, jadi untuk tanggal lama ia
            mungkin sudah tahu kelanjutannya, dan hasilnya bisa tampak lebih bagus dari kenyataan.
          </dd>
          <dt class="font-semibold">Berita lama</dt>
          <dd class="ta-muted">
            Berita dan media sosial untuk tanggal lama umumnya tidak tersedia, dan laporan keuangan saham IDX tidak dibaca. AI di uji ini membaca lebih
            sedikit daripada saat analisa hari ini.
          </dd>
          <dt class="font-semibold">Bukan uji trading</dt>
          <dd class="ta-muted">Tidak ada entry, stop loss, target, biaya, atau saldo. Untuk menguji aturan trading dengan biaya, pakai tab Indikator.</dd>
        </dl>
      </div>
    {:else if bt.loadError}
      <p role="alert" class="alert alert-soft alert-error items-start text-sm"><Icon name="alert" />Uji ini tidak bisa dimuat: {bt.loadError}</p>
    {:else if bt.backtest}
      {@const b = bt.backtest}
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="ta-title">{names(bt.tickers)}</h2>
            <StatusBadge status={b.status} />
          </div>
          <p class="mt-1 text-sm ta-muted">
            {span(b.request)} · {every(b.request.everyNDays)} · dibuat {formatDateTime(b.createdAt)}{auth.isAdmin ? ` · ${b.request.provider} · ${b.request.deepModel}` : ''}
          </p>
          {#if b.request.indicators?.length}<p class="text-sm ta-muted">Indikator yang dibaca AI: {readIndicators(b.request)}</p>{/if}
        </div>
        <div class="flex flex-wrap gap-2">
          {#if bt.live}
            <button type="button" class="btn btn-sm" onclick={() => bt.cancel()} disabled={bt.busy}>Batalkan</button>
          {:else}
            {#if resumable}
              <button type="button" class="btn btn-primary btn-sm" onclick={resume} disabled={bt.busy}><Icon name="refresh" size={16} />Lanjutkan uji</button>
            {:else if bt.result && (pending || bt.result.failures.length)}
              <button type="button" class="btn btn-sm" onclick={resume} disabled={bt.busy}><Icon name="refresh" size={16} />Lanjutkan dan nilai ulang</button>
            {/if}
            <button type="button" class="btn btn-ghost btn-sm" onclick={remove} disabled={bt.busy}><Icon name="trash" size={16} />Hapus</button>
          {/if}
        </div>
      </div>

      {#if bt.error}<p role="alert" class="alert alert-soft alert-error items-start text-sm"><Icon name="alert" />{bt.error}</p>{/if}

      {#if stopped}
        {@const done = Math.min(bt.progress?.done ?? 0, bt.progress?.total ?? 0)}
        <div class="ta-verdict" data-tone="warn">
          <span class="ta-verdict-icon"><Icon name="refresh" size={26} stroke={2.2} /></span>
          <p class="ta-verdict-title">Uji berhenti setelah {done} dari {bt.progress?.total ?? '?'} tanggal</p>
          <p class="ta-verdict-reason">
            {resumable
              ? 'Tanggal yang sudah selesai tersimpan. Lanjutkan uji menjalankan sisanya saja, dan hanya sisanya yang dihitung dari kuota analisa hari ini.'
              : 'Uji ini dibuat sebelum uji yang terputus bisa dilanjutkan. Jalankan uji baru dengan aset dan tanggal yang sama di kiri.'}
          </p>
        </div>
      {/if}

      {#if bt.live}
        <div class="ta-verdict" data-tone="info">
          <span class="ta-verdict-icon"><span class="loading loading-spinner loading-md" aria-hidden="true"></span></span>
          <p class="ta-verdict-title">Sedang berjalan</p>
          <p class="ta-verdict-reason">
            {bt.progress
              ? `AI sedang menganalisa ${bt.progress.ticker ? name(bt.progress.ticker) : 'aset'}${bt.progress.date ? ` pada ${day(bt.progress.date)}` : ''}, tanggal ke-${Math.min(bt.progress.done + 1, bt.progress.total)} dari ${bt.progress.total}.`
              : 'Menunggu giliran di antrean analisa.'}
          </p>
          <p class="ta-verdict-note">Tiap tanggal butuh beberapa menit. Boleh tinggalkan halaman ini; hasilnya muncul di Riwayat uji AI. · {bt.elapsed}</p>
        </div>
        {#if bt.progress}
          <progress class="progress progress-info w-full" value={bt.progress.done} max={bt.progress.total} aria-label="{bt.progress.done} dari {bt.progress.total} tanggal selesai"></progress>
        {/if}
      {/if}

      {#if bt.result?.summary}
        <div class="ta-verdict" data-tone="info">
          <span class="ta-verdict-icon"><Icon name="backtest" size={26} stroke={2.2} /></span>
          <p class="ta-verdict-title">{calls ? `Benar ${hits} dari ${calls} saran` : 'Belum ada saran yang bisa dinilai'}</p>
          <p class="ta-verdict-reason">
            {calls
              ? `Pada ${hits} dari ${calls} tanggal (${Math.round((hits / calls) * 100)}%), aset mengungguli patokannya sesudah saran beli, atau kalah darinya sesudah saran jual, dalam ${holding}.`
              : 'Semua saran Tunggu dulu, atau tanggalnya belum lewat masa penilaian.'}{holds ? ` ${holds} saran Tunggu dulu tidak dinilai.` : ''}{pending ? ` ${pending} masih menunggu harga.` : ''}
          </p>
          <!-- One grid row for the notes: the icon spans the box's first three rows (app.css .ta-verdict). -->
          <div class="ta-verdict-note flex flex-col gap-1">
            <p>
              Dinilai dibanding patokan: {yardstick(bt.tickers)}.
              {#if calls && need > calls}
                {calls} saran masih terlalu sedikit: semuanya benar pun masih bisa kebetulan.
              {:else if calls}
                Perlu minimal {need} benar dari {calls} supaya bukan sekadar kebetulan seperti lempar koin; {hits >= need ? 'hasil ini melewatinya' : 'hasil ini belum'}.
              {/if}
            </p>
            <p>Ini menilai arah saran, bukan hasil trading. Model AI mungkin sudah tahu kelanjutan tanggal lama, dan berita lama tidak tersedia.</p>
          </div>
        </div>

        {#if byRating.length}
          <div class="ta-compare">
            {#each byRating as g (g.rating)}
              <div class="ta-cmp gap-1">
                <span class="text-sm ta-muted">Saran {g.label}</span>
                <span class="text-xl font-bold tabular-nums">{g.calls ? `${g.hits} dari ${g.calls} benar` : `${g.count} saran`}</span>
                <span class="text-xs {g.edge == null ? 'ta-muted' : g.edge > 0 ? 'ta-up' : 'ta-down'}">
                  {g.edge == null ? 'tidak dinilai' : `hasil rata-rata ${formatPercent(g.edge)} dibanding patokan, searah saran`}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      {#if bt.result}
        <section class="ta-card" aria-labelledby="bt-chart">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-5 py-3">
            <h3 id="bt-chart" class="font-semibold">Saran AI di chart</h3>
            <div class="flex flex-wrap items-center gap-2">
              {#if bt.tickers.length > 1}
                <div class="join" role="group" aria-label="Aset">
                  {#each bt.tickers as t (t)}
                    <button type="button" class="btn btn-xs join-item" class:btn-neutral={t === shown} aria-pressed={t === shown} onclick={() => (activeTicker = t)}>{name(t)}</button>
                  {/each}
                </div>
              {/if}
              <button type="button" class="btn btn-ghost btn-xs" onclick={() => ws.setSymbol(toTradingView(shown))}>Buka di chart</button>
            </div>
          </div>
          <div class="p-3">
            {#key shown}
              <DecisionChart symbol={shown} decisions={bt.decisionsFor(shown)} height={300} />
            {/key}
          </div>
        </section>

        {#if bt.result.failures.length || bt.result.settlementFailures.length}
          <section class="ta-card p-5" aria-labelledby="bt-failed">
            <h3 id="bt-failed" class="mb-2 font-semibold">Tanggal yang gagal</h3>
            <ul class="flex flex-col gap-1 text-sm">
              {#each bt.result.failures as f (f.ticker + f.date)}
                <li><span class="font-medium">{name(f.ticker)}, {day(f.date)}</span>: {f.error}</li>
              {/each}
              {#each bt.result.settlementFailures as f, i (i)}
                <li><span class="font-medium">{name(f.ticker)}</span> (penilaian): {f.error}</li>
              {/each}
            </ul>
            <p class="mt-2 text-xs ta-muted">Lanjutkan dan nilai ulang menjalankan lagi hanya yang gagal atau belum dinilai.</p>
          </section>
        {/if}
      {/if}
    {:else}
      <div class="grid place-items-center p-8"><span class="loading loading-spinner" aria-label="Memuat"></span></div>
    {/if}
  </section>
</div>
