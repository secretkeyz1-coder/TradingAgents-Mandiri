<script lang="ts">
  // The signal ledger (server/src/ledger.ts): every signal the built-in engines
  // fired on the tracked symbols, scored by the simulated account after costs.
  // Live signals are the forward test; history (filled once, from older bars)
  // is shown only when asked, since it was scored after the fact.
  import { ColorType, createChart, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
  import { api, type Ledger, type LedgerStats } from '../../api';
  import { auth } from '../../auth.svelte';
  import { formatDateTime } from '../../format';
  import { ws } from '../../stores/workspace.svelte';
  import { theme, tokenColor } from '../../theme.svelte';
  import { toTradingView } from '../../tv';

  const NAMES: Record<string, string> = { pob: 'PoB BYSTRA', scalper: 'Scalper Pro+', fib: 'Fib Golden Zone', donchian: 'Donchian breakout' };
  const TF: Record<string, string> = { '15m': '15m', '1h': '1j', '4h': '4j', '1d': 'harian' };
  const SESSION: Record<string, string> = { asia: 'Asia', london: 'London', newyork: 'New York' };
  const STATUS: Record<string, string> = { open: 'berjalan', win: 'TP', loss: 'SL', expired: 'kedaluwarsa', replaced: 'diganti' };
  const GROUPS = [
    { key: 'bySource', label: 'Per mesin' },
    { key: 'bySymbol', label: 'Per simbol' },
    { key: 'byTimeframe', label: 'Per timeframe' },
    { key: 'bySession', label: 'Per sesi' },
  ] as const;

  let days = $state(30);
  let history = $state(false);
  let source = $state('');
  let symbol = $state('');
  let group = $state<(typeof GROUPS)[number]['key']>('bySource');
  let data = $state<Ledger | null>(null);
  let error = $state('');
  let loading = $state(false);
  let note = $state('');

  async function recapTest() {
    note = '';
    try {
      const res = await api.ledgerRecapTest();
      note = res.ok ? 'Rekap tes terkirim ke Telegram-mu.' : `Tidak terkirim: ${res.error}`;
    } catch (e) {
      note = (e as Error).message;
    }
  }

  async function load() {
    loading = true;
    try {
      data = await api.ledger({ days, history, source: source || undefined, symbol: symbol || undefined });
      error = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void [days, history, source, symbol];
    load();
  });
  // Scored as bars close: refresh every minute while the tab is open.
  $effect(() => {
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  const t = $derived(data?.total);
  const label = (g: string, key: string) =>
    g === 'bySource' ? (NAMES[key] ?? key) : g === 'byTimeframe' ? (TF[key] ?? key) : g === 'bySession' ? (SESSION[key] ?? key) : key;
  const r = (x: number | null | undefined, digits = 2) => (x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}R`);
  const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const num = (x: number | null | undefined, digits = 2) => (x == null ? '–' : x.toFixed(digits));
  const usd = (x: number) => x.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  const priceText = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : 5 });
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'text-success' : x < 0 ? 'text-error' : '');

  // --- Equity curve of the simulated account.
  let box: HTMLDivElement | undefined = $state();
  let chart: IChartApi | undefined;
  let line: ISeriesApi<'Line'> | undefined;
  $effect(() => {
    if (!box) return;
    chart = createChart(box, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: false },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale: false,
    });
    line = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    return () => {
      chart?.remove();
      chart = line = undefined;
    };
  });
  $effect(() => {
    void theme.dark;
    const points = data?.equity ?? [];
    if (!chart || !line) return;
    const last = points.at(-1)?.equity ?? data?.config.startBalance ?? 0;
    chart.applyOptions({
      layout: { textColor: tokenColor('--color-base-content', 0.7) },
      grid: { vertLines: { visible: false }, horzLines: { color: tokenColor('--color-base-300', 0.6) } },
    });
    line.applyOptions({ color: last >= (data?.config.startBalance ?? 0) ? tokenColor('--color-success') : tokenColor('--color-error') });
    // One point per second at most: signals closing on the same bar share a time.
    const seen = new Map<number, number>();
    for (const p of points) seen.set(Math.floor(Date.parse(p.time) / 1000), p.equity);
    line.setData([...seen.entries()].map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    chart.timeScale().fitContent();
  });

  const groups = $derived<LedgerStats[]>(data ? data[group] : []);
</script>

<div class="flex flex-col gap-4 p-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="flex max-w-[75ch] flex-col gap-1 text-sm">
      <p>
        Setiap sinyal mesin bawaan dan strategi yang lolos Lab (Donchian harian) pada <strong>{data?.config.symbols.join(', ') ?? '…'}</strong> dicatat saat lahir dan dinilai otomatis di akun simulasi
        {#if data}<strong>{usd(data.config.startBalance)} USD</strong>, risiko <strong>{data.config.riskPct}%</strong> ({usd(data.config.riskUsd)} USD) per sinyal{/if},
        setelah biaya spread, fee, dan slippage.
      </p>
      <p class="text-xs text-base-content/70">
        Kripto dan emas 15m/1j memakai harga real-time Binance (emas dari kontrak XAUUSDT, tanpa jam saat pasar spot tutup). Emas harian masih dari Yahoo dan ditandai "tertunda". Hasil riset dan simulasi, bukan nasihat keuangan.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <select class="select select-sm w-auto" bind:value={days} aria-label="Periode">
        <option value={7}>7 hari</option>
        <option value={30}>30 hari</option>
        <option value={90}>90 hari</option>
        <option value={365}>1 tahun</option>
      </select>
      <select class="select select-sm w-auto" bind:value={source} aria-label="Mesin">
        <option value="">Semua mesin</option>
        {#each Object.entries(NAMES) as [key, name] (key)}<option value={key}>{name}</option>{/each}
      </select>
      <select class="select select-sm w-auto" bind:value={symbol} aria-label="Simbol">
        <option value="">Semua simbol</option>
        {#each data?.config.symbols ?? [] as s (s)}<option value={s}>{s}</option>{/each}
      </select>
      <label class="label cursor-pointer gap-2 text-sm">
        <input type="checkbox" class="toggle toggle-sm" bind:checked={history} />
        Termasuk riwayat
      </label>
      {#if auth.isAdmin}<button class="btn btn-ghost btn-sm" onclick={recapTest}>Kirim rekap tes</button>{/if}
      {#if loading}<span class="loading loading-spinner loading-xs" aria-label="Memuat"></span>{/if}
    </div>
  </div>
  {#if note}<p role="status" class="text-sm">{note}</p>{/if}

  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}

  {#if history}
    <p class="rounded-box bg-warning/10 px-3 py-2 text-xs">
      Riwayat dihitung dari candle lama saat ledger pertama kali menyala, jadi ini uji ke belakang, bukan bukti ke depan. Gerbang ke Fase 2 hanya memakai sinyal live.
    </p>
  {/if}

  {#if t}
    <div class="stats stats-vertical w-full border border-base-300 sm:stats-horizontal">
      <div class="stat">
        <div class="stat-title">Sinyal selesai</div>
        <div class="stat-value text-2xl tabular-nums">{t.closed}</div>
        <div class="stat-desc">TP {t.wins} · SL {t.losses} · lainnya {t.other} · berjalan {t.open}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Win rate</div>
        <div class="stat-value text-2xl tabular-nums">{pct(t.winRate)}</div>
        <div class="stat-desc">Profit factor {num(t.profitFactor)}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Expectancy bersih</div>
        <div class="stat-value text-2xl tabular-nums {tone(t.expectancy)}">{r(t.expectancy)}</div>
        <div class="stat-desc">Kotor {r(t.grossExpectancy)} · biaya {r(t.avgCostR == null ? null : -t.avgCostR)} per sinyal</div>
      </div>
      <div class="stat">
        <div class="stat-title">Total</div>
        <div class="stat-value text-2xl tabular-nums {tone(t.totalR)}">{r(t.totalR, 1)}</div>
        <div class="stat-desc">{data ? `${t.totalR >= 0 ? '+' : '−'}${usd(Math.abs(t.totalR * data.config.riskUsd))} USD` : ''} · drawdown {r(-t.maxDrawdownR, 1)}</div>
      </div>
    </div>
    {#if t.closed < 100}
      <p class="text-xs text-base-content/70">Baru {t.closed} sinyal selesai; statistik mulai bisa dipercaya setelah minimal 100.</p>
    {/if}
  {/if}

  <div class="h-44 w-full" bind:this={box} aria-label="Kurva ekuitas akun simulasi"></div>

  <div class="flex flex-col gap-2">
    <div role="tablist" class="tabs tabs-border tabs-sm">
      {#each GROUPS as g (g.key)}
        <button role="tab" class="tab" class:tab-active={group === g.key} onclick={() => (group = g.key)}>{g.label}</button>
      {/each}
    </div>
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th></th>
            <th class="text-right">Selesai</th>
            <th class="text-right">Win rate</th>
            <th class="text-right">Expectancy bersih</th>
            <th class="text-right">Kotor</th>
            <th class="text-right">Biaya</th>
            <th class="text-right">Profit factor</th>
            <th class="text-right">Total</th>
            <th class="text-right">Drawdown</th>
          </tr>
        </thead>
        <tbody>
          {#each groups as g (g.key)}
            <tr>
              <td class="font-medium">{label(group, g.key)}</td>
              <td class="text-right tabular-nums">{g.closed}{g.open ? ` (+${g.open})` : ''}</td>
              <td class="text-right tabular-nums">{pct(g.winRate)}</td>
              <td class="text-right tabular-nums {tone(g.expectancy)}">{r(g.expectancy)}</td>
              <td class="text-right tabular-nums">{r(g.grossExpectancy)}</td>
              <td class="text-right tabular-nums">{r(g.avgCostR == null ? null : -g.avgCostR)}</td>
              <td class="text-right tabular-nums">{num(g.profitFactor)}</td>
              <td class="text-right tabular-nums {tone(g.totalR)}">{r(g.totalR, 1)}</td>
              <td class="text-right tabular-nums">{r(-g.maxDrawdownR, 1)}</td>
            </tr>
          {:else}
            <tr><td colspan="9" class="text-base-content/70">Belum ada sinyal pada filter ini. Sinyal live tercatat mulai sekarang, tiap candle tutup.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if data?.items.length}
    <div class="flex flex-col gap-2">
      <h3 class="text-sm font-semibold">Sinyal terbaru</h3>
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Simbol</th>
              <th>Mesin</th>
              <th>Arah</th>
              <th class="text-right">Entry</th>
              <th class="text-right">SL</th>
              <th class="text-right">TP</th>
              <th>Status</th>
              <th class="text-right">Hasil bersih</th>
            </tr>
          </thead>
          <tbody>
            {#each data.items as s (s.id)}
              <tr>
                <td class="tabular-nums whitespace-nowrap">
                  {formatDateTime(s.signalAt)}
                  {#if !s.live}<span class="badge badge-xs badge-ghost">riwayat</span>{/if}
                </td>
                <td>
                  <button class="link link-hover font-mono" onclick={() => ws.setSymbol(toTradingView(s.symbol))}>{s.symbol}</button>
                  {#if s.dataSource === 'yahoo'}<span class="badge badge-xs badge-warning badge-soft" title="Data Yahoo, tertunda">tertunda</span>{/if}
                </td>
                <td class="whitespace-nowrap">{NAMES[s.source] ?? s.source} {TF[s.timeframe] ?? s.timeframe}</td>
                <td><span class="badge badge-sm {s.side === 'BUY' ? 'badge-success' : 'badge-error'} badge-soft">{s.side}</span></td>
                <td class="text-right tabular-nums">{priceText(s.entry)}</td>
                <td class="text-right tabular-nums">{priceText(s.stopLoss)}</td>
                <td class="text-right tabular-nums">{priceText(s.takeProfit)}</td>
                <td>{STATUS[s.status] ?? s.status}</td>
                <td class="text-right tabular-nums {tone(s.netR)}">{r(s.netR)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
