<script lang="ts">
  // "Sedang berjalan" (ADR 0021): every call still followed (GET /alerts/history `open`) and every trade the member
  // took (Pantau → Jurnal), each on its SL–entry–TP track with the price now, refreshed each minute while the tab is
  // shown, and the one thing to do with it: take a call into the journal at its levels, or open the journal. A call
  // already taken shows once, as the call, marked Di jurnal.
  import { api, INTERVALS, type Interval, type Journal, type JournalTrade, type Quote, type SignalCall } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { MOOD_LABEL } from '../../journalLabels';
  import { monogram, wibClock, wibDate } from '../../marks';
  import { watch } from '../../stores/watch.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import Icon from '../Icon.svelte';
  import LevelTrack from './LevelTrack.svelte';
  import { indicatorText, priceText, sideName } from './calls';

  let {
    open,
    journal,
    names,
    onJournal,
  }: { open: SignalCall[] | null; journal: Journal | null; names: Record<string, string>; onJournal: (j: Journal) => void } = $props();

  /** Rows before "n lainnya di Pantau". */
  const SHOWN = 6;
  const trades = $derived((journal?.items ?? []).filter((t) => t.status === 'open'));
  const same = (c: SignalCall, t: JournalTrade) => t.symbol === c.symbol && t.entry === c.entry && t.stopLoss === c.stopLoss && t.takeProfit === c.takeProfit;
  const taken = (c: SignalCall) => trades.some((t) => same(c, t));
  const rows = $derived([
    ...(open ?? []).map((c) => ({ kind: 'call' as const, id: c.id, c })),
    ...trades.filter((t) => !(open ?? []).some((c) => same(c, t))).map((t) => ({ kind: 'trade' as const, id: t.id, t })),
  ]);
  const calls = $derived(rows.filter((r) => r.kind === 'call').length);

  // The price now for each track, each minute while the tab is visible.
  const symbols = $derived([...new Set(rows.map((r) => (r.kind === 'call' ? r.c.symbol : r.t.symbol)))].join(','));
  let prices = $state<Record<string, Quote | null>>({});
  $effect(() => {
    const list = symbols ? symbols.split(',') : [];
    if (!list.length) return;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .quotes(list)
        .then((r) => (prices = r.quotes))
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  let note = $state('');
  let taking = $state<string | null>(null);
  /** The member takes a running call: it goes into the journal at the call's levels (server/src/journal.ts). */
  async function take(c: SignalCall) {
    note = '';
    taking = c.id;
    try {
      await api.journalAdd({
        symbol: c.symbol,
        tvSymbol: c.tvSymbol,
        side: c.side === 'SELL' ? 'SELL' : 'BUY',
        entry: c.entry,
        stopLoss: c.stopLoss,
        takeProfit: c.takeProfit,
        source: c.indicator,
        label: indicatorText(c.indicator, c.timeframe, names).slice(0, 80),
      });
      onJournal(await api.journal(30));
    } catch (e) {
      note = (e as Error).message;
    } finally {
      taking = null;
    }
  }

  /** A call's asset on the Sinyal chart, at the call's timeframe. */
  function openAsset(c: SignalCall) {
    ws.setChartView('ai');
    if ((INTERVALS as readonly string[]).includes(c.timeframe)) ws.setTimeframe(c.timeframe as Interval);
    ws.setSymbol(c.tvSymbol);
  }
  const sinceText = (iso: string) =>
    wibDate(iso) === wibDate(new Date().toISOString()) ? `sejak ${wibClock(iso)}` : `sejak ${new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`;
</script>

{#snippet who(tv: string, symbol: string, side: string, onclick: () => void, sub: string)}
  <span class="ta-mono" data-watched={watch.has(symbol) || undefined}>{monogram(tv)}</span>
  <span class="min-w-0">
    <span class="flex flex-wrap items-center gap-2">
      <button type="button" class="link link-hover truncate font-semibold" {onclick}>{friendlyName(tv)}</button>
      <span class="ta-chip" data-dir={side === 'SELL' ? 'down' : 'up'}><Icon name={side === 'SELL' ? 'arrowDown' : 'arrowUp'} size={12} stroke={2.4} />{sideName(side)}</span>
    </span>
    <span class="block truncate text-xs ta-muted">{sub}</span>
  </span>
{/snippet}

<section class="ta-card ta-pane" aria-labelledby="run-title">
  <div class="ta-pane-head">
    <h2 id="run-title" class="font-semibold">Sedang berjalan</h2>
    {#if open && rows.length}<span class="text-sm ta-muted">{calls} call · {rows.length - calls} trade jurnal</span>{/if}
  </div>
  {#if open === null}
    <div class="h-16 animate-pulse rounded-field bg-base-200" aria-label="Memuat"></div>
  {:else if !rows.length}
    <p class="ta-muted">Tidak ada call atau trade yang sedang berjalan.</p>
  {:else}
    <ul class="flex flex-col">
      {#each rows.slice(0, SHOWN) as row (row.id)}
        <li class="ta-run">
          {#if row.kind === 'call'}
            {@const c = row.c}
            {@render who(c.tvSymbol, c.symbol, c.side, () => openAsset(c), `${sinceText(c.at)} · masuk ${priceText(c.entry)} · ${indicatorText(c.indicator, c.timeframe, names)}`)}
            <LevelTrack level={c} now={prices[c.symbol]?.price ?? null} label="{friendlyName(c.tvSymbol)} {sideName(c.side)}" />
            <div class="ta-run-act">
              {#if taken(c)}
                <span class="ta-chip" data-dir="up"><Icon name="check" size={12} stroke={2.4} />Di jurnal</span>
              {:else}
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={taking === c.id}
                  aria-label="Saya ambil {friendlyName(c.tvSymbol)} {sideName(c.side)}: catat di jurnal di level call ini"
                  onclick={() => take(c)}>Saya ambil</button
                >
              {/if}
            </div>
          {:else}
            {@const t = row.t}
            {@render who(t.tvSymbol, t.symbol, t.side, () => ws.setSymbol(t.tvSymbol), `${sinceText(t.openedAt)} · masuk ${priceText(t.entry)} · trade jurnal${t.mood ? `, ${MOOD_LABEL[t.mood].toLowerCase()}` : ''}`)}
            <LevelTrack level={t} now={prices[t.symbol]?.price ?? null} label="{friendlyName(t.tvSymbol)} {sideName(t.side)}" />
            <div class="ta-run-act"><button type="button" class="btn btn-ghost btn-sm" onclick={() => ws.setDock('journal')}>Buka jurnal</button></div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if note}<p role="alert" class="text-sm text-error">{note}</p>{/if}
    <div class="ta-pane-foot">
      <span class="text-sm ta-muted">{rows.length > SHOWN ? `${rows.length - SHOWN} lainnya di Pantau` : 'Notifikasi dan trade dikelola di Pantau'}</span>
      <span class="flex gap-1">
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => ws.setDock('alerts')}>Alert</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => ws.setDock('journal')}>Jurnal</button>
      </span>
    </div>
  {/if}
</section>
