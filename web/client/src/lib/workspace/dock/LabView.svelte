<script lang="ts">
  // The strategy lab (server/src/lab.ts): test a built-in engine or one of your scripts on a long
  // history with costs, and see whether it holds on the part of the data it was not shaped on.
  import { ColorType, createChart, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
  import { api, type LabConfig, type LabRun, type LabRunSummary, type LabStats } from '../../api';
  import { formatDateTime } from '../../format';
  import { scripts } from '../../stores/scripts.svelte';
  import { theme, tokenColor } from '../../theme.svelte';

  const TF = [
    { value: '15m', label: '15m' },
    { value: '1h', label: '1j' },
    { value: '4h', label: '4j' },
    { value: '1d', label: 'Harian' },
  ] as const;
  const PERIODS: Record<string, number[]> = { '15m': [30, 90, 180, 365], '1h': [90, 180, 365, 730, 1095], '4h': [365, 730, 1095, 1825], '1d': [365, 730, 1095, 1825] };
  const periodLabel = (d: number) => (d < 365 ? `${d} hari` : `${d / 365} tahun`);

  let meta = $state<Awaited<ReturnType<typeof api.lab>> | null>(null);
  let runs = $state<LabRunSummary[]>([]);
  let strategy = $state('engine:fib');
  let timeframe = $state<LabConfig['timeframe']>('1h');
  let days = $state(365);
  let costs = $state<'taker' | 'maker'>('taker');
  let split = $state(0.7);
  let expiry = $state(96);
  let symbols = $state<string[]>(['BTC-USD', 'ETH-USD', 'GC=F']);
  let symbolInput = $state('');
  let busy = $state(false);
  let error = $state('');
  let result = $state<LabRun | null>(null);

  async function load() {
    try {
      [meta, runs] = await Promise.all([api.lab(), api.labRuns()]);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  load();

  const engine = $derived(strategy.startsWith('engine:') ? meta?.engines[strategy.slice(7)] : null);
  const timeframes = $derived(TF.filter((t) => !engine || engine.timeframes.includes(t.value)));
  $effect(() => {
    if (!timeframes.some((t) => t.value === timeframe)) timeframe = timeframes[0].value;
  });
  $effect(() => {
    if (!PERIODS[timeframe].includes(days)) days = PERIODS[timeframe].at(-2) ?? PERIODS[timeframe][0];
  });

  function addSymbol() {
    const s = symbolInput.trim().toUpperCase();
    if (s && !symbols.includes(s) && symbols.length < 5) symbols = [...symbols, s];
    symbolInput = '';
  }

  async function run() {
    busy = true;
    error = '';
    try {
      const [kind, id] = strategy.split(':') as ['engine' | 'script', string];
      const strategyConfig: LabConfig['strategy'] = kind === 'engine' ? { kind: 'engine', name: id } : { kind: 'script', id };
      result = await api.labRun({ strategy: strategyConfig, symbols, timeframe, days, costs, split, expiry });
      runs = await api.labRuns();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function open(id: string) {
    error = '';
    try {
      result = await api.labRunGet(id);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function remove(id: string) {
    await api.labRunDelete(id).catch((e) => (error = (e as Error).message));
    if (result?.id === id) result = null;
    runs = await api.labRuns();
  }

  const r = (x: number | null | undefined, digits = 2) => (x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}R`);
  const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const num = (x: number | null | undefined) => (x == null ? '–' : x.toFixed(2));
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'text-success' : x < 0 ? 'text-error' : '');
  const tfLabel = (tf: string) => TF.find((t) => t.value === tf)?.label ?? tf;

  // --- The combined net-R curve: the part the strategy was shaped on, then the check.
  let box: HTMLDivElement | undefined = $state();
  let chart: IChartApi | undefined;
  let inSample: ISeriesApi<'Line'> | undefined;
  let outSample: ISeriesApi<'Line'> | undefined;
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
    inSample = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'data awal' });
    outSample = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'data uji' });
    return () => {
      chart?.remove();
      chart = inSample = outSample = undefined;
    };
  });
  $effect(() => {
    void theme.dark;
    const points = result?.equity ?? [];
    if (!chart || !inSample || !outSample) return;
    chart.applyOptions({
      layout: { textColor: tokenColor('--color-base-content', 0.7) },
      grid: { vertLines: { visible: false }, horzLines: { color: tokenColor('--color-base-300', 0.6) } },
    });
    inSample.applyOptions({ color: tokenColor('--color-base-content', 0.45) });
    outSample.applyOptions({ color: tokenColor('--color-accent') });
    const at = (t: string) => Math.floor(Date.parse(`${t.slice(0, 10)}T${t.length > 10 ? t.slice(11, 16) : '00:00'}:00Z`) / 1000);
    const series = (list: typeof points) => {
      const seen = new Map<number, number>();
      for (const p of list) seen.set(at(p.time), p.r);
      return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    };
    const firstOos = points.findIndex((p) => p.oos);
    // The check starts where the shaping ended, so the two lines join.
    inSample.setData(series(firstOos < 0 ? points : points.slice(0, firstOos + 1)));
    outSample.setData(series(firstOos < 0 ? [] : points.slice(Math.max(0, firstOos - 1))));
    chart.timeScale().fitContent();
  });

  const row = (s: LabStats) => [s.n, pct(s.win), r(s.net), num(s.pf)];
</script>

<div class="flex flex-col gap-4 p-4">
  <div class="flex max-w-[80ch] flex-col gap-1 text-sm">
    <p>
      Uji strategi pada riwayat panjang, lengkap dengan biaya. Strategi dibentuk di <strong>data awal</strong> lalu diperiksa di <strong>data uji</strong> yang belum
      pernah "dilihat"; hanya yang tetap positif setelah biaya di data uji yang layak dicoba di buku catatan live.
    </p>
    <p class="text-xs text-base-content/70">Makin sering mencoba variasi, makin besar peluang hasil bagus hanya kebetulan. Hasil riset, bukan nasihat keuangan.</p>
  </div>

  <div class="grid gap-3 rounded-box border border-base-300 p-3 sm:grid-cols-2 lg:grid-cols-4">
    <label class="flex flex-col gap-1 text-sm">
      Strategi
      <select class="select select-sm w-full" bind:value={strategy}>
        <optgroup label="Mesin bawaan">
          {#each Object.entries(meta?.engines ?? {}) as [key, e] (key)}<option value="engine:{key}">{e.label}</option>{/each}
        </optgroup>
        {#if meta?.scripts.length}
          <optgroup label="Skrip saya">
            {#each meta.scripts as s (s.id)}<option value="script:{s.id}">{s.name}</option>{/each}
          </optgroup>
        {/if}
      </select>
      <button class="link link-hover self-start text-xs" onclick={() => scripts.open(null)}>Buat skrip dari template (mis. Donchian breakout)</button>
    </label>
    <label class="flex flex-col gap-1 text-sm">
      Timeframe dan periode
      <div class="join w-full">
        <select class="select select-sm join-item w-1/2" bind:value={timeframe} aria-label="Timeframe">
          {#each timeframes as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
        </select>
        <select class="select select-sm join-item w-1/2" bind:value={days} aria-label="Periode">
          {#each PERIODS[timeframe] as d (d)}<option value={d}>{periodLabel(d)}</option>{/each}
        </select>
      </div>
    </label>
    <label class="flex flex-col gap-1 text-sm">
      Biaya dan data uji
      <div class="join w-full">
        <select class="select select-sm join-item w-1/2" bind:value={costs} aria-label="Biaya">
          <option value="taker">Taker (market)</option>
          <option value="maker">Maker (limit)</option>
        </select>
        <select class="select select-sm join-item w-1/2" bind:value={split} aria-label="Bagian data uji">
          <option value={0.8}>Uji 20% akhir</option>
          <option value={0.7}>Uji 30% akhir</option>
          <option value={0.6}>Uji 40% akhir</option>
        </select>
      </div>
    </label>
    <label class="flex flex-col gap-1 text-sm">
      Kedaluwarsa sinyal (candle)
      <input type="number" class="input input-sm w-full" min="4" max="500" bind:value={expiry} />
    </label>
    <div class="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
      Simbol (maks 5)
      <div class="flex flex-wrap items-center gap-1.5">
        {#each symbols as s (s)}
          <span class="badge badge-ghost gap-1 font-mono">
            {s}
            <button class="cursor-pointer" aria-label="Hapus {s}" onclick={() => (symbols = symbols.filter((x) => x !== s))}>×</button>
          </span>
        {/each}
        {#if symbols.length < 5}
          <input
            class="input input-xs w-36 font-mono"
            placeholder="mis. SOL-USD"
            bind:value={symbolInput}
            onkeydown={(e) => e.key === 'Enter' && addSymbol()}
            aria-label="Tambah simbol"
          />
          <button class="btn btn-ghost btn-xs" onclick={addSymbol}>Tambah</button>
        {/if}
      </div>
    </div>
    <div class="flex items-end">
      <button class="btn btn-primary btn-sm w-full" onclick={run} disabled={busy || !symbols.length}>
        {#if busy}<span class="loading loading-spinner loading-xs"></span> Menguji…{:else}Jalankan uji{/if}
      </button>
    </div>
  </div>
  {#if busy}<p class="text-xs text-base-content/70">Mengambil riwayat dan menjalankan strategi; riwayat panjang bisa memakan 1–2 menit.</p>{/if}
  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}

  {#if result}
    <div class="flex flex-col gap-3">
      <div role="status" class="alert {result.verdict.pass ? 'alert-success' : 'alert-warning'} alert-soft">
        <div>
          <p class="font-semibold">{result.verdict.pass ? 'Lolos uji awal' : 'Tidak lolos'} · {result.name} {tfLabel(result.config.timeframe)}</p>
          <p class="text-sm">{result.verdict.reason}</p>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th rowspan="2">Simbol</th>
              <th colspan="4" class="text-center">Data awal</th>
              <th colspan="4" class="text-center">Data uji</th>
              <th rowspan="2" class="text-right">Biaya rata-rata</th>
            </tr>
            <tr>
              <th class="text-right">Trade</th><th class="text-right">Win</th><th class="text-right">Bersih</th><th class="text-right">PF</th>
              <th class="text-right">Trade</th><th class="text-right">Win</th><th class="text-right">Bersih</th><th class="text-right">PF</th>
            </tr>
          </thead>
          <tbody>
            {#each result.symbols as s (s.symbol)}
              <tr>
                <td>
                  <span class="font-mono">{s.symbol}</span>
                  {#if 'error' in s}
                    <span class="block text-xs text-error">{s.error}</span>
                  {:else}
                    <span class="block text-xs text-base-content/70">{s.source === 'binance' ? 'Binance' : 'Yahoo'} · {s.bars} candle · uji mulai {s.split?.slice(0, 10)}</span>
                  {/if}
                </td>
                {#if !('error' in s)}
                  {#each row(s.is) as v, i (i)}<td class="text-right tabular-nums {i === 2 ? tone(s.is.net) : ''}">{v}</td>{/each}
                  {#each row(s.oos) as v, i (i)}<td class="text-right tabular-nums {i === 2 ? tone(s.oos.net) : ''}">{v}</td>{/each}
                  <td class="text-right tabular-nums">{r(s.oos.cost ?? s.is.cost)}</td>
                {:else}
                  <td colspan="9"></td>
                {/if}
              </tr>
            {/each}
            <tr class="font-semibold">
              <td>Total</td>
              {#each row(result.total.is) as v, i (i)}<td class="text-right tabular-nums {i === 2 ? tone(result.total.is.net) : ''}">{v}</td>{/each}
              {#each row(result.total.oos) as v, i (i)}<td class="text-right tabular-nums {i === 2 ? tone(result.total.oos.net) : ''}">{v}</td>{/each}
              <td class="text-right tabular-nums">{r(result.total.oos.cost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/70">
        Kotor data uji {r(result.total.oos.gross)} per trade · total bersih data uji {r(result.total.oos.total, 1)} · drawdown terdalam {r(-result.total.oos.maxDrawdown, 1)} ·
        biaya {result.config.costs === 'maker' ? 'maker' : 'taker'} · selesai dalam {Math.round(result.ms / 1000)} detik.
      </p>
      <!-- Created once visible: a chart sized while hidden squeezes its data to one side. -->
      <div class="h-48 w-full" bind:this={box} aria-label="Kurva R bersih: data awal lalu data uji"></div>
    </div>
  {/if}

  {#if runs.length}
    <div class="flex flex-col gap-2">
      <h3 class="text-sm font-semibold">Riwayat uji</h3>
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr><th>Waktu</th><th>Strategi</th><th>Simbol</th><th class="text-right">Bersih data uji</th><th>Hasil</th><th><span class="sr-only">Aksi</span></th></tr>
          </thead>
          <tbody>
            {#each runs as run (run.id)}
              <tr class="hover:bg-base-200" class:bg-base-200={result?.id === run.id}>
                <td class="tabular-nums whitespace-nowrap">{formatDateTime(run.createdAt)}</td>
                <td>
                  <button class="link link-hover" onclick={() => open(run.id)}>{run.name} {tfLabel(run.config.timeframe)}</button>
                  <span class="block text-xs text-base-content/70">{periodLabel(run.config.days)} · {run.config.costs}</span>
                </td>
                <td class="font-mono text-xs">{run.config.symbols.join(', ')}</td>
                <td class="text-right tabular-nums {tone(run.total?.oos.net)}">{r(run.total?.oos.net)} ({run.total?.oos.n ?? 0})</td>
                <td><span class="badge badge-sm badge-soft {run.verdict?.pass ? 'badge-success' : 'badge-warning'}">{run.verdict?.pass ? 'lolos' : 'tidak lolos'}</span></td>
                <td class="text-right"><button class="btn btn-ghost btn-xs" onclick={() => remove(run.id)}>Hapus</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
