<script lang="ts">
  // The chart toolbar's venue menu for crypto: every venue's live price for the asset (the server
  // streams them from each exchange's WebSocket, server/src/venues.ts), its gap to the median, the
  // bid-ask spread and how fresh it is. A click moves the chart, the TradingView pane and the
  // indicators to that venue's prices.
  import { ws } from '../stores/workspace.svelte';
  import { CRYPTO_VENUES, onVenue, type VenueId } from '../tv';
  import { keepPlaced, placeMenu } from './menuSide';

  let { base, venue }: { base: string; venue: VenueId } = $props();

  type Quote = {
    venue: VenueId;
    label: string;
    pair: string | null;
    quote: string;
    last: number | null;
    bid: number | null;
    ask: number | null;
    usd: number | null;
    at: number | null;
    live: boolean;
    error?: string;
  };

  let open = $state(false);
  let place = $state({ left: 0, width: 0, maxHeight: 0 });
  let quotes = $state<Quote[]>([]);
  let note = $state('');
  let now = $state(Date.now());
  let root: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (open && root) return keepPlaced(root, 26, (p) => (place = p));
  });
  $effect(() => {
    if (!open) return;
    const stream = new EventSource(`/api/venues/stream?base=${encodeURIComponent(base)}`);
    stream.addEventListener('quotes', (e) => {
      quotes = JSON.parse((e as MessageEvent).data);
      note = '';
    });
    stream.onerror = () => (note = 'Koneksi harga terputus, menyambung lagi…');
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => {
      stream.close();
      clearInterval(tick);
    };
  });
  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });

  const priced = $derived(quotes.filter((q) => q.usd != null));
  const median = $derived.by(() => {
    const v = priced.map((q) => q.usd!).sort((a, b) => a - b);
    if (!v.length) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  });
  const lowest = $derived(priced.length > 1 ? priced.reduce((a, q) => (q.usd! < a.usd! ? q : a)).venue : null);
  const highest = $derived(priced.length > 1 ? priced.reduce((a, q) => (q.usd! > a.usd! ? q : a)).venue : null);
  const label = $derived(CRYPTO_VENUES.find((v) => v.id === venue)?.label ?? 'Binance');

  const price = (q: Quote) =>
    q.last == null ? '–' : q.last.toLocaleString('id-ID', { maximumFractionDigits: q.quote === 'IDR' ? 0 : q.last >= 10 ? 2 : 6 });
  const gap = (q: Quote) => (q.usd == null || median == null ? null : ((q.usd - median) / median) * 100);
  const spreadBps = (q: Quote) => (q.bid && q.ask && q.ask >= q.bid ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 10_000 : null);
  const age = (q: Quote) => (q.at == null ? null : Math.max(0, Math.round((now - q.at) / 1000)));

  function pick(id: VenueId) {
    const next = onVenue(ws.symbol, id);
    if (next) ws.setSymbol(next);
    open = false;
  }
</script>

<div class="relative" bind:this={root}>
  <button
    class="btn btn-xs gap-1"
    class:btn-active={open}
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => {
      if (!open && root) place = placeMenu(root, 26);
      open = !open;
    }}
  >
    Bursa: {label}
  </button>
  {#if open}
    <div
      class="ta-pop absolute top-full z-40 mt-1 flex flex-col gap-2 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-xl"
      style:left="{place.left}px"
      style:width="{place.width}px"
      style:max-height="{place.maxHeight}px"
      role="dialog"
      aria-label="Harga {base} di semua bursa"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="font-semibold">{base} di semua bursa</h3>
        <span class="text-xs text-base-content/70">real-time dari server</span>
      </div>
      {#if note}<p class="text-xs text-warning" role="status">{note}</p>{/if}
      {#if !quotes.length}
        <p class="flex items-center gap-2 text-xs text-base-content/70"><span class="loading loading-spinner loading-xs"></span> Menghubungi bursa…</p>
      {:else}
        <table class="table table-xs">
          <thead>
            <tr>
              <th>Bursa</th>
              <th class="text-right">Harga</th>
              <th class="text-right" title="Selisih terhadap median semua bursa, dalam dolar">vs median</th>
              <th class="text-right" title="Selisih bid dan ask, dalam basis poin">Spread</th>
              <th class="text-right">Umur</th>
            </tr>
          </thead>
          <tbody>
            {#each quotes as q (q.venue)}
              {@const g = gap(q)}
              {@const s = spreadBps(q)}
              {@const a = age(q)}
              <tr
                class="cursor-pointer hover:bg-base-200"
                class:bg-base-200={q.venue === venue}
                aria-disabled={!q.pair}
                onclick={() => q.pair && pick(q.venue)}
              >
                <td class="whitespace-nowrap">
                  <span class="font-medium">{q.label}</span>
                  {#if q.venue === lowest}<span class="badge badge-xs badge-success badge-soft">termurah</span>{/if}
                  {#if q.venue === highest}<span class="badge badge-xs badge-error badge-soft">termahal</span>{/if}
                  <span class="block font-mono text-[11px] text-base-content/60">{q.pair ?? '—'}</span>
                </td>
                {#if q.error && q.last == null}
                  <td colspan="4" class="text-right text-xs text-base-content/60">{q.error}</td>
                {:else}
                  <td class="text-right font-mono tabular-nums">{price(q)}</td>
                  <td class="text-right tabular-nums" class:text-warning={g != null && Math.abs(g) > 0.3}>
                    {g == null ? '–' : `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(2)}%`}
                  </td>
                  <td class="text-right tabular-nums">{s == null ? '–' : s.toFixed(1)}</td>
                  <td class="text-right tabular-nums" class:text-warning={a != null && a > 30}>{a == null ? '–' : `${a} dtk`}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="text-xs text-base-content/70">
          Klik bursa untuk memakai harganya di chart, indikator, skrip, dan panel TradingView. Rupiah dihitung ke dolar dengan kurs USDT/IDR
          bursa itu sendiri; Coinbase dan Kraken memakai dolar (USD), bursa lain USDT.
        </p>
      {/if}
    </div>
  {/if}
</div>
