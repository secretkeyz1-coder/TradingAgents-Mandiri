<script lang="ts">
  // Pasar's market list, beside the chart on a wide screen (ADR 0018): one market at a time (IDX, US,
  // Crypto, Forex, Komoditas) from the server's quotes (GET /api/quotes: the daily bars the chart
  // reads), with today's change that traders scan first and, once the panel is wide enough, the last
  // 30 days. A row puts its asset on the chart beside it and nothing else moves; the star puts it on
  // the daily AI analysis (Pantauanku). The list refreshes every minute while the tab is in front; the
  // same market's screener sits in the bottom panel. A phone shows MarketBoard instead.
  import { api, type Quote } from '../api';
  import { priceText } from '../beginner/plain';
  import SessionBadge from '../SessionBadge.svelte';
  import Sparkline from '../Sparkline.svelte';
  import { layout } from '../stores/layout.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { MARKET_TABS, toYahoo } from '../tv';
  import PanelClose from './PanelClose.svelte';

  let { onclose }: { onclose?: () => void } = $props();

  const SHORT: Record<string, string> = { idx: 'IDX', us: 'US', crypto: 'Crypto', forex: 'Forex', commodities: 'Komoditas' };
  const active = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
  const label = $derived(SHORT[active.key] ?? active.label);
  /** The market's hours, from one of its symbols; Komoditas mixes markets with different hours. */
  const sessionSymbol = $derived(active.key === 'commodities' ? null : (active.groups[0]?.symbols[0]?.[0] ?? null));

  let filter = $state('');
  const groups = $derived.by(() => {
    const t = filter.trim().toLowerCase();
    return active.groups
      .map((g) => ({
        name: g.name,
        items: g.symbols
          .filter(([tv, name]) => !t || name.toLowerCase().includes(t) || tv.toLowerCase().includes(t))
          .map(([tv, name]) => ({ tv, name, yahoo: toYahoo(tv) })),
      }))
      .filter((g) => g.items.length);
  });

  let quotes = $state<Record<string, Quote | null>>({});
  let failed = $state(false);
  watch.load();

  $effect(() => {
    const symbols = [...new Set(active.groups.flatMap((g) => g.symbols.flatMap(([tv]) => toYahoo(tv) ?? [])))];
    if (!symbols.length) return;
    let stopped = false;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const answers = await Promise.all(Array.from({ length: Math.ceil(symbols.length / 80) }, (_, i) => api.quotes(symbols.slice(i * 80, i * 80 + 80), true)));
        if (stopped) return;
        quotes = Object.assign({ ...quotes }, ...answers.map((a) => a.quotes));
        failed = false;
      } catch {
        if (!stopped) failed = true;
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });

  // The asset on the chart stays in sight when it changes from elsewhere (Alt+↑/↓, the search box).
  let list: HTMLDivElement | undefined = $state();
  $effect(() => {
    void ws.symbol;
    list?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  });

  const percent = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(2).replace('.', ',')}%`;
  const tone = (x: number | null | undefined) => (x == null || x === 0 ? 'text-base-content/70' : x > 0 ? 'text-success' : 'text-error');

  /** The bottom panel on the screener, brought back if it was hidden. */
  function screener() {
    ws.setDock('screener');
    if (layout.effective('dock') === 'min') layout.restore('dock');
    else if (layout.effective('dock') === 'float') layout.front('dock');
  }
</script>

<section class="@container flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Pasar">
  <header class="flex h-10 shrink-0 items-center gap-2 border-b border-base-300 px-3">
    <h2 class="text-sm font-semibold">Pasar</h2>
    {#if sessionSymbol}<SessionBadge tv={sessionSymbol} />{/if}
    <div class="ml-auto flex items-center gap-1">
      <button class="btn btn-ghost btn-xs" onclick={screener}>Screener</button>
      {#if onclose}<PanelClose label="Tutup panel Pasar" onclick={onclose} />{/if}
    </div>
  </header>
  <div role="tablist" class="tabs tabs-border tabs-sm shrink-0 flex-nowrap overflow-x-auto px-1" aria-label="Pasar">
    {#each MARKET_TABS as tab (tab.key)}
      <button role="tab" class="tab whitespace-nowrap" class:tab-active={tab.key === active.key} aria-selected={tab.key === active.key} onclick={() => ws.setMarket(tab.key)}>
        {SHORT[tab.key] ?? tab.label}
      </button>
    {/each}
  </div>
  <div class="shrink-0 px-3 pt-2 pb-1">
    <label class="input input-sm w-full">
      <svg class="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" stroke-linecap="round" /></svg>
      <input class="grow" type="search" placeholder="Cari di {label}" aria-label="Cari di daftar {label}" bind:value={filter} />
    </label>
  </div>
  <div class="flex shrink-0 items-center gap-2 border-b border-base-300 py-1 pr-1 pl-3 text-xs text-base-content/70" aria-hidden="true">
    <span class="min-w-0 flex-1">Nama</span>
    <span class="w-[6.5rem] text-right">Harga</span>
    <span class="w-16 text-right">Hari ini</span>
    <span class="hidden w-14 text-right @[26rem]:block @[32rem]:w-[8.5rem]">30 hari</span>
    <span class="w-7"></span>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto" bind:this={list}>
    {#if failed && !Object.keys(quotes).length}
      <p class="p-3 text-sm text-error" role="alert">Harga belum bisa dimuat. Dicoba lagi tiap menit.</p>
    {/if}
    {#if !groups.length}
      <p class="px-3 py-4 text-sm text-base-content/70">Tidak ada aset "{filter}" di daftar {label}. Kotak cari di atas layar mencari di semua pasar.</p>
    {/if}
    {#each groups as group (group.name)}
      <h3 class="sticky top-0 z-10 border-b border-base-200 bg-base-100 px-3 pt-2 pb-1 text-xs font-semibold text-base-content/70">{group.name}</h3>
      <ul>
        {#each group.items as item (item.tv)}
          {@const q = item.yahoo ? quotes[item.yahoo] : null}
          {@const on = ws.symbol === item.tv}
          {@const watched = watch.has(item.yahoo)}
          <li class="flex items-center pr-1 hover:bg-base-200" class:bg-base-200={on}>
            <button
              class="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 pl-3 text-left text-sm"
              aria-current={on ? 'true' : undefined}
              onclick={() => ws.setSymbol(item.tv)}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate" class:font-semibold={on}>{item.name}</span>
                <span class="block truncate font-mono text-xs text-base-content/60">{item.tv.split(':').pop()}</span>
              </span>
              <span class="w-[6.5rem] text-right whitespace-nowrap tabular-nums">
                {#if q}{priceText(q.price, q.currency, item.yahoo ?? '')}{:else}<span class="text-base-content/50">{item.yahoo && !(item.yahoo in quotes) ? '…' : '–'}</span>{/if}
              </span>
              <span class="w-16 text-right tabular-nums {tone(q?.change)}">{q?.change == null ? '' : percent(q.change)}</span>
              <span class="hidden w-14 items-center justify-end gap-2 @[26rem]:flex @[32rem]:w-[8.5rem] {tone(q?.month)}">
                {#if q?.spark && q.spark.length > 1}<Sparkline values={q.spark} class="hidden h-5 w-16 @[32rem]:block" />{/if}
                <span class="w-14 shrink-0 text-right text-xs tabular-nums">{q?.month == null ? '' : percent(q.month)}</span>
              </span>
            </button>
            {#if item.yahoo}
              <button
                class="btn btn-ghost btn-xs btn-square w-7"
                aria-pressed={watched}
                aria-label="{watched ? 'Hapus dari' : 'Tambah ke'} Pantauanku: {item.name}"
                title={watched ? 'Hapus dari Pantauanku' : 'Tambah ke Pantauanku: dianalisa AI tiap hari bursa (1 kuota analisa per hari)'}
                onclick={() => watch.toggle(item.yahoo!, item.tv)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" class:text-warning={watched} class:opacity-40={!watched} aria-hidden="true"
                  ><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg
                >
              </button>
            {:else}
              <span class="w-7"></span>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
    <p class="px-3 py-2 text-xs text-base-content/60">Harga saham dan indeks tertunda beberapa menit; kripto real-time.</p>
  </div>
</section>
