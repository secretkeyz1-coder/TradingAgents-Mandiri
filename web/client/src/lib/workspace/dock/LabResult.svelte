<script lang="ts">
  // One test result, in Uji strategi → Indikator's Detail indikator tab: the verdict first, then the three conditions it was
  // judged on in the order server/src/lab.ts checks them, where the costs went, the curve of data awal
  // then data uji, the two sides compared, each asset, and the next step that fits the verdict. Costs are
  // always written with a minus, since they only ever take away; a trader reads "+0,17R" as profit.
  import { ColorType, createChart, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
  import type { LabRun, LabSymbol } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { formatDateTime, formatR } from '../../format';
  import { indicators } from '../../stores/indicators.svelte';
  import { fitDays, lab, LAB_PERIODS, periodLabel, strategyKey, timeframeLabel } from '../../stores/lab.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { theme, tokenColor } from '../../theme.svelte';
  import { CRYPTO_VENUES, toTradingView } from '../../tv';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';
  import { pickSource } from './SignalsView.svelte';

  /** `onform`: show the form after a result put its settings there; `onlist`: show the list of indicators. */
  let { r, onform, onlist }: { r: LabRun; onform: () => void; onlist: () => void } = $props();

  const BIGGER = { '15m': '1h', '1h': '4h', '4h': '1d', '1d': null } as const;
  /** The engines the signal ledger follows live (server/src/ledger.ts). */
  const RECORDED = ['scalper', 'pob', 'fib', 'donchian'];
  const STATE_WORD = { ok: 'Terpenuhi', no: 'Gagal', skip: 'Tidak dinilai' } as const;

  const name = (s: string) => friendlyName(toTradingView(s));
  const joinId = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} dan ${xs.at(-1)}`);
  const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const num = (x: number | null | undefined) => (x == null ? '–' : x.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cost = (x: number | null | undefined) => (x == null ? '–' : formatR(-Math.abs(x)));
  const tone = (x: number | null | undefined) => (x == null ? '' : x > 0 ? 'ta-up' : x < 0 ? 'ta-down' : '');
  const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const tfPhrase = (tf: string) => (tf === '1d' ? 'timeframe harian' : timeframeLabel(tf));

  type Tested = Extract<LabSymbol, { is: unknown }>;
  const tested = $derived(r.symbols.filter((s): s is Tested => 'is' in s));
  const is = $derived(r.total.is);
  const oos = $derived(r.total.oos);
  // The server's order: too few trades, then a loss on data awal, then a loss on data uji.
  const thin = $derived(oos.n < 30);
  const lostEarly = $derived(!thin && (is.net ?? 0) <= 0);
  const lostLate = $derived(!thin && !lostEarly && (oos.net ?? 0) <= 0);
  const engine = $derived(r.config.strategy.kind === 'engine' ? r.config.strategy.name : null);
  const splitDay = $derived(day(tested.find((s) => s.split)?.split));
  /** Signals the script gave at an entry their bar never traded: not trades, so not in any number below. */
  const unfilled = $derived(tested.reduce((sum, s) => sum + (s.unfilled ?? 0), 0));
  const meta = $derived(
    [
      joinId(r.config.symbols.map(name)),
      periodLabel(r.config.days),
      `biaya ${r.config.costs === 'maker' ? 'order limit' : 'order pasar'}`,
      formatDateTime(r.createdAt),
      `selesai dalam ${Math.max(1, Math.round(r.ms / 1000))} detik`,
    ].join(' · '),
  );

  const verdict = $derived.by(() => {
    if (r.verdict.pass)
      return {
        tone: 'pass',
        icon: 'check' as IconName,
        title: 'Lolos uji riwayat',
        reason: 'Untung setelah biaya di data awal, dan tetap untung di data uji yang belum pernah dipakai.',
        note: 'Ini baru riwayat. Hasil bagus bisa juga kebetulan, apalagi setelah banyak mencoba variasi: pantau sinyal nyatanya dulu sebelum dipakai.',
      };
    if (thin)
      return {
        tone: 'info',
        icon: 'info' as IconName,
        title: 'Belum cukup data',
        reason: `Data uji baru ${oos.n} trade; perlu minimal 30. Untung atau rugi, ${oos.n} trade belum bisa dipercaya.`,
        note: 'Ini belum berarti indikatornya buruk. Tambah trade, lalu uji lagi.',
      };
    if (lostEarly)
      return { tone: 'warn', icon: 'alert' as IconName, title: 'Tidak lolos', reason: 'Sudah rugi di data awal setelah biaya.', note: 'Syarat kedua gagal, jadi data uji tidak lagi menentukan.' };
    return {
      tone: 'warn',
      icon: 'alert' as IconName,
      title: 'Tidak lolos',
      reason: 'Untung di data awal, tapi rugi di data uji: kemungkinan hanya cocok dengan masa lalu.',
      note: 'Syarat ketiga gagal. Dengan pengaturan ini, indikatornya belum layak dipakai.',
    };
  });

  const checks = $derived([
    { state: thin ? 'no' : 'ok', title: 'Cukup trade untuk dinilai', sub: 'Data uji perlu minimal 30 trade', value: `${oos.n} trade`, tone: '' },
    {
      state: thin ? 'skip' : lostEarly ? 'no' : 'ok',
      title: 'Untung di data awal',
      sub: thin ? 'Belum dinilai' : `Rata-rata per trade setelah biaya, di ${pct(r.config.split)} riwayat pertama`,
      value: thin ? '–' : formatR(is.net),
      tone: thin ? 'ta-muted' : tone(is.net),
    },
    {
      state: thin || lostEarly ? 'skip' : lostLate ? 'no' : 'ok',
      title: 'Tetap untung di data uji',
      sub: thin
        ? `Belum dinilai: ${oos.n} trade terlalu sedikit`
        : lostEarly
          ? 'Tidak menentukan lagi, karena syarat kedua gagal'
          : `Rata-rata per trade setelah biaya, di ${pct(1 - r.config.split)} riwayat terakhir`,
      value: formatR(oos.net),
      tone: thin || lostEarly ? 'ta-muted' : tone(oos.net),
    },
  ] as const);

  /** Where the costs went, in the part that decided. */
  const insight = $derived.by(() => {
    if (thin) return `Hanya ${oos.n} trade di data uji. Periode yang lebih panjang atau aset yang lebih banyak memberi lebih banyak trade.`;
    if (r.verdict.pass)
      return (is.net ?? 0) > (oos.net ?? 0)
        ? `Di data uji, untungnya turun dari ${formatR(is.net)} ke ${formatR(oos.net)} per trade. Turun seperti ini wajar; yang penting tetap di atas nol setelah biaya.`
        : `Di data uji, untungnya ${formatR(oos.net)} per trade, tidak lebih buruk dari data awal (${formatR(is.net)}).`;
    const side = lostEarly ? is : oos;
    const where = lostEarly ? 'data awal' : 'data uji';
    const priciest = tested.length > 1 ? [...tested].sort((a, b) => (b.oos.cost ?? b.is.cost ?? 0) - (a.oos.cost ?? a.is.cost ?? 0))[0] : null;
    const heaviest = priciest ? ` Biaya paling berat di ${name(priciest.symbol)}: ${cost(priciest.oos.cost ?? priciest.is.cost)} per trade.` : '';
    return (side.gross ?? 0) > 0
      ? `Sebelum biaya, ${where} masih untung ${formatR(side.gross)} per trade. Biaya sekitar ${cost(side.cost)} per trade menghabiskan semuanya.${heaviest}`
      : `Bahkan sebelum biaya, ${where} sudah rugi ${formatR(side.gross)} per trade, lalu biaya menambah ${cost(side.cost)}.${heaviest}`;
  });

  let helpOpen = $state(false);

  /** The tested indicator on the chart, and the chart of the first asset open, for its Notifikasi button. */
  function toChart() {
    const key = strategyKey(r.config.strategy);
    if (key === 'engine:scalper' && !indicators.scalperOn) indicators.toggle();
    else if (key === 'engine:pob' && !indicators.pobOn) indicators.togglePob();
    else if (key === 'engine:fib' && !indicators.fibOn) indicators.toggleFib();
    else if (r.config.strategy.kind === 'catalog') indicators.toggleCatalog(key, true);
    else if (r.config.strategy.kind === 'script') indicators.toggleScript(r.config.strategy.id, true);
    ws.setSymbol(toTradingView(r.config.symbols[0]));
  }

  function reuse(change: Parameters<typeof lab.reuse>[1], note: string) {
    lab.reuse(r.config, change, note);
    onform();
  }

  type Next = { icon: IconName; title: string; sub: string; main?: boolean; act: () => void };
  const next = $derived.by((): Next[] => {
    const help: Next = { icon: 'book', title: 'Cara membaca hasil ini', sub: 'Arti data awal, data uji, R, dan biaya.', act: () => (helpOpen = true) };
    const live: Next | null =
      engine && RECORDED.includes(engine)
        ? { icon: 'signals', title: 'Lihat rekam jejak live', sub: 'Mesin ini dicatat live untuk semua member.', act: () => (pickSource(engine), ws.setDock('signals')) }
        : null;
    if (r.verdict.pass) {
      const onChart = engine !== 'donchian';
      return [
        ...(onChart
          ? [{ icon: 'bell' as IconName, title: 'Pasang notifikasi sinyal', sub: 'Buka chart-nya, lalu tombol Notifikasi. Tiap sinyal baru dinilai di Beranda.', main: true, act: toChart }]
          : []),
        ...(live ? [{ ...live, main: !onChart }] : []),
        help,
      ];
    }
    if (thin) {
      const longer = LAB_PERIODS[r.config.timeframe].find((d) => d > r.config.days);
      const steps: Next[] = [];
      if (longer)
        steps.push({
          icon: 'refresh',
          title: `Uji lagi ${periodLabel(longer)}`,
          sub: 'Periode lebih panjang, lebih banyak trade di data uji.',
          main: true,
          act: () => reuse({ days: longer }, `${r.name}, sekarang ${periodLabel(longer)}. Tekan Jalankan uji.`),
        });
      if (r.config.symbols.length < 5)
        steps.push({
          icon: 'plus',
          title: 'Tambah aset',
          sub: 'Lebih banyak aset, lebih banyak sinyal.',
          main: !longer,
          act: () => reuse({}, `Pengaturan ${r.name} dimuat. Tambah aset di langkah 2, lalu tekan Jalankan uji.`),
        });
      return [...steps, help];
    }
    const bigger = BIGGER[r.config.timeframe];
    const allowed = !!bigger && (!engine || (lab.meta?.engines[engine]?.timeframes ?? []).includes(bigger));
    return [
      ...(allowed && bigger
        ? [
            {
              icon: 'refresh' as IconName,
              title: `Uji lagi di ${tfPhrase(bigger)}`,
              sub: 'Stop lebih lebar, jadi biaya per R lebih ringan.',
              main: true,
              act: () => reuse({ timeframe: bigger, days: fitDays(bigger, r.config.days) }, `${r.name}, sekarang ${tfPhrase(bigger)}. Tekan Jalankan uji.`),
            },
          ]
        : []),
      { icon: 'library', title: 'Ganti indikator', sub: 'Pilih yang lain di daftar, atau buat baru.', main: !allowed, act: onlist },
      help,
    ];
  });

  // --- The net-R curve: the part the strategy was shaped on, then the check.
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
      localization: { locale: 'id-ID', priceFormatter: (v: number) => `${v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}R` },
      handleScroll: false,
      handleScale: false,
    });
    inSample = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    outSample = chart.addSeries(LineSeries, { lineWidth: 3, priceLineVisible: false, lastValueVisible: true });
    return () => {
      chart?.remove();
      chart = inSample = outSample = undefined;
    };
  });
  $effect(() => {
    void theme.dark;
    const points = r.equity;
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
  const curveLabel = $derived(
    `Kurva R kumulatif setelah biaya: ${formatR(is.total, 1)} di data awal, lalu ${formatR(oos.total, 1)} di data uji${splitDay ? ` yang mulai ${splitDay}` : ''}.`,
  );
</script>

<div class="flex flex-wrap items-start justify-between gap-3">
  <div class="min-w-0">
    <h3 id="lab-result-title" class="ta-section-title">Hasil uji · {timeframeLabel(r.config.timeframe)}</h3>
    <p class="mt-1 text-sm ta-muted">{meta}</p>
  </div>
  <div class="flex gap-2">
    <button type="button" class="btn btn-sm" onclick={() => reuse({}, `Pengaturan ${r.name} dimuat ke langkah 1 sampai 3. Ubah yang perlu, lalu tekan Jalankan uji.`)}>
      <Icon name="refresh" size={16} />Ubah dan uji ulang
    </button>
    <button type="button" class="btn btn-ghost btn-sm btn-square" aria-label="Hapus uji {r.name}" onclick={() => lab.remove(r)}><Icon name="trash" /></button>
  </div>
</div>

<div class="ta-verdict" data-tone={verdict.tone}>
  <span class="ta-verdict-icon"><Icon name={verdict.icon} size={26} stroke={2.2} /></span>
  <p class="ta-verdict-title">{verdict.title}</p>
  <p class="ta-verdict-reason">{verdict.reason}</p>
  <p class="ta-verdict-note">{verdict.note}</p>
</div>

<section class="flex flex-col gap-2.5" aria-labelledby="lab-checks">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h4 id="lab-checks" class="ta-section-title">Syarat lolos</h4>
    <span class="text-sm ta-muted">Dicek berurutan. Satu gagal, uji tidak lolos.</span>
  </div>
  <ol class="ta-checks">
    {#each checks as c (c.title)}
      <li class="ta-check" data-state={c.state}>
        <span class="ta-check-mark"><Icon name={c.state === 'ok' ? 'check' : c.state === 'no' ? 'x' : 'minus'} size={16} stroke={2.4} /><span class="sr-only">{STATE_WORD[c.state]}:</span></span>
        <span class="min-w-0"><span class="ta-check-title block">{c.title}</span><span class="block text-sm ta-muted">{c.sub}</span></span>
        <span class="ta-check-value {c.tone}">{c.value}</span>
      </li>
    {/each}
  </ol>
</section>

<div role="note" class="alert items-start text-sm {r.verdict.pass || thin ? 'alert-soft' : 'alert-soft alert-warning'}">
  <Icon name="info" />
  <span>{insight}</span>
</div>

{#if unfilled}
  <div role="note" class="alert alert-soft alert-warning items-start text-sm">
    <Icon name="alert" />
    <span>
      {unfilled.toLocaleString('id-ID')} sinyal tidak dihitung karena ordernya tidak pernah terisi: harga entry tidak tersentuh di candle
      sinyal, atau order stop/limit habis masa tunggunya sebelum harga sampai. Order yang menunggu harga ditulis dengan <code>wait</code>
      di <code>signal()</code>; lihat tab Panduan di editor skrip.
    </span>
  </div>
{/if}

<section class="ta-card" aria-labelledby="lab-curve">
  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-base-300 px-5 py-3">
    <h4 id="lab-curve" class="font-semibold">Untung-rugi kumulatif, setelah biaya</h4>
    <div class="flex flex-wrap gap-4 text-sm ta-muted">
      <span class="inline-flex items-center gap-2"><span class="h-0.5 w-4 rounded bg-base-content/45" aria-hidden="true"></span>Data awal: membentuk hasil</span>
      <span class="inline-flex items-center gap-2"><span class="h-1 w-4 rounded bg-accent" aria-hidden="true"></span>Data uji: memeriksa{splitDay ? `, mulai ${splitDay}` : ''}</span>
    </div>
  </div>
  <!-- Created once visible: a chart sized while hidden squeezes its data to one side. -->
  <div class="h-64 w-full px-2 py-2" bind:this={box} role="img" aria-label={curveLabel}></div>
</section>

<div class="ta-compare">
  <div class="ta-cmp">
    <span class="text-sm font-semibold ta-muted">Data awal</span>
    <div><span class="ta-big {tone(is.net)}">{formatR(is.net)}</span><span class="mt-1 block text-xs ta-muted">per trade setelah biaya · total {formatR(is.total, 1)}</span></div>
    <dl class="ta-kv">
      <div><dt>Trade</dt><dd>{is.n}</dd></div>
      <div><dt>Untung</dt><dd>{pct(is.win)}</dd></div>
      <div><dt>Faktor profit</dt><dd>{num(is.pf)}</dd></div>
    </dl>
  </div>
  <div class="ta-cmp" data-key>
    <span class="text-sm font-semibold text-accent">Data uji · yang menentukan</span>
    <div><span class="ta-big {tone(oos.net)}">{formatR(oos.net)}</span><span class="mt-1 block text-xs ta-muted">per trade setelah biaya · total {formatR(oos.total, 1)}</span></div>
    <dl class="ta-kv">
      <div><dt>Trade</dt><dd>{oos.n}</dd></div>
      <div><dt>Untung</dt><dd>{pct(oos.win)}</dd></div>
      <div><dt>Faktor profit</dt><dd>{num(oos.pf)}</dd></div>
      <div><dt>Sebelum biaya</dt><dd>{formatR(oos.gross)}</dd></div>
      <div><dt>Biaya</dt><dd>{cost(oos.cost)}</dd></div>
      <div><dt>Turun terdalam</dt><dd>{formatR(-oos.maxDrawdown, 1)}</dd></div>
    </dl>
  </div>
</div>

<details class="ta-card" open={r.symbols.length > 1}>
  <summary class="flex cursor-pointer items-center justify-between gap-2 px-5 py-3 font-semibold">Rincian per aset<span class="text-sm font-normal ta-muted">{r.symbols.length} aset</span></summary>
  <div class="overflow-x-auto border-t border-base-300">
    <table class="table table-sm">
      <thead>
        <tr>
          <th>Aset</th>
          <th class="text-right">Trade awal</th>
          <th class="text-right">Per trade awal</th>
          <th class="text-right">Trade uji</th>
          <th class="text-right">Untung uji</th>
          <th class="text-right">Per trade uji</th>
          <th class="text-right">Biaya per trade</th>
        </tr>
      </thead>
      <tbody>
        {#each r.symbols as s (s.symbol)}
          <tr>
            <th scope="row" class="font-normal">
              <span class="font-semibold">{name(s.symbol)}</span>
              {#if 'error' in s}
                <span class="block text-xs text-error">{s.error}</span>
              {:else}
                <span class="block text-xs ta-muted">{CRYPTO_VENUES.find((v) => v.id === s.source)?.label ?? 'Yahoo'} · {s.bars.toLocaleString('id-ID')} candle</span>
              {/if}
            </th>
            {#if 'is' in s}
              <td class="text-right tabular-nums">{s.is.n}</td>
              <td class="text-right tabular-nums {tone(s.is.net)}">{formatR(s.is.net)}</td>
              <td class="text-right tabular-nums">{s.oos.n}</td>
              <td class="text-right tabular-nums">{pct(s.oos.win)}</td>
              <td class="text-right tabular-nums {tone(s.oos.net)}">{formatR(s.oos.net)}</td>
              <td class="text-right tabular-nums">{cost(s.oos.cost ?? s.is.cost)}</td>
            {:else}
              <td colspan="6"></td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</details>

<section class="flex flex-col gap-2.5" aria-labelledby="lab-next">
  <h4 id="lab-next" class="ta-section-title">Langkah berikutnya</h4>
  <div class="ta-next">
    {#each next as n (n.title)}
      <button type="button" class="ta-nx" data-main={n.main ? '' : undefined} onclick={n.act}>
        <Icon name={n.icon} size={22} stroke={2} />
        <span><span class="ta-nx-title">{n.title}</span><span class="ta-nx-sub">{n.sub}</span></span>
      </button>
    {/each}
  </div>
</section>

<details class="border-t border-base-300 pt-1" bind:open={helpOpen}>
  <summary class="flex cursor-pointer items-center gap-2 py-3 font-semibold ta-muted"><Icon name="book" size={16} />Cara membaca hasil ini</summary>
  <dl class="grid max-w-[70ch] gap-x-4 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
    <dt class="font-semibold">R</dt>
    <dd class="ta-muted">Risiko satu trade: jarak entry ke stop loss. +1R berarti untung sebesar risikonya, −1R rugi sebesar risikonya.</dd>
    <dt class="font-semibold">Data awal</dt>
    <dd class="ta-muted">{pct(r.config.split)} riwayat pertama. Di sinilah hasil indikator terbentuk.</dd>
    <dt class="font-semibold">Data uji</dt>
    <dd class="ta-muted">{pct(1 - r.config.split)} riwayat terakhir yang belum pernah dipakai. Ini pemeriksanya: yang tetap untung di sini lebih bisa dipercaya.</dd>
    <dt class="font-semibold">Biaya</dt>
    <dd class="ta-muted">Fee tiap trade, dihitung dalam R. Selalu ditulis minus karena selalu mengurangi hasil.</dd>
    <dt class="font-semibold">Faktor profit</dt>
    <dd class="ta-muted">Total untung dibagi total rugi. Di atas 1 berarti untung.</dd>
    <dt class="font-semibold">Turun terdalam</dt>
    <dd class="ta-muted">Penurunan terbesar kurva dari puncak ke dasar berikutnya.</dd>
  </dl>
  <p class="mt-3 text-xs ta-muted">Makin sering mencoba variasi, makin besar peluang hasil bagus hanya kebetulan. Hasil riset, bukan nasihat keuangan.</p>
</details>
