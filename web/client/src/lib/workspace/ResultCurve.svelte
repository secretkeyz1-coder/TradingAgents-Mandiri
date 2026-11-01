<script lang="ts">
  // Beranda's cumulative R by the day each call fired: one line, a zero line to read gains and
  // losses against, and a readout of the day under the pointer (the newest when none), which a
  // touch screen can use too. Drawn like the lab's equity curve (lightweight-charts, theme
  // tokens) so the two read alike; the table under it holds the same numbers.
  import { ColorType, createChart, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type MouseEventParams, type Time } from 'lightweight-charts';
  import { theme, tokenColor } from '../theme.svelte';

  let { days }: { days: { day: string; win: number; loss: number; r: number }[] } = $props();

  const points = $derived.by(() => {
    let total = 0;
    return days.map((d) => ({ ...d, total: (total += d.r) }));
  });
  let box: HTMLDivElement | undefined = $state();
  let chart: IChartApi | undefined;
  let line: ISeriesApi<'Line'> | undefined;
  let zeroLine: IPriceLine | undefined;
  let hovered = $state<string | null>(null);
  const shown = $derived(points.find((p) => p.day === hovered) ?? points.at(-1));

  const R = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2).replace('.', ',')}R`;
  const date = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  /** The crosshair's time as the day string the data used. */
  const dayOf = (t: Time | undefined): string | null =>
    t == null ? null : typeof t === 'string' ? t : typeof t === 'number' ? new Date(t * 1000).toISOString().slice(0, 10) : `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

  $effect(() => {
    if (!box) return;
    chart = createChart(box, {
      autoSize: true,
      // The axis reads like the rest of the page: decimal comma, in R.
      localization: { locale: 'id-ID', priceFormatter: (v: number) => `${v.toFixed(1).replace('.', ',')}R` },
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: false },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    line = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true, pointMarkersRadius: 4 });
    zeroLine = line.createPriceLine({ price: 0, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
    const follow = (param: MouseEventParams) => (hovered = dayOf(param.time));
    chart.subscribeCrosshairMove(follow);
    return () => {
      chart?.unsubscribeCrosshairMove(follow);
      chart?.remove();
      chart = line = zeroLine = undefined;
    };
  });

  $effect(() => {
    void theme.dark;
    const data = points.map((p) => ({ time: p.day as Time, value: p.total }));
    if (!chart || !line) return;
    chart.applyOptions({
      layout: { textColor: tokenColor('--color-base-content', 0.7) },
      grid: { vertLines: { visible: false }, horzLines: { color: tokenColor('--color-base-300', 0.6) } },
    });
    // A few days read better as dots on the line.
    line.applyOptions({ color: tokenColor('--color-accent'), pointMarkersVisible: data.length <= 31 });
    zeroLine?.applyOptions({ color: tokenColor('--color-base-content', 0.35) });
    line.setData(data);
    chart.timeScale().fitContent();
  });
</script>

<div class="flex flex-col gap-2">
  {#if shown}
    <p class="text-sm tabular-nums">
      <span class="text-base-content/70">{date(shown.day)}:</span>
      <strong class="font-semibold">{R(shown.total)}</strong> kumulatif
      <span class="text-base-content/70">· hari itu {shown.win} TP, {shown.loss} SL</span>
    </p>
  {/if}
  <div bind:this={box} class="h-48 w-full" role="img" aria-label="R kumulatif per hari, {points.length} hari dengan hasil; angkanya ada di tabel di bawah"></div>
  <details class="text-sm">
    <summary class="cursor-pointer text-base-content/70">Tabel harian</summary>
    <div class="mt-2 max-h-64 overflow-auto">
      <table class="table table-sm">
        <thead><tr><th>Tanggal</th><th class="text-right">TP</th><th class="text-right">SL</th><th class="text-right">R hari itu</th><th class="text-right">Kumulatif</th></tr></thead>
        <tbody class="tabular-nums">
          {#each [...points].reverse() as p (p.day)}
            <tr>
              <td>{date(p.day)}</td>
              <td class="text-right">{p.win}</td>
              <td class="text-right">{p.loss}</td>
              <td class="text-right">{R(p.r)}</td>
              <td class="text-right">{R(p.total)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</div>
