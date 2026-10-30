<script lang="ts">
  // The symbol in focus: TradingView's full chart, or the engine's daily
  // candles with every AI decision marked.
  import DecisionChart from '../DecisionChart.svelte';
  import TradingViewWidget from '../TradingViewWidget.svelte';
  import { agent, LAYERS } from '../stores/agent.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { theme, tokenColor } from '../theme.svelte';

  let { onmarket }: { onmarket?: () => void } = $props();

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
    /^(BINANCE|COINBASE|BYBIT|KRAKEN|BITSTAMP|CRYPTO|FX|FX_IDC|OANDA|FOREXCOM):/.test(ws.symbol)
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
  watch.load();
  let bodyHeight = $state(0);
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Chart">
  <header class="flex h-10 shrink-0 items-center gap-2 border-b border-base-300 px-3">
    {#if onmarket}
      <button class="btn btn-ghost btn-xs" onclick={onmarket}>Pasar</button>
    {/if}
    <h2 class="truncate font-mono text-sm font-semibold">{ws.symbol}</h2>
    <span class="badge badge-xs badge-ghost hidden gap-1 whitespace-nowrap sm:inline-flex" title={freshness.title}>
      <span class="status status-xs {freshness.status}" aria-hidden="true"></span>
      {freshness.label}
    </span>
    {#if ws.yahoo}
      <button
        class="btn btn-ghost btn-xs ml-auto shrink-0 gap-1"
        aria-pressed={watched}
        title={watched ? 'Hapus dari watchlist' : 'Analisa otomatis tiap hari bursa, hasilnya ke Telegram'}
        onclick={() => watch.toggle(ws.yahoo!, ws.symbol)}
      >
        <span class:text-accent={watched} aria-hidden="true">{watched ? '★' : '☆'}</span>{watched ? 'Dipantau' : 'Pantau'}
      </button>
    {/if}
    <div class="join shrink-0" class:ml-auto={!ws.yahoo}>
      <button class="btn btn-xs join-item" class:btn-active={view === 'tv'} onclick={() => ws.setChartView('tv')}>TradingView</button>
      <button
        class="btn btn-xs join-item"
        class:btn-active={view === 'ai'}
        disabled={!ws.yahoo}
        title={ws.yahoo ? undefined : 'Simbol ini belum bisa dianalisa engine'}
        onclick={() => ws.setChartView('ai')}>Keputusan AI</button
      >
    </div>
  </header>
  <div class="min-h-0 flex-1 overflow-hidden" bind:clientHeight={bodyHeight}>
    {#if view === 'ai' && ws.yahoo}
      <div class="p-3">
        {#key ws.yahoo}
          <DecisionChart
            symbol={ws.yahoo}
            height={Math.max(200, bodyHeight - (agent.drawings.length ? 96 : 64))}
            showTable={false}
            refresh={ws.decisionsVersion}
            drawings={agent.visibleDrawings}
            timeframe={ws.timeframe}
            onTimeframe={(tf) => ws.setTimeframe(tf)}
          />
        {/key}
        {#if agent.drawings.length}
          <div class="mt-2 flex flex-wrap items-center gap-1" aria-label="Layer gambar agent">
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
