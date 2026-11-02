<script lang="ts">
  // The symbol in focus: TradingView's full chart, or the engine's daily
  // candles with every AI decision marked, plus the chart's own tools (zoom,
  // jump to a date, navigator, Scalper Pro+). Analisa harian puts the symbol on
  // the scheduled analyses (Pantau). On a desktop screen the header also
  // holds focus mode and the layout menu. On Pasar the chart is the market's (indicators, signals,
  // the trading plan) with one button to research the asset; on Riset AI it also marks the AI's
  // decisions, and its head is the asset switch (AssetSwitcher).
  import DecisionChart from '../DecisionChart.svelte';
  import SessionBadge from '../SessionBadge.svelte';
  import { agent, LAYERS } from '../stores/agent.svelte';
  import { layout } from '../stores/layout.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { theme, tokenColor } from '../theme.svelte';
  import TradingViewWidget from '../TradingViewWidget.svelte';
  import { nameOf, venueOf } from '../tv';
  import AssetSwitcher from './AssetSwitcher.svelte';
  import { SCREEN_ICONS } from './icons';
  import LayoutMenu from './LayoutMenu.svelte';

  // The chart canvas takes the panel's own surface and hairline colours.
  const surface = $derived.by(() => {
    void theme.dark;
    return { background: tokenColor('--color-base-100'), grid: tokenColor('--color-base-300', 0.6) };
  });

  // How fresh TradingView's embedded data is. Per its widget FAQ forex and crypto
  // stream in real time, and the OANDA/FOREXCOM CFDs are broker quotes that stream
  // too. IDX comes end-of-day only (the chart itself says "Data penghujung hari");
  // other exchanges are delayed (US stocks: Cboe One, "Data tertunda").
  const freshness = $derived(
    /^(BINANCE|COINBASE|BYBIT|KRAKEN|BITSTAMP|OKX|BITGET|KUCOIN|GATEIO|INDODAX|CRYPTO|FX|FX_IDC|OANDA|FOREXCOM):/.test(ws.symbol)
      ? { label: 'Realtime', status: 'status-success', title: 'Harga mengalir realtime di chart TradingView' }
      : ws.symbol.startsWith('IDX:')
        ? {
            label: 'Akhir hari',
            status: 'status-warning',
            title: 'Chart TradingView untuk IDX hanya memuat data penutupan harian. Chart Keputusan AI (Yahoo) tertunda ±10–25 menit.',
          }
        : { label: 'Tertunda ~15 mnt', status: 'status-neutral', title: 'Data bursa ini tertunda di chart TradingView' },
  );
  const view = $derived(ws.chartView === 'ai' && ws.yahoo ? 'ai' : 'tv');
  const watched = $derived(watch.has(ws.yahoo));
  const desktop = $derived(layoutOf(viewport) !== 'narrow');
  watch.load();

  // TradingView's embed cannot be told to go to a date, so the button opens the
  // AI chart (our own canvas) and its date box.
  let jumpRequest = $state(0);
  function jumpToDate() {
    if (view === 'tv') ws.setChartView('ai');
    jumpRequest++;
  }
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Chart">
  <header class="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-base-300 px-3 py-1">
    {#if ws.screen === 'riset'}
      <!-- On a phone the asset switch sits above Riset AI's tabs (PhoneScreen). -->
      {#if desktop}<AssetSwitcher />{/if}
    {:else}
      <h2 class="flex min-w-0 items-baseline gap-2 text-sm font-semibold">
        {#if nameOf(ws.symbol)}<span class="truncate">{nameOf(ws.symbol)}</span>{/if}
        <span class="truncate font-mono text-xs font-normal text-base-content/70" class:text-sm={!nameOf(ws.symbol)} class:font-semibold={!nameOf(ws.symbol)} class:text-base-content={!nameOf(ws.symbol)}>{ws.symbol}</span>
      </h2>
    {/if}
    <span class="badge badge-xs badge-ghost hidden gap-1 whitespace-nowrap sm:inline-flex" title={freshness.title}>
      <span class="status status-xs {freshness.status}" aria-hidden="true"></span>
      {freshness.label}
    </span>
    <SessionBadge tv={ws.symbol} />
    <span class="flex-1"></span>
    {#if ws.yahoo}
      <button
        class="btn btn-ghost btn-xs shrink-0 gap-1"
        class:btn-active={watched}
        aria-pressed={watched}
        title={watched
          ? 'Analisa harian aktif: AI menganalisa simbol ini tiap hari bursa, memakai 1 kuota analisa per hari. Klik untuk berhenti.'
          : 'AI menganalisa simbol ini otomatis tiap hari bursa; hasilnya di Pantau dan Telegram. Memakai 1 kuota analisa per hari.'}
        onclick={() => watch.toggle(ws.yahoo!, ws.symbol)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:text-accent={watched} aria-hidden="true"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5M17.5 17.5 16 16.3V14" /><circle cx="16" cy="16" r="6" /></svg>
        Analisa harian
      </button>
      <button class="btn btn-ghost btn-xs shrink-0 gap-1" title="Buka chart aplikasi di tanggal tertentu" onclick={jumpToDate}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        Lompat ke tanggal
      </button>
    {/if}
    {#if ws.screen === 'pasar' && ws.yahoo}
      <button class="btn btn-primary btn-xs shrink-0 gap-1" title="Buka aset ini di Riset AI: tanya AI dan analisa lengkap" onclick={() => ws.research()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d={SCREEN_ICONS.riset} /></svg>
        Riset AI
      </button>
    {/if}
    <div class="join shrink-0" role="group" aria-label="Jenis grafik">
      <button class="btn btn-xs join-item" class:btn-active={view === 'tv'} aria-pressed={view === 'tv'} onclick={() => ws.setChartView('tv')}>TradingView</button>
      <button
        class="btn btn-xs join-item"
        class:btn-active={view === 'ai'}
        aria-pressed={view === 'ai'}
        disabled={!ws.yahoo}
        title={ws.yahoo ? (ws.screen === 'riset' ? 'Chart aplikasi dengan tanda tiap keputusan AI' : 'Chart aplikasi: indikator, sinyal, dan rencana trading') : 'Simbol ini belum bisa dianalisa engine'}
        onclick={() => ws.setChartView('ai')}>{ws.screen === 'riset' ? 'Keputusan AI' : 'Sinyal'}</button
      >
    </div>
    {#if desktop}
      <button class="btn btn-xs shrink-0 gap-1" class:btn-active={layout.focus} aria-pressed={layout.focus} title="Tombol F" onclick={() => layout.toggleFocus()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        {layout.focus ? 'Keluar fokus' : 'Fokus'}
      </button>
      <LayoutMenu />
    {/if}
  </header>
  <div class="min-h-0 flex-1 overflow-hidden">
    {#if view === 'ai' && ws.yahoo}
      <div class="flex h-full min-h-0 flex-col gap-2 p-3">
        <div class="min-h-0 flex-1">
          {#key ws.yahoo}
            <DecisionChart
              symbol={ws.yahoo}
              showTable={false}
              refresh={ws.decisionsVersion}
              drawings={agent.visibleDrawings}
              timeframe={ws.timeframe}
              onTimeframe={(tf) => ws.setTimeframe(tf)}
              {jumpRequest}
              venue={venueOf(ws.symbol)}
              research={ws.screen === 'riset'}
              tools
            />
          {/key}
        </div>
        {#if agent.drawings.length}
          <div class="flex shrink-0 flex-wrap items-center gap-1" aria-label="Layer gambar agent">
            {#each LAYERS.filter((l) => agent.drawings.some((d) => d.kind === l.key)) as layer (layer.key)}
              <button class="btn btn-xs" class:btn-active={!agent.hidden[layer.key]} aria-pressed={!agent.hidden[layer.key]} onclick={() => agent.toggleLayer(layer.key)}>
                {layer.label}
              </button>
            {/each}
            <button class="btn btn-ghost btn-xs ml-auto" onclick={() => agent.clearDrawings()}>Hapus gambar</button>
          </div>
        {/if}
      </div>
    {:else}
      {#key ws.symbol}
        <TradingViewWidget
          widget="advanced-chart"
          class="h-full"
          config={{
            autosize: true,
            symbol: ws.symbol,
            interval: 'D',
            timezone: 'Asia/Jakarta',
            style: '1',
            // The symbol box and the market list change the symbol, so the AI panel stays in step.
            allow_symbol_change: false,
            withdateranges: true,
            hide_side_toolbar: false,
            calendar: false,
            details: false,
            studies: ['STD;RSI'],
            backgroundColor: surface.background,
            gridColor: surface.grid,
            support_host: 'https://www.tradingview.com',
          }}
        />
      {/key}
    {/if}
  </div>
</section>
