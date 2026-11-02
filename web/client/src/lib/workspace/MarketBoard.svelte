<script lang="ts">
  // Pasar's start: one market at a time (IDX, US, Crypto, Forex, Komoditas) across the whole width,
  // before any chart: name, last price, today's change, and the last 30 days as a small line with
  // its change, from the server's quotes (GET /api/quotes?spark=1, the daily bars the chart reads).
  // A row opens that asset's chart; the star puts it on the daily AI analysis (Pantauanku). The
  // market's screener waits in the bottom panel. Refreshed every minute while the tab is in front.
  import { api, type Quote } from '../api';
  import { priceText } from '../beginner/plain';
  import SessionBadge from '../SessionBadge.svelte';
  import Sparkline from '../Sparkline.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { MARKET_TABS, toYahoo } from '../tv';

  const SHORT: Record<string, string> = { idx: 'IDX', us: 'US', crypto: 'Kripto', forex: 'Forex', commodities: 'Komoditas' };
  const active = $derived(MARKET_TABS.find((t) => t.key === ws.market) ?? MARKET_TABS[0]);
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

  const percent = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(2).replace('.', ',')}%`;
  const tone = (x: number | null | undefined) => (x == null || x === 0 ? 'text-base-content/70' : x > 0 ? 'text-success' : 'text-error');
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-base-100" aria-label="Pasar">
  <!-- One readable column, however wide the window: name, price and change stay close enough to scan across. -->
  <header class="shrink-0 border-b border-base-300">
    <div class="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
      <div role="tablist" class="tabs tabs-border tabs-sm flex-nowrap overflow-x-auto" aria-label="Pasar">
        {#each MARKET_TABS as tab (tab.key)}
          <button role="tab" class="tab whitespace-nowrap" class:tab-active={tab.key === active.key} aria-selected={tab.key === active.key} onclick={() => ws.setMarket(tab.key)}>
            {SHORT[tab.key] ?? tab.label}
          </button>
        {/each}
      </div>
      <span class="hidden flex-1 sm:block"></span>
      {#if sessionSymbol}<SessionBadge tv={sessionSymbol} />{/if}
      <label class="input input-sm w-full sm:w-56">
        <svg class="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" stroke-linecap="round" /></svg>
        <input class="grow" type="search" placeholder="Cari di {SHORT[active.key] ?? active.label}" aria-label="Cari di daftar {SHORT[active.key] ?? active.label}" bind:value={filter} />
      </label>
    </div>
  </header>

  <div class="min-h-0 flex-1 overflow-auto">
    <div class="@container mx-auto w-full max-w-5xl">
      {#if failed && !Object.keys(quotes).length}
        <p class="px-4 pt-3 text-sm text-error" role="alert">Harga belum bisa dimuat. Dicoba lagi tiap menit.</p>
      {/if}
      {#if !groups.length}
        <p class="px-4 py-6 text-sm text-base-content/70">Tidak ada aset "{filter}" di daftar {SHORT[active.key] ?? active.label}. Coba kotak cari di atas untuk semua pasar.</p>
      {:else}
        <table class="table table-sm">
          <thead class="sticky top-0 z-10 bg-base-100">
            <tr>
              <th>Nama</th>
              <th class="w-36 text-right">Harga</th>
              <th class="w-24 text-right">Hari ini</th>
              <th class="hidden w-52 @xl:table-cell">30 hari</th>
              <th class="w-10"><span class="sr-only">Pantauanku</span></th>
            </tr>
          </thead>
          {#each groups as group (group.name)}
            <tbody>
              <tr><th colspan="5" class="bg-base-200/60 py-1 text-xs font-semibold text-base-content/70">{group.name}</th></tr>
              {#each group.items as item (item.tv)}
                {@const q = item.yahoo ? quotes[item.yahoo] : null}
                {@const watched = watch.has(item.yahoo)}
                <tr class="cursor-pointer hover:bg-base-200" class:bg-base-200={ws.symbol === item.tv} onclick={() => ws.setSymbol(item.tv)}>
                  <td class="max-w-0 min-w-32">
                    <button class="block w-full text-left" onclick={(e) => (e.stopPropagation(), ws.setSymbol(item.tv))}>
                      <span class="block truncate font-medium">{item.name}</span>
                      <span class="block truncate font-mono text-xs text-base-content/70">{item.tv.split(':').pop()}</span>
                    </button>
                  </td>
                  <td class="text-right whitespace-nowrap tabular-nums">
                    {#if q}{priceText(q.price, q.currency, item.yahoo ?? '')}{:else}<span class="text-base-content/50">{item.yahoo && !(item.yahoo in quotes) ? '…' : '–'}</span>{/if}
                  </td>
                  <td class="text-right whitespace-nowrap tabular-nums {tone(q?.change)}">{q?.change == null ? '' : percent(q.change)}</td>
                  <td class="hidden @xl:table-cell">
                    {#if q?.spark && q.spark.length > 1}
                      <span class="flex items-center gap-2 {tone(q.month)}">
                        <Sparkline values={q.spark} class="h-6 w-28" />
                        <span class="w-16 text-right text-xs tabular-nums">{q.month == null ? '' : percent(q.month)}</span>
                      </span>
                    {/if}
                  </td>
                  <td class="text-right">
                    {#if item.yahoo}
                      <button
                        class="btn btn-ghost btn-xs btn-square"
                        aria-pressed={watched}
                        aria-label="{watched ? 'Hapus dari' : 'Tambah ke'} Pantauanku: {item.name}"
                        title={watched ? 'Hapus dari Pantauanku' : 'Tambah ke Pantauanku: dianalisa AI tiap hari bursa (1 kuota analisa per hari)'}
                        onclick={(e) => (e.stopPropagation(), watch.toggle(item.yahoo!, item.tv))}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" class:text-warning={watched} class:opacity-40={!watched} aria-hidden="true"
                          ><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg
                        >
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          {/each}
        </table>
      {/if}
      <p class="px-4 py-3 text-xs text-base-content/70">Klik aset untuk membuka chart-nya. Harga saham dan indeks tertunda beberapa menit; kripto real-time.</p>
    </div>
  </div>
</section>
