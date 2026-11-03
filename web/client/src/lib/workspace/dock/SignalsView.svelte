<script module lang="ts">
  /** An engine another page asked Rekam jejak live to open on ("fib", "scalper", …). */
  let asked = $state<string | null>(null);

  /** Open Rekam jejak live on one engine's record (Indikator's "Lihat rekam jejak live"). */
  export function pickSource(key: string) {
    asked = key;
  }
</script>

<script lang="ts">
  // Uji strategi → Rekam jejak live: the signal ledger (server/src/ledger.ts). Every signal the built-in
  // engines fire on the tracked symbols is recorded when it appears and scored by a simulated account after
  // costs, the same for every member. Pick an engine on the left (or all of them) and its record opens on
  // the right: one verdict, how far the sample is from one worth trusting, the curve, the engine's own test
  // on history beside its live record, the breakdown and the signals themselves. "Notifikasi sinyalku" under
  // the list is the member's own alerts (server/src/alerts.ts), scored from target and stop only, so it says
  // "sebelum biaya". Live signals are the forward test; history (filled once, from older bars) shows only
  // when asked. Crypto is also recorded on other venues, from their own bars, to compare them; the
  // simulated account counts the default source (Binance).
  import { ColorType, createChart, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
  import { api, type Ledger, type LedgerStats, type SignalHistory } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { formatDateTime, formatR, TIMEFRAME_NAMES } from '../../format';
  import { indicators } from '../../stores/indicators.svelte';
  import { lab, periodLabel, timeframeLabel, verdictOf } from '../../stores/lab.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { theme, tokenColor } from '../../theme.svelte';
  import { cryptoBase, CRYPTO_VENUES, onVenue, toTradingView, type VenueId } from '../../tv';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';

  const NAMES: Record<string, string> = { scalper: 'Scalper Pro+', fib: 'Fib Golden Zone', pob: 'PoB BYSTRA', donchian: 'Donchian breakout harian' };
  const TF = TIMEFRAME_NAMES;
  const SESSION: Record<string, string> = { asia: 'Asia', london: 'London', newyork: 'New York' };
  const STATUS: Record<string, string> = { open: 'Berjalan', win: 'Kena target', loss: 'Kena stop', exit: 'Keluar', expired: 'Kedaluwarsa', replaced: 'Diganti' };
  const GROUPS = [
    { key: 'bySource', label: 'Mesin', title: 'Per mesin' },
    { key: 'bySymbol', label: 'Aset', title: 'Per aset' },
    { key: 'byTimeframe', label: 'Timeframe', title: 'Per timeframe' },
    { key: 'bySession', label: 'Sesi', title: 'Per sesi' },
    { key: 'byVenue', label: 'Bursa', title: 'Per bursa' },
  ] as const;
  type GroupKey = (typeof GROUPS)[number]['key'];
  const PERIODS = [7, 30, 90, 365];
  const PAGE = 20;
  const venueName = (id: string) => CRYPTO_VENUES.find((v) => v.id === id)?.label ?? id;

  if (!lab.loaded) lab.load();
  if (!indicators.loaded) indicators.load();

  let days = $state(30);
  let history = $state(false);
  /** The engine on the right; "" = all of them. */
  let source = $state('');
  let symbol = $state('');
  let venue = $state('binance');
  let realFees = $state(false);
  let group = $state<GroupKey>('bySource');
  let limit = $state(PAGE);
  /** Every engine together: the list on the left, and the record while none is picked. */
  let all = $state<Ledger | null>(null);
  /** The picked engine's own record. */
  let one = $state<{ source: string; ledger: Ledger } | null>(null);
  let error = $state('');
  let loading = $state(false);
  let mine = $state<SignalHistory | null>(null);
  let mineError = $state('');
  let detail: HTMLElement | undefined = $state();

  $effect(() => {
    // Indikator's "Lihat rekam jejak live": open on that engine.
    if (asked) {
      source = asked;
      asked = null;
    }
  });

  let seq = 0;
  async function load() {
    const n = ++seq;
    const picked = source;
    const q = { days, history, venue, symbol: symbol || undefined };
    loading = true;
    try {
      const [a, o] = await Promise.all([api.ledger(q), picked ? api.ledger({ ...q, source: picked }) : null]);
      if (n !== seq) return;
      all = a;
      one = o ? { source: picked, ledger: o } : null;
      error = '';
    } catch (e) {
      if (n === seq) error = (e as Error).message;
    } finally {
      if (n === seq) loading = false;
    }
  }
  $effect(() => {
    void [days, history, venue, source, symbol];
    load();
  });
  // Scored as bars close: refresh every minute while the tab is open.
  $effect(() => {
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });
  // Other venues record crypto only: a non-crypto asset filter would show nothing there.
  $effect(() => {
    if (venue !== 'binance' && symbol && !cryptoBase(symbol)) symbol = '';
  });
  $effect(() => {
    void [days, history, venue, source, symbol];
    limit = PAGE;
  });

  let mineSeq = 0;
  $effect(() => {
    const n = ++mineSeq;
    api.alertHistory(days).then(
      (h) => {
        if (n !== mineSeq) return;
        mine = h;
        mineError = '';
      },
      (e: Error) => {
        if (n === mineSeq) mineError = e.message;
      },
    );
  });

  const data = $derived(source ? (one?.source === source ? one.ledger : null) : all);
  const t = $derived(data?.total ?? null);
  const config = $derived(all?.config ?? null);
  const venues = $derived(config?.venues ?? []);
  const symbols = $derived((config?.symbols ?? []).filter((s) => venue === 'binance' || cryptoBase(s)));
  const name = (s: string) => friendlyName(toTradingView(s));
  const joinNames = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} dan ${xs.at(-1)}`);
  const assetsText = $derived(symbol ? name(symbol) : joinNames(symbols.map(name)));
  const periodText = $derived(days === 365 ? '1 tahun' : `${days} hari`);
  const title = $derived(source ? (NAMES[source] ?? source) : 'Semua mesin bawaan');
  const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const usd = (x: number) => x.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  const priceText = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : 5 });
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'ta-up' : x < 0 ? 'ta-down' : '');
  const feeText = (x: number) => `${(x * 100).toLocaleString('id-ID', { maximumFractionDigits: 3 })}%`;

  /** The engines in the list: the four built in, then any other source the ledger records. */
  const engines = $derived.by(() => {
    const by = new Map((all?.bySource ?? []).map((g) => [g.key, g]));
    const keys = [...Object.keys(NAMES), ...[...by.keys()].filter((k) => !(k in NAMES))];
    return [{ key: '', name: 'Semua mesin', stats: all?.total ?? null }, ...keys.map((key) => ({ key, name: NAMES[key] ?? key, stats: by.get(key) ?? null }))];
  });
  function rowSub(s: LedgerStats | null) {
    if (!s?.count) return 'Belum ada sinyal';
    if (!s.closed) return `${s.open} berjalan, belum ada yang selesai`;
    return `${s.closed} sinyal${s.open ? `, ${s.open} berjalan` : ''} · ${pct(s.winRate)} untung`;
  }

  /** On a phone the record sits under the list: the one picked comes into view once it has loaded. */
  let reveal = false;
  function pick(key: string) {
    const narrow = matchMedia('(max-width: 63.99rem)').matches;
    if (key === source) {
      if (narrow) detail?.scrollIntoView({ block: 'start' });
      return;
    }
    reveal = narrow;
    source = key;
  }
  $effect(() => {
    if (!data || !reveal) return;
    reveal = false;
    requestAnimationFrame(() => detail?.scrollIntoView({ block: 'start' }));
  });

  /** The record in one verdict: what happened after costs, then the caveat that matters most. */
  const verdict = $derived.by((): { tone: 'loss' | 'pass' | 'info'; icon: IconName; title: string; reason: string; note: string } | null => {
    if (!t || !data) return null;
    if (!t.closed) {
      return t.open
        ? {
            tone: 'info',
            icon: 'clock',
            title: 'Belum ada yang selesai',
            reason: `${t.open} sinyal sedang berjalan. Hasil pertama muncul saat sinyal kena target, kena stop, atau kedaluwarsa.`,
            note: source === 'donchian' ? 'Mesin harian memberi sedikit sinyal; perlu beberapa bulan untuk menilainya.' : '',
          }
        : { tone: 'info', icon: 'clock', title: 'Belum ada sinyal', reason: `Belum ada sinyal dalam ${periodText} pada pilihan ini. Sinyal baru dicatat tiap candle tutup.`, note: '' };
    }
    const toneOf = t.totalR > 0 ? 'pass' : t.totalR < 0 ? 'loss' : 'info';
    return {
      tone: toneOf,
      icon: toneOf === 'pass' ? 'gainTrend' : toneOf === 'loss' ? 'lossTrend' : 'minus',
      title: t.totalR > 0 ? `Untung ${formatR(t.totalR, 1)}` : t.totalR < 0 ? `Rugi ${formatR(t.totalR, 1)}` : 'Impas',
      reason: `${t.closed} sinyal selesai${t.open ? ` dan ${t.open} berjalan` : ''} dalam ${periodText}: ${pct(t.winRate)} untung, rata-rata ${formatR(t.expectancy)} per sinyal setelah biaya.`,
      note: source ? engineNote(t) : allNote(data),
    };
  });
  function allNote(d: Ledger) {
    const paid = (all?.bySource ?? []).some((g) => g.closed && (g.expectancy ?? 0) > 0);
    const end = d.equity.at(-1)?.equity ?? d.config.startBalance;
    return `${paid ? '' : 'Belum ada mesin yang untung setelah biaya dalam periode ini. '}Akun simulasi ${usd(d.config.startBalance)} USD kini ${usd(end)} USD.`;
  }
  function engineNote(s: LedgerStats) {
    if (s.closed < 10) return `${s.closed} sinyal terlalu sedikit untuk menilai mesin ini.`;
    const gross = s.grossExpectancy ?? 0;
    if ((s.expectancy ?? 0) >= 0) return `Sebelum biaya ${formatR(gross)} per sinyal; biayanya ${formatR(-(s.avgCostR ?? 0))} per sinyal.`;
    if (Math.abs(gross) < 0.05) return `Sebelum biaya hampir impas (${formatR(gross)} per sinyal). Biayanya yang membuat rugi.`;
    if (gross > 0) return `Sebelum biaya untung ${formatR(gross)} per sinyal. Biayanya yang membuat rugi.`;
    return `Sebelum biaya pun rugi ${formatR(gross)} per sinyal.`;
  }
  /** For all engines: whether costs, not the signals, made the loss, and where they weigh most. */
  const insight = $derived.by(() => {
    if (source || !t?.closed || !t.avgCostR) return '';
    const gross = t.grossExpectancy ?? 0;
    const net = t.expectancy ?? 0;
    let text = '';
    if (gross > 0 && net < 0) text = `Sebelum biaya rata-rata ${formatR(gross)} per sinyal, tapi biaya ${formatR(-t.avgCostR)} per sinyal lebih besar dari untungnya.`;
    else if (net < 0 && t.avgCostR > Math.abs(gross)) text = `Sebelum biaya, rata-rata ${formatR(gross)} per sinyal. Biaya ${formatR(-t.avgCostR)} per sinyal adalah bagian terbesar dari ruginya.`;
    if (!text) return '';
    const costly = (all?.bySource ?? []).filter((g) => g.closed && g.avgCostR).sort((a, b) => (b.avgCostR ?? 0) - (a.avgCostR ?? 0));
    if (costly.length > 1) text += ` Paling berat di ${NAMES[costly[0].key] ?? costly[0].key}: ${formatR(-(costly[0].avgCostR ?? 0))} per sinyal.`;
    return text;
  });

  /** The engine's newest test on history, for "Riwayat dibanding live". */
  const run = $derived(source ? lab.latest(`engine:${source}`) : undefined);
  const canTest = $derived(!!source && !!lab.meta?.engines[source]);
  function testEngine() {
    // Indikator opens on the indicator the test form names.
    lab.strategy = `engine:${source}`;
    ws.setDock('lab');
  }
  function openRun(id: string) {
    lab.open(id);
    ws.setDock('lab');
  }

  const groupOptions = $derived(GROUPS.filter((g) => (g.key !== 'bySource' || !source) && (g.key !== 'byVenue' || venues.length > 1)));
  const shownGroup = $derived(groupOptions.find((g) => g.key === group) ?? groupOptions[0]);
  const rows = $derived<LedgerStats[]>(data ? (shownGroup.key === 'byVenue' && realFees ? data.byVenueReal : data[shownGroup.key]) : []);
  const label = (g: GroupKey, key: string) =>
    g === 'bySource' ? (NAMES[key] ?? key) : g === 'bySymbol' ? name(key) : g === 'byTimeframe' ? (TF[key] ?? key) : g === 'bySession' ? (SESSION[key] ?? key) : venueName(key);
  const unknownFees = $derived(
    Object.entries(data?.venueFees ?? {})
      .filter(([, fee]) => fee == null)
      .map(([v]) => venueName(v)),
  );
  const otherVenues = $derived(venues.filter((v) => v !== 'binance').map(venueName));

  const items = $derived(data?.items ?? []);
  /** The chart symbol of a ledger row: on its own venue when it has one. */
  const chartSymbol = (s: { symbol: string; venue: string }) => {
    const tv = toTradingView(s.symbol);
    return s.venue ? (onVenue(tv, s.venue as VenueId) ?? tv) : tv;
  };

  const indicatorName = (key: string) => NAMES[key] ?? mine?.scriptNames[key] ?? indicators.catalog.find((c) => c.key === key)?.name ?? 'Indikator yang sudah dihapus';

  // --- The curve: cumulative R after costs, from the simulated account (fixed risk per signal, so R is its P&L over that risk).
  const curve = $derived.by(() => {
    if (!data) return [];
    const { startBalance, riskUsd } = data.config;
    const seen = new Map<number, number>();
    for (const p of data.equity) seen.set(Math.floor(Date.parse(p.time) / 1000), (p.equity - startBalance) / (riskUsd || 1));
    return [...seen.entries()].sort(([a], [b]) => a - b).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
  });
  const lastR = $derived(curve.at(-1)?.value ?? 0);
  let box: HTMLDivElement | undefined = $state();
  let chart: IChartApi | undefined;
  let line: ISeriesApi<'Line'> | undefined;
  let zero: IPriceLine | undefined;
  $effect(() => {
    if (!box) return;
    chart = createChart(box, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: false },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      localization: { locale: 'id-ID', priceFormatter: (v: number) => formatR(v, 1) },
      handleScroll: false,
      handleScale: false,
    });
    line = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    zero = line.createPriceLine({ price: 0, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    return () => {
      chart?.remove();
      chart = line = zero = undefined;
    };
  });
  $effect(() => {
    void theme.dark;
    const points = curve;
    if (!chart || !line || !box) return;
    chart.applyOptions({
      layout: { textColor: tokenColor('--color-base-content', 0.7) },
      grid: { vertLines: { visible: false }, horzLines: { color: tokenColor('--color-base-300', 0.6) } },
    });
    line.applyOptions({ color: lastR >= 0 ? tokenColor('--color-success') : tokenColor('--color-error') });
    zero?.applyOptions({ color: tokenColor('--color-base-content', 0.45) });
    line.setData(points);
    chart.timeScale().fitContent();
  });
</script>

<div class="flex flex-col">
  <header class="flex flex-wrap items-end justify-between gap-4 px-4 pt-5 lg:px-6 lg:pt-6">
    <div class="flex max-w-[72ch] flex-col gap-1">
      <h2 class="ta-title">Rekam jejak live</h2>
      <p class="ta-muted">Tiap sinyal mesin bawaan dicatat saat muncul, lalu dinilai otomatis di akun simulasi setelah biaya. Sama untuk semua member.</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="join" role="group" aria-label="Periode">
        {#each PERIODS as d (d)}
          <button type="button" class="btn btn-sm join-item" class:btn-neutral={days === d} aria-pressed={days === d} onclick={() => (days = d)}>{d === 365 ? '1 tahun' : `${d} hari`}</button>
        {/each}
      </div>
      <label class="select select-sm w-auto">
        <span class="label">Aset</span>
        <select bind:value={symbol}>
          <option value="">Semua</option>
          {#each symbols as s (s)}<option value={s}>{name(s)}</option>{/each}
        </select>
      </label>
      {#if venues.length > 1}
        <label class="select select-sm w-auto">
          <span class="label">Bursa</span>
          <select bind:value={venue}>
            {#each venues as v (v)}<option value={v}>{v === 'binance' ? 'Binance (utama)' : venueName(v)}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="label cursor-pointer gap-2 text-sm">
        <input type="checkbox" class="toggle toggle-sm" bind:checked={history} />
        Termasuk riwayat
      </label>
      {#if loading}<span class="loading loading-spinner loading-xs" aria-label="Memuat"></span>{/if}
    </div>
  </header>

  {#if venue !== 'binance' || history}
    <div class="flex flex-col gap-2 px-4 pt-4 lg:px-6">
      {#if venue !== 'binance'}
        <p class="alert alert-soft alert-info items-start text-sm">
          <Icon name="info" />Catatan {venueName(venue)}: mesin yang sama pada candle {venueName(venue)}, khusus kripto, dengan biaya yang sama dengan Binance supaya yang dibandingkan hanya
          harganya. Akun simulasi utama dan rekap Telegram memakai Binance.
        </p>
      {/if}
      {#if history}
        <p class="alert alert-soft alert-warning items-start text-sm">
          <Icon name="alert" />Riwayat dihitung dari candle lama saat pencatatan pertama kali menyala: itu uji ke belakang, bukan bukti ke depan.
        </p>
      {/if}
    </div>
  {/if}

  <div class="ta-split">
    <aside class="ta-side" aria-label="Pilih mesin dan notifikasimu">
      <section class="ta-card" aria-labelledby="eng-h">
        <div class="flex items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
          <h3 id="eng-h" class="font-semibold">Mesin bawaan</h3>
          <span class="text-sm ta-muted">{periodText}</span>
        </div>
        <ul class="ta-rows">
          {#each engines as e (e.key)}
            <li>
              <button type="button" class="ta-row" aria-current={source === e.key ? 'true' : undefined} onclick={() => pick(e.key)}>
                <span class="min-w-0 flex-1">
                  <span class="ta-row-title">{e.name}</span>
                  <span class="ta-row-sub">{all ? rowSub(e.stats) : 'Memuat…'}</span>
                </span>
                {#if e.stats?.closed}
                  <span class="flex shrink-0 flex-col items-end">
                    <span class="font-bold tabular-nums {tone(e.stats.totalR)}">{formatR(e.stats.totalR, 1)}</span>
                    <span class="ta-row-sub tabular-nums">{formatR(e.stats.expectancy)} per sinyal</span>
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        <p class="px-5 pb-4 text-xs ta-muted">Angka kanan: total dan rata-rata per sinyal, setelah biaya.</p>
      </section>

      <section class="ta-card" aria-labelledby="mine-h">
        <div class="flex items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
          <h3 id="mine-h" class="font-semibold">Notifikasi sinyalku</h3>
          {#if mine?.summary.alerts}<span class="text-sm ta-muted">{mine.summary.alerts} dari {mine.summary.max} aktif</span>{/if}
        </div>
        <div class="flex flex-col gap-3 p-5 text-sm">
          {#if mineError}
            <p role="alert" class="text-error">{mineError}</p>
          {:else if !mine}
            <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
          {:else if !mine.summary.total}
            {#if mine.summary.alerts}
              <p>{mine.summary.alerts} notifikasi aktif, belum ada sinyal dalam {periodText}. Tiap sinyal yang kamu terima muncul di sini.</p>
            {:else}
              <p>Belum ada. Pasang notifikasi untuk indikator yang lolos uji: tiap sinyal yang kamu terima dicatat di sini, lalu dinilai dari target dan stop-nya.</p>
              <button type="button" class="btn btn-sm w-fit" onclick={() => ws.setDock('lab')}>Buka Indikator</button>
            {/if}
          {:else}
            {@const s = mine.summary}
            <p>
              <span class="text-xl font-bold tabular-nums {tone(s.r)}">{formatR(s.r, 1)}</span>
              <span class="ta-muted">dari {s.total} sinyal, sebelum biaya</span>
            </p>
            <p class="ta-muted">{s.win} kena target · {s.loss} kena stop{s.open ? ` · ${s.open} berjalan` : ''}</p>
            <ul class="flex flex-col gap-1.5">
              {#each mine.byIndicator.slice(0, 4) as g (g.indicator + g.timeframe)}
                <li class="flex items-baseline justify-between gap-3">
                  <span class="min-w-0 truncate" title={indicatorName(g.indicator)}>{indicatorName(g.indicator)} · {TF[g.timeframe] ?? g.timeframe}</span>
                  <span class="shrink-0 tabular-nums"><span class="ta-muted">{g.total} sinyal</span> <span class="font-semibold {tone(g.r)}">{formatR(g.r, 1)}</span></span>
                </li>
              {/each}
            </ul>
            <button type="button" class="link link-accent w-fit font-medium" onclick={() => ws.openCalls()}>Lihat semua di Riwayat call</button>
          {/if}
        </div>
      </section>
    </aside>

    <section class="ta-detail scroll-mt-4" bind:this={detail} aria-labelledby="live-title">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 id="live-title" class="ta-title">{title}</h3>
          {#if config}
            <p class="mt-1 text-sm ta-muted">
              {periodText} · {assetsText} · {venue === 'binance' ? 'Binance' : venueName(venue)} · akun simulasi {usd(config.startBalance)} USD, risiko {config.riskPct}% per sinyal
            </p>
          {/if}
        </div>
        {#if canTest}<button type="button" class="btn btn-sm" onclick={testEngine}><Icon name="lab" size={16} />Uji mesin ini di riwayat</button>{/if}
      </div>

      {#if error}<p role="alert" class="alert alert-soft alert-error items-start text-sm"><Icon name="alert" />{error}</p>{/if}

      {#if !data || !t || !verdict}
        {#if !error}<div class="grid place-items-center p-10"><span class="loading loading-spinner" aria-label="Memuat"></span></div>{/if}
      {:else}
        <div class="ta-verdict" data-tone={verdict.tone}>
          <span class="ta-verdict-icon"><Icon name={verdict.icon} size={26} stroke={2.2} /></span>
          <p class="ta-verdict-title">{verdict.title}</p>
          <p class="ta-verdict-reason">{verdict.reason}</p>
          {#if verdict.note}<p class="ta-verdict-note">{verdict.note}</p>{/if}
        </div>

        <div class="ta-card flex flex-col gap-2 p-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="font-semibold">{!t.closed ? 'Belum ada sinyal selesai' : t.closed < 100 ? `Baru ${t.closed} dari 100 sinyal` : `${t.closed} sinyal selesai`}</span>
            <span class="text-sm tabular-nums ta-muted">{Math.min(t.closed, 100)} / 100</span>
          </div>
          <progress class="progress progress-info w-full" value={Math.min(t.closed, 100)} max="100" aria-label="{Math.min(t.closed, 100)} dari 100 sinyal selesai"></progress>
          <p class="text-sm ta-muted">
            {t.closed >= 100 ? 'Sudah lewat 100 sinyal selesai: statistiknya mulai bisa dipercaya.' : 'Statistik mulai bisa dipercaya setelah 100 sinyal selesai. Sampai saat itu, anggap hasil ini sementara.'}
          </p>
        </div>

        {#if insight}<p role="note" class="alert alert-soft alert-warning items-start text-sm"><Icon name="info" />{insight}</p>{/if}

        {#if curve.length > 1}
          <section class="ta-card" aria-labelledby="curve-h">
            <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-base-300 px-5 py-3">
              <h4 id="curve-h" class="font-semibold">Untung-rugi kumulatif, setelah biaya</h4>
              <span class="text-sm ta-muted">dalam R; akun simulasi {usd(data.config.startBalance)} → {usd(data.equity.at(-1)?.equity ?? data.config.startBalance)} USD</span>
            </div>
            <div
              class="h-60 w-full p-2"
              bind:this={box}
              role="img"
              aria-label="Kurva untung-rugi kumulatif {title} dalam {periodText}: {lastR >= 0 ? 'naik' : 'turun'} ke {formatR(lastR, 1)}."
            ></div>
          </section>
        {/if}

        {#if source}
          <section class="flex flex-col gap-2.5" aria-labelledby="vs-h">
            <h4 id="vs-h" class="ta-section-title">Riwayat dibanding live</h4>
            <div class="ta-compare">
              <div class="ta-cmp">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-semibold">Uji di riwayat</span>
                  {#if run}{@const v = verdictOf(run)}<span class="badge badge-soft {v.badge} gap-1"><Icon name={v.icon} size={14} />{v.word}</span>{/if}
                </div>
                {#if run}
                  <p>
                    {#if run.total.oos.n < 30}<span class="ta-big">{run.total.oos.n}</span> <span class="text-sm ta-muted">trade di data uji</span>
                    {:else}<span class="ta-big {tone(run.total.oos.net)}">{formatR(run.total.oos.net)}</span> <span class="text-sm ta-muted">per trade</span>{/if}
                  </p>
                  <p class="text-sm ta-muted">
                    Uji terakhir: {timeframeLabel(run.config.timeframe)} di {joinNames(run.config.symbols.map(name))}, {periodLabel(run.config.days)}, data uji.{run.total.oos.n < 30 ? ' Data uji perlu minimal 30 trade.' : ''}
                  </p>
                  <button type="button" class="link link-accent w-fit text-sm font-medium" onclick={() => openRun(run.id)}>Lihat hasil uji</button>
                {:else}
                  <p class="text-sm ta-muted">{canTest ? 'Mesin ini belum pernah kamu uji di riwayat. Ujinya memakai kuota uji indikator harian.' : 'Mesin ini belum bisa diuji dengan paketmu.'}</p>
                {/if}
              </div>
              <div class="ta-cmp" data-key>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-semibold text-accent">Live, {periodText}</span>
                  <span class="text-sm ta-muted">{t.closed} sinyal selesai</span>
                </div>
                <p>
                  {#if t.closed}<span class="ta-big {tone(t.expectancy)}">{formatR(t.expectancy)}</span> <span class="text-sm ta-muted">per sinyal</span>
                  {:else}<span class="ta-big ta-muted">menunggu</span>{/if}
                </p>
                <p class="text-sm ta-muted">Rata-rata per sinyal setelah biaya, di {assetsText}.</p>
              </div>
            </div>
            <p class="text-xs ta-muted">Asetnya bisa berbeda: uji riwayat memakai pilihanmu, rekam jejak live mencatat {joinNames(symbols.map(name))} di semua timeframe mesin.</p>
          </section>
        {/if}

        {#if t.closed}
          <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <div class="ta-cmp gap-1">
              <dt class="text-sm ta-muted">Sinyal selesai</dt>
              <dd class="ta-big">{t.closed}</dd>
              <dd class="text-xs ta-muted">{t.tp} kena target · {t.sl} kena stop · {t.other} lainnya{t.open ? ` · ${t.open} berjalan` : ''}</dd>
            </div>
            <div class="ta-cmp gap-1">
              <dt class="text-sm ta-muted">Untung</dt>
              <dd class="ta-big">{pct(t.winRate)}</dd>
              <dd class="text-xs ta-muted">dari sinyal yang selesai</dd>
            </div>
            <div class="ta-cmp gap-1">
              <dt class="text-sm ta-muted">Rata-rata per sinyal</dt>
              <dd class="ta-big {tone(t.expectancy)}">{formatR(t.expectancy)}</dd>
              <dd class="text-xs ta-muted">sebelum biaya {formatR(t.grossExpectancy)}</dd>
            </div>
            <div class="ta-cmp gap-1">
              <dt class="text-sm ta-muted">Total</dt>
              <dd class="ta-big {tone(t.totalR)}">{formatR(t.totalR, 1)}</dd>
              <dd class="text-xs ta-muted">{t.totalR >= 0 ? '+' : '−'}{usd(Math.abs(t.totalR * data.config.riskUsd))} USD</dd>
            </div>
            <div class="ta-cmp gap-1">
              <dt class="text-sm ta-muted">Turun terdalam</dt>
              <dd class="ta-big">{formatR(-t.maxDrawdownR, 1)}</dd>
              <dd class="text-xs ta-muted">dari puncak ke dasar</dd>
            </div>
          </dl>
        {/if}

        <section class="flex flex-col gap-2.5" aria-labelledby="per-h">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 id="per-h" class="ta-section-title">{shownGroup.title}</h4>
            <div class="join" role="group" aria-label="Kelompokkan menurut">
              {#each groupOptions as g (g.key)}
                <button type="button" class="btn btn-sm join-item" class:btn-neutral={shownGroup.key === g.key} aria-pressed={shownGroup.key === g.key} onclick={() => (group = g.key)}>{g.label}</button>
              {/each}
            </div>
          </div>
          {#if shownGroup.key === 'byVenue'}
            <div class="flex flex-wrap items-start justify-between gap-2">
              <p class="max-w-[75ch] text-xs ta-muted">
                Kripto yang dicatat di semua bursa, dengan pilihan di atas. Sinyal bisa berbeda antarbursa karena harga dan sumbu candle tiap bursa sedikit berbeda.
                {#if realFees}
                  Biaya nyata: fee taker dasar tiap bursa (tanpa diskon VIP, BNB, atau token), dibayar saat masuk dan saat keluar; slippage dan pajak kripto belum termasuk. Akun utama memakai
                  biaya kripto {feeText(data.config.cryptoCost)} per trade.
                  {#if unknownFees.length}Fee {unknownFees.join(', ')} belum diketahui, jadi tidak ditampilkan.{/if}
                {/if}
              </p>
              <label class="label cursor-pointer gap-2 text-sm">
                <input type="checkbox" class="toggle toggle-sm" bind:checked={realFees} />
                Biaya nyata tiap bursa
              </label>
            </div>
          {/if}
          <div class="ta-card overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th scope="col">{shownGroup.label}</th>
                  <th scope="col" class="text-right">Selesai</th>
                  <th scope="col" class="text-right">Untung</th>
                  <th scope="col" class="text-right">Per sinyal</th>
                  <th scope="col" class="text-right">Sebelum biaya</th>
                  <th scope="col" class="text-right">Biaya</th>
                  <th scope="col" class="text-right">Total</th>
                  <th scope="col" class="text-right">Turun terdalam</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as g (g.key)}
                  <tr>
                    <th scope="row" class="font-medium">
                      {label(shownGroup.key, g.key)}
                      {#if shownGroup.key === 'byVenue' && realFees && data.venueFees[g.key] != null}
                        <span class="block text-xs font-normal ta-muted">fee {feeText(data.venueFees[g.key]!)} per sisi</span>
                      {/if}
                    </th>
                    <td class="text-right tabular-nums">{g.closed}{#if g.open}<span class="ta-muted">{` +${g.open} berjalan`}</span>{/if}</td>
                    <td class="text-right tabular-nums">{pct(g.winRate)}</td>
                    <td class="text-right tabular-nums {tone(g.expectancy)}">{formatR(g.expectancy)}</td>
                    <td class="text-right tabular-nums">{formatR(g.grossExpectancy)}</td>
                    <td class="text-right tabular-nums">{formatR(g.avgCostR == null ? null : -g.avgCostR)}</td>
                    <td class="text-right tabular-nums {tone(g.totalR)}">{formatR(g.totalR, 1)}</td>
                    <td class="text-right tabular-nums">{formatR(-g.maxDrawdownR, 1)}</td>
                  </tr>
                {:else}
                  <tr><td colspan="8" class="ta-muted">Belum ada sinyal pada pilihan ini. Sinyal live tercatat tiap candle tutup.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="text-xs ta-muted sm:hidden">Geser tabel ke samping untuk melihat semua kolom.</p>
        </section>

        <section class="flex flex-col gap-2.5" aria-labelledby="sig-h">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h4 id="sig-h" class="ta-section-title">Sinyal terbaru</h4>
            {#if items.length}<span class="text-sm ta-muted">{Math.min(limit, items.length)} terbaru dari {items.length}</span>{/if}
          </div>
          <div class="ta-card overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Aset</th>
                  <th scope="col">Mesin</th>
                  <th scope="col">Arah</th>
                  <th scope="col" class="text-right">Entry</th>
                  <th scope="col" class="text-right">Stop</th>
                  <th scope="col" class="text-right">Target</th>
                  <th scope="col" class="text-right">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {#each items.slice(0, limit) as s (s.id)}
                  <tr>
                    <td class="whitespace-nowrap tabular-nums">
                      {formatDateTime(s.signalAt)}
                      {#if !s.live}<span class="badge badge-sm badge-ghost">riwayat</span>{/if}
                    </td>
                    <th scope="row" class="font-medium whitespace-nowrap">
                      <button type="button" class="link link-hover" onclick={() => ws.setSymbol(chartSymbol(s))}>{name(s.symbol)}</button>
                      {#if s.dataSource === 'yahoo'}<span class="badge badge-sm badge-soft badge-warning" title="Data Yahoo, tertunda">tertunda</span>{/if}
                    </th>
                    <td class="whitespace-nowrap">{NAMES[s.source] ?? s.source} · {TF[s.timeframe] ?? s.timeframe}</td>
                    <td>
                      <span class="badge badge-soft {s.side === 'BUY' ? 'badge-success' : 'badge-error'} gap-1">
                        <Icon name={s.side === 'BUY' ? 'up' : 'down'} size={14} />{s.side === 'BUY' ? 'Beli' : 'Jual'}
                      </span>
                    </td>
                    <td class="text-right tabular-nums">{priceText(s.entry)}</td>
                    <td class="text-right tabular-nums ta-muted">{priceText(s.stopLoss)}</td>
                    <td class="text-right tabular-nums ta-muted">{priceText(s.takeProfit)}</td>
                    <td class="whitespace-nowrap text-right tabular-nums">
                      <span class="ta-muted">{STATUS[s.status] ?? s.status}</span>
                      <span class="font-semibold {tone(s.netR)}">{formatR(s.netR)}</span>
                    </td>
                  </tr>
                {:else}
                  <tr><td colspan="8" class="ta-muted">Belum ada sinyal untuk pilihan ini.</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs ta-muted">"Diganti" berarti sinyal baru berlawanan arah menutup posisi.</p>
            {#if items.length > limit}<button type="button" class="btn btn-sm" onclick={() => (limit += PAGE)}>Tampilkan {Math.min(PAGE, items.length - limit)} lagi</button>{/if}
          </div>
        </section>
      {/if}

      <details class="border-t border-base-300 pt-1">
        <summary class="flex cursor-pointer items-center gap-2 py-3 font-semibold ta-muted"><Icon name="book" size={16} />Apa arti angka ini?</summary>
        <dl class="grid max-w-[75ch] gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt class="font-semibold">R</dt>
          <dd class="ta-muted">
            Risiko satu sinyal: jarak entry ke stop.{config ? ` Akun simulasi mempertaruhkan ${config.riskPct}% (${usd(config.riskUsd)} USD) per sinyal, jadi 1R = ${usd(config.riskUsd)} USD.` : ''}
          </dd>
          <dt class="font-semibold">Untung</dt>
          <dd class="ta-muted">Bagian sinyal selesai yang ditutup untung setelah biaya.</dd>
          <dt class="font-semibold">Rata-rata per sinyal</dt>
          <dd class="ta-muted">Total R dibagi jumlah sinyal selesai, setelah biaya. Di atas nol berarti mesinnya menghasilkan.</dd>
          <dt class="font-semibold">Sebelum biaya</dt>
          <dd class="ta-muted">
            Hasil yang sama tanpa fee bursa. Selisihnya dengan rata-rata per sinyal adalah biaya{config ? `; kripto ${feeText(config.cryptoCost)} per trade, fee taker saat masuk dan keluar` : ''}.
          </dd>
          <dt class="font-semibold">Turun terdalam</dt>
          <dd class="ta-muted">Penurunan terbesar kurva dari puncak ke dasar berikutnya.</dd>
          <dt class="font-semibold">Sumber harga</dt>
          <dd class="ta-muted">
            Kripto dan emas 15 menit dan 1 jam memakai harga real-time Binance (emas dari kontrak XAUUSDT, tanpa jam saat pasar spot tutup). Emas harian masih dari Yahoo dan ditandai "tertunda".
            {#if otherVenues.length}Kripto juga dicatat di {joinNames(otherVenues)} dari candle masing-masing sebagai pembanding (Per bursa); akun simulasi dan rekap Telegram tetap memakai Binance.{/if}
          </dd>
        </dl>
        <p class="mt-3 text-xs ta-muted">Hasil riset dan simulasi, bukan nasihat keuangan.</p>
      </details>
    </section>
  </div>
</div>
