<script module lang="ts">
  let made = 0;
</script>

<script lang="ts">
  // Find an asset to open: type a name or code, matched across every market the app lists
  // (assets.ts), or, with `browse`, go through one market's list with its prices. ↑/↓ moves (the row it
  // is on is ringed while the box has focus), Enter opens (a code the lists lack is tried as typed), Escape
  // clears, then closes. Riset AI's asset switcher shows it small in a popover, with the assets opened lately
  // heading each market; Riset AI's start shows it large (ADR 0019): there `home` adds a first list, Untukmu,
  // in groups, a row may carry the AI's last call, and the asset shown beside the list is marked. The lists
  // are buttons pressed in turn, not ARIA tabs whose arrow keys nothing here implements.
  import { untrack } from 'svelte';
  import { api, type Quote } from '../api';
  import { findAsset, LISTED, matching, symbolsOf } from '../assets';
  import { friendlyName, priceText } from '../beginner/plain';
  import { dirOf, monogram, percentText, type Call } from '../marks';
  import { ws } from '../stores/workspace.svelte';
  import { MARKET_TABS, toYahoo } from '../tv';
  import Icon from './Icon.svelte';

  type Group = { heading: string; note?: string; symbols: string[] };

  let {
    browse = false,
    autofocus = false,
    size = 'sm',
    home,
    selected = null,
    callOf,
    watched,
    onpick,
    onclose,
  }: {
    /** Show a market's list while nothing is typed. */
    browse?: boolean;
    autofocus?: boolean;
    size?: 'sm' | 'lg';
    /** A first list before the markets, in groups (Riset AI's Untukmu). */
    home?: Group[];
    /** The asset shown beside the list. */
    selected?: string | null;
    /** The AI's last call on an asset, if there is one. */
    callOf?: (tv: string) => Call | null;
    /** Whether an asset is on Pantauanku. */
    watched?: (tv: string) => boolean;
    onpick: (tv: string) => void;
    onclose?: () => void;
  } = $props();

  const SHORT: Record<string, string> = { home: 'Untukmu', idx: 'IDX', us: 'US', crypto: 'Kripto', forex: 'Forex', commodities: 'Komoditas' };
  const NAMES = new Map(LISTED);
  const listId = `asset-finder-${++made}`;
  const large = $derived(size === 'lg');
  const lists = $derived([...(home ? ['home'] : []), ...MARKET_TABS.map((t) => t.key)]);

  let text = $state('');
  // The list it opens on, read once: Untukmu where there is one, else the market in focus.
  let market = $state(untrack(() => (home ? 'home' : ws.market)));
  let at = $state(0);
  let error = $state(false);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  type Row = { tv: string; name: string; heading?: string; note?: string };
  const rows = $derived.by((): Row[] => {
    if (text.trim()) return matching(text).map(([tv, name]) => ({ tv, name }));
    if (!browse) return [];
    if (market === 'home' && home) {
      // An asset in two groups shows in the first only: a row's key is its symbol.
      const seen = new Set<string>();
      return home.flatMap((g) => {
        const fresh = g.symbols.filter((tv) => !seen.has(tv));
        for (const tv of fresh) seen.add(tv);
        return fresh.map((tv, i) => ({ tv, name: NAMES.get(tv) ?? friendlyName(tv), heading: i === 0 ? g.heading : undefined, note: i === 0 ? g.note : undefined }));
      });
    }
    // With no Untukmu list, the assets opened lately head each market's.
    const recent = home ? [] : ws.recent.filter((s) => s !== ws.symbol).slice(0, 4);
    const listed = symbolsOf(market).filter((s) => !recent.includes(s));
    return [
      ...recent.map((tv, i) => ({ tv, name: NAMES.get(tv) ?? friendlyName(tv), heading: i === 0 ? 'Terakhir dibuka' : undefined })),
      ...listed.map((tv, i) => ({ tv, name: NAMES.get(tv) ?? friendlyName(tv), heading: i === 0 && recent.length ? (SHORT[market] ?? market) : undefined })),
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
</script>

<div class="ta-finder flex min-h-0 flex-col {large ? 'gap-3' : 'gap-2'}">
  <label class="input w-full {large ? 'input-lg' : 'input-sm'}" class:input-error={error}>
    <Icon name="search" size={large ? 20 : 14} class="opacity-60" />
    <input
      bind:this={input}
      bind:value={text}
      oninput={() => (error = false)}
      onkeydown={key}
      class="grow"
      placeholder={large ? 'Cari aset: Emas, BBCA, Bitcoin…' : 'Cari: Bitcoin, BBCA, Emas…'}
      aria-label="Cari aset"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={rows.length > 0}
      aria-controls={listId}
      aria-activedescendant={rows.length ? `${listId}-${at}` : undefined}
      aria-invalid={error || undefined}
      aria-describedby={error ? `${listId}-error` : undefined}
      autocomplete="off"
      spellcheck="false"
    />
  </label>
  {#if error}<p id="{listId}-error" class="text-xs text-error" role="alert">Aset tidak ditemukan. Ketik nama (Emas, Bitcoin) atau kode (BBCA, BTC-USD).</p>{/if}
  {#if browse && !text.trim()}
    <div role="group" class="tabs max-w-full shrink-0 flex-nowrap self-start overflow-x-auto {large ? 'tabs-box' : 'tabs-border tabs-xs'}" aria-label="Daftar aset">
      {#each lists as key (key)}
        <button type="button" class="tab whitespace-nowrap" class:tab-active={key === market} aria-pressed={key === market} onclick={() => (market = key)}>
          {SHORT[key] ?? MARKET_TABS.find((t) => t.key === key)?.label ?? key}
        </button>
      {/each}
    </div>
  {/if}
  {#if rows.length}
    <ul id={listId} role="listbox" aria-label="Aset" tabindex="-1" class={large ? 'ta-card flex flex-col gap-0.5 p-1.5' : 'min-h-0 overflow-y-auto'} bind:this={list}>
      {#each rows as row, i (row.tv)}
        {@const y = toYahoo(row.tv)}
        {@const q = y ? quotes[y] : null}
        {@const call = large ? (callOf?.(row.tv) ?? null) : null}
        {#if row.heading}
          {#if large}
            <li role="presentation" class="ta-group-label px-2.5 pt-3">
              <span>{row.heading}</span>{#if row.note}<span class="font-medium tracking-normal normal-case">{row.note}</span>{/if}
            </li>
          {:else}
            <li role="presentation" class="px-2 pt-2 pb-1 text-xs font-semibold text-base-content/70">{row.heading}</li>
          {/if}
        {/if}
        <li id="{listId}-{i}" role="option" aria-selected={i === at} data-row={i}>
          {#if large}
            <button
              type="button"
              tabindex="-1"
              class="ta-asset"
              data-active={i === at || undefined}
              aria-current={selected === row.tv ? 'true' : undefined}
              onmouseenter={() => (at = i)}
              onclick={() => pick(row.tv)}
            >
              <span class="ta-mono" data-watched={watched?.(row.tv) || undefined}>{monogram(row.tv)}</span>
              <span class="min-w-0">
                <span class="block truncate font-semibold">{row.name}</span>
                <span class="mt-0.5 flex min-w-0 items-center gap-2 text-xs ta-muted">
                  <span class="truncate font-mono">{row.tv.split(':').pop()}</span>
                  {#if call}<span class="ta-chip" data-dir={call.dir}><Icon name={call.icon} size={12} stroke={2.4} />AI: {call.label}{call.when ? ` · ${call.when}` : ''}</span>{/if}
                </span>
              </span>
              {#if q}
                <span class="flex flex-col items-end gap-1 tabular-nums">
                  <span class="font-semibold">{priceText(q.price, q.currency, y ?? '')}</span>
                  {#if q.change != null}<span class="ta-chip" data-dir={dirOf(q.change)}>{percentText(q.change)}</span>{/if}
                </span>
              {/if}
            </button>
          {:else}
            <button
              type="button"
              tabindex="-1"
              class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-sm"
              class:bg-base-200={i === at}
              data-active={i === at || undefined}
              onmouseenter={() => (at = i)}
              onclick={() => pick(row.tv)}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{row.name}</span>
                <span class="block truncate font-mono text-xs text-base-content/70">{row.tv.split(':').pop()}</span>
              </span>
              {#if q}
                <span class="tabular-nums">{priceText(q.price, q.currency, y ?? '')}</span>
                <span class="w-16 text-right text-xs tabular-nums" class:text-success={(q.change ?? 0) > 0} class:text-error={(q.change ?? 0) < 0}>
                  {q.change == null ? '' : percentText(q.change)}
                </span>
              {/if}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if text.trim()}
    <p class="px-1 text-xs text-base-content/70">Tidak ada di daftar. Tekan Enter untuk mencoba kode “{text.trim()}” langsung.</p>
  {/if}
</div>
