<script lang="ts">
  // Chart pasar on Uji strategi → Indikator: the picked indicator drawn alone (DecisionChart's `only`) on the asset in
  // focus, the same one Pasar and Riset AI show, whichever indicators those have on. The asset changes here without
  // leaving the page: the one in focus, those lately opened and those in the test form, or any from the finder
  // (ws.preview leaves the URL and the recent list as they are). An engine that draws on some timeframes only says
  // so, with a button for each. What the chart counts has no costs and no held-out data, so it says where the
  // honest numbers are: the test card.
  import { tick } from 'svelte';
  import type { Interval } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { keepPlaced, placeMenu } from '../../chart/menuSide';
  import DecisionChart from '../../DecisionChart.svelte';
  import { lab } from '../../stores/lab.svelte';
  import { layoutOf, viewport } from '../../stores/viewport.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { toTradingView, venueOf } from '../../tv';
  import AssetFinder from '../AssetFinder.svelte';
  import Icon from '../Icon.svelte';
  import type { IndicatorItem } from './IndicatorList.svelte';

  let { item, testable, onadd }: { item: IndicatorItem; testable: boolean; onadd: () => void } = $props();

  /** Timeframes an engine is drawn on (DecisionChart: PoB on 15 minutes and 1 hour, Fib also on daily). */
  const DRAWN_ON: Record<string, Interval[]> = { pob: ['15m', '1h'], fib: ['15m', '1h', '1d'] };
  const TF_WORD: Partial<Record<Interval, string>> = { '15m': '15 menit', '1h': '1 jam', '4h': '4 jam', '1d': 'harian' };
  const MAX_ASSETS = 5;

  const narrow = $derived(layoutOf(viewport) === 'narrow');
  const drawnOn = $derived(item.engine ? DRAWN_ON[item.engine] : undefined);
  const offTimeframe = $derived(!!drawnOn && !drawnOn.includes(ws.timeframe));
  const joinWords = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} dan ${xs.at(-1)}`);

  /** Quick picks: the asset in focus, those lately opened and those in the test form, each once. */
  const quick = $derived.by(() => {
    const out: string[] = [];
    for (const tv of [ws.symbol, ...ws.recent, ...lab.symbols.map(toTradingView)]) if (tv && !out.includes(tv)) out.push(tv);
    return out.slice(0, 8);
  });

  const inTest = $derived(!!ws.yahoo && lab.symbols.includes(ws.yahoo));
  const testFull = $derived(lab.symbols.length >= MAX_ASSETS);
  function addToTest() {
    if (!ws.yahoo || inTest || testFull) return;
    lab.symbols = [...lab.symbols, ws.yahoo];
    onadd();
  }

  // --- "Aset lain": the asset finder in a popover, as the test form's "Tambah aset" has it.
  let open = $state(false);
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let root: HTMLDivElement | undefined = $state();
  let opener: HTMLButtonElement | undefined = $state();
  async function close() {
    open = false;
    await tick();
    opener?.focus();
  }
  function pick(tv: string) {
    ws.preview(tv);
    close();
  }
  $effect(() => {
    if (open && root) return keepPlaced(root, 22, (p) => (place = p));
  });
  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Aset di chart">
    {#each quick as tv (tv)}
      <button
        type="button"
        class="btn btn-sm rounded-full font-medium {tv === ws.symbol ? 'btn-neutral' : 'border-base-300 bg-base-100'}"
        aria-pressed={tv === ws.symbol}
        onclick={() => ws.preview(tv)}
      >
        {friendlyName(tv)}
      </button>
    {/each}
    <div class="relative" bind:this={root}>
      <button
        bind:this={opener}
        type="button"
        class="btn btn-sm rounded-full border-dashed border-base-300 bg-transparent font-medium text-accent shadow-none"
        aria-haspopup="dialog"
        aria-expanded={open}
        onclick={() => {
          if (!open && root) place = placeMenu(root, 22);
          open = !open;
        }}><Icon name="search" size={16} />Aset lain</button
      >
      {#if open}
        <div
          class="ta-pop absolute top-full z-40 mt-1 flex flex-col rounded-box border border-base-300 bg-base-100 p-2 shadow-xl"
          style:left="{place.left}px"
          style:width="{place.width}px"
          style:max-height="{place.maxHeight}px"
          role="dialog"
          aria-label="Pilih aset untuk chart"
        >
          <AssetFinder browse autofocus={!narrow} onpick={pick} onclose={close} />
        </div>
      {/if}
    </div>
  </div>

  {#if !item.drawable}
    <p class="alert alert-soft items-start text-sm"><Icon name="info" size={16} /><span>{item.name} tidak digambar di chart: indikator ini hanya diuji. Hasilnya ada di Detail indikator.</span></p>
  {:else if !ws.yahoo}
    <p class="alert alert-soft items-start text-sm"><Icon name="info" size={16} /><span>{friendlyName(ws.symbol)} belum bisa dibaca mesin, jadi indikatornya tidak bisa digambar. Pilih aset lain.</span></p>
  {:else}
    {#if offTimeframe && drawnOn}
      <div class="alert alert-soft alert-info items-start text-sm" role="status">
        <Icon name="info" size={16} />
        <div class="flex flex-col gap-2">
          <span>{item.name} digambar di timeframe {joinWords(drawnOn.map((tf) => TF_WORD[tf] ?? tf))}.</span>
          <div class="flex flex-wrap gap-2">
            {#each drawnOn as tf (tf)}<button type="button" class="btn btn-xs" onclick={() => ws.setTimeframe(tf)}>Pakai {TF_WORD[tf] ?? tf}</button>{/each}
          </div>
        </div>
      </div>
    {/if}
    <div class="ta-card p-3">
      {#key ws.yahoo}
        <DecisionChart
          symbol={ws.yahoo}
          only={item.id}
          tools
          fill={false}
          height={narrow ? 340 : 460}
          research={false}
          showTable={false}
          timeframe={ws.timeframe}
          onTimeframe={(tf) => ws.setTimeframe(tf)}
          venue={venueOf(ws.symbol)}
        />
      {/key}
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <p class="min-w-0 flex-1 basis-64 text-sm ta-muted">Chart ini hanya menggambar {item.name}, tanpa biaya. Hasil yang bisa dipercaya ada di kartu Uji: dengan biaya, dan dicek di data yang belum dipakai.</p>
      {#if testable}
        <button type="button" class="btn btn-sm" disabled={inTest || testFull} onclick={addToTest}>
          <Icon name="plus" size={16} />{inTest ? `${friendlyName(ws.symbol)} sudah di uji` : testFull ? `Uji sudah ${MAX_ASSETS} aset` : `Tambah ${friendlyName(ws.symbol)} ke uji`}
        </button>
      {/if}
    </div>
  {/if}
</div>
