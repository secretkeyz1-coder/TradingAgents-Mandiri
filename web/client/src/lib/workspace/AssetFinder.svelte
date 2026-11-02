<script module lang="ts">
  let made = 0;
</script>

<script lang="ts">
  // Find an asset to open: type a name or code, matched across every market the app lists
  // (assets.ts), or, with `browse`, go through one market's list with its prices, the assets
  // opened lately first. ↑/↓ moves, Enter opens (a code the lists lack is tried as typed), Escape
  // closes. Riset AI's asset switcher shows it in a popover, its asset picker inline.
  import { api, type Quote } from '../api';
  import { findAsset, LISTED, matching, symbolsOf } from '../assets';
  import { priceText } from '../beginner/plain';
  import { ws } from '../stores/workspace.svelte';
  import { MARKET_TABS, toYahoo } from '../tv';

  let {
    browse = false,
    autofocus = false,
    onpick,
    onclose,
  }: {
    /** Show a market's list while nothing is typed. */
    browse?: boolean;
    autofocus?: boolean;
    onpick: (tv: string) => void;
    onclose?: () => void;
  } = $props();

  const SHORT: Record<string, string> = { idx: 'IDX', us: 'US', crypto: 'Kripto', forex: 'Forex', commodities: 'Komoditas' };
  const NAMES = new Map(LISTED);
  const listId = `asset-finder-${++made}`;

  let text = $state('');
  let market = $state(ws.market);
  let at = $state(0);
  let error = $state(false);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  type Row = { tv: string; name: string; heading?: string };
  const rows = $derived.by((): Row[] => {
    if (text.trim()) return matching(text).map(([tv, name]) => ({ tv, name }));
    if (!browse) return [];
    const recent = ws.recent.filter((s) => s !== ws.symbol).slice(0, 4);
    const listed = symbolsOf(market).filter((s) => !recent.includes(s));
    return [
      ...recent.map((tv, i) => ({ tv, name: NAMES.get(tv) ?? tv, heading: i === 0 ? 'Terakhir dibuka' : undefined })),
      ...listed.map((tv, i) => ({ tv, name: NAMES.get(tv) ?? tv, heading: i === 0 && recent.length ? (SHORT[market] ?? market) : undefined })),
    ];
  });

  // Prices for what is listed, read once per asset while the finder is open.
  let quotes = $state<Record<string, Quote | null>>({});
  $effect(() => {
    const wanted = [...new Set(rows.flatMap((r) => toYahoo(r.tv) ?? []))].filter((s) => !(s in quotes)).slice(0, 80);
    if (!wanted.length) return;
    const timer = setTimeout(() => {
      api
        .quotes(wanted)
        .then((a) => (quotes = { ...quotes, ...a.quotes }))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    void rows;
    at = 0;
  });
  $effect(() => {
    if (autofocus) input?.focus();
  });

  function pick(tv: string | null) {
    error = !tv;
    if (!tv) return;
    text = '';
    onpick(tv);
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      at = (at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      list?.querySelector<HTMLElement>(`[data-row="${at}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[at]?.tv ?? findAsset(text));
    } else if (e.key === 'Escape') {
      if (text) text = '';
      else onclose?.();
    }
  }

  const percent = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(2).replace('.', ',')}%`;
</script>

<div class="flex min-h-0 flex-col gap-2">
  <label class="input input-sm w-full" class:input-error={error}>
    <svg class="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" stroke-linecap="round" /></svg>
    <input
      bind:this={input}
      bind:value={text}
      oninput={() => (error = false)}
      onkeydown={key}
      class="grow"
      placeholder="Cari: Bitcoin, BBCA, Emas…"
      aria-label="Cari aset"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={rows.length > 0}
      aria-controls={listId}
      aria-activedescendant={rows.length ? `${listId}-${at}` : undefined}
      autocomplete="off"
      spellcheck="false"
    />
  </label>
  {#if error}<p class="text-xs text-error" role="alert">Aset tidak ditemukan. Ketik nama (Emas, Bitcoin) atau kode (BBCA, BTC-USD).</p>{/if}
  {#if browse && !text.trim()}
    <div role="tablist" class="tabs tabs-border tabs-xs shrink-0 flex-nowrap overflow-x-auto" aria-label="Pasar">
      {#each MARKET_TABS as tab (tab.key)}
        <button role="tab" class="tab whitespace-nowrap" class:tab-active={tab.key === market} aria-selected={tab.key === market} onclick={() => (market = tab.key)}>
          {SHORT[tab.key] ?? tab.label}
        </button>
      {/each}
    </div>
  {/if}
  {#if rows.length}
    <ul id={listId} role="listbox" aria-label="Aset" class="min-h-0 overflow-y-auto" bind:this={list}>
      {#each rows as row, i (row.tv)}
        {@const y = toYahoo(row.tv)}
        {@const q = y ? quotes[y] : null}
        {#if row.heading}<li role="presentation" class="px-2 pt-2 pb-1 text-xs font-semibold text-base-content/60">{row.heading}</li>{/if}
        <li id="{listId}-{i}" role="option" aria-selected={i === at} data-row={i}>
          <button
            type="button"
            tabindex="-1"
            class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-sm"
            class:bg-base-200={i === at}
            onmouseenter={() => (at = i)}
            onclick={() => pick(row.tv)}
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate">{row.name}</span>
              <span class="block truncate font-mono text-xs text-base-content/60">{row.tv.split(':').pop()}</span>
            </span>
            {#if q}
              <span class="tabular-nums">{priceText(q.price, q.currency, y ?? '')}</span>
              <span class="w-16 text-right text-xs tabular-nums" class:text-success={(q.change ?? 0) > 0} class:text-error={(q.change ?? 0) < 0}>
                {q.change == null ? '' : percent(q.change)}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if text.trim()}
    <p class="px-1 text-xs text-base-content/70">Tidak ada di daftar. Tekan Enter untuk mencoba kode "{text.trim()}" langsung.</p>
  {/if}
</div>
