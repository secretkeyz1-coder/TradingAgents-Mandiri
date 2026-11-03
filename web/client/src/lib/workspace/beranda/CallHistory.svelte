<script lang="ts">
  // Riwayat call (ADR 0021), Beranda's view of every call of the member's notifications. Filtered on the server
  // (GET /alerts/calls) by result, asset, indicator and, from "Sejak kamu terakhir buka", by arrival, so a filter's
  // count and its list always agree; grouped by the WIB day the calls came in, each day's heading with the totals of
  // the whole day; and loaded 50 at a time behind a cursor, so calls arriving on top never shift what is shown. The
  // assets and indicators carry their R for the period, so the breakdown Beranda used to table is the filter itself.
  import { api, INTERVALS, type CallOutcome, type CallPage, type Interval, type SignalCall, type SignalHistory } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { dayName, monogram, wibClock, wibDate } from '../../marks';
  import { watch } from '../../stores/watch.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { assetCode } from '../../tv';
  import Icon from '../Icon.svelte';
  import Beads from './Beads.svelte';
  import { agoText, indicatorText, outcomeOf, priceText, resultOf, rText, rTone, sideName } from './calls';

  const PERIODS = [
    { days: 7, label: '7 hari' },
    { days: 30, label: '30 hari' },
    { days: 90, label: '90 hari' },
    { days: 365, label: '1 tahun' },
  ];
  const RESULTS: { key: CallOutcome | 'all'; label: string }[] = [
    { key: 'all', label: 'Semua' },
    { key: 'open', label: 'Berjalan' },
    { key: 'win', label: 'Kena TP' },
    { key: 'loss', label: 'Kena SL' },
    { key: 'other', label: 'Diganti atau keluar' },
  ];
  const PAGE = 50;

  let days = $state(30);
  let status = $state<CallOutcome | 'all'>('all');
  /** An indicator with its timeframe, `scalper|15m`; null for all. */
  let indicator = $state<string | null>(null);
  const symbol = $derived(ws.calls?.symbol ?? null);
  const since = $derived(ws.calls?.since ?? null);

  let facets = $state<SignalHistory | null>(null);
  let page = $state<CallPage | null>(null);
  let calls = $state<SignalCall[]>([]);
  let next = $state<string | null>(null);
  let error = $state('');
  let loading = $state(false);
  let loadingMore = $state(false);

  // The period's breakdown by asset and indicator, for the filters beside the list.
  $effect(() => {
    const wanted = days;
    api
      .alertHistory(wanted)
      .then((h) => {
        if (wanted === days) facets = h;
      })
      .catch(() => {});
  });

  const query = $derived({
    days,
    status,
    symbol: symbol ?? undefined,
    indicator: indicator?.split('|')[0],
    timeframe: indicator?.split('|')[1],
    since: since ?? undefined,
    limit: PAGE,
  });
  // A page answers the filters it was asked for; one that comes back after the filters changed is dropped.
  let asked = 0;
  function load() {
    const n = ++asked;
    loading = true;
    error = '';
    api
      .alertCalls(query)
      .then((p) => {
        if (n !== asked) return;
        page = p;
        calls = p.calls;
        next = p.next;
      })
      .catch((e) => {
        if (n === asked) error = (e as Error).message;
      })
      .finally(() => {
        if (n === asked) loading = false;
      });
  }
  $effect(() => {
    void query;
    load();
  });
  async function more() {
    if (!next) return;
    const n = asked;
    loadingMore = true;
    try {
      const p = await api.alertCalls({ ...query, before: next });
      if (n !== asked) return;
      calls = [...calls, ...p.calls];
      next = p.next;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loadingMore = false;
    }
  }

  const names = $derived(facets?.scriptNames ?? {});
  /** The calls by the WIB day they came in; each heading counts the whole day in this filter, whatever page it is on. */
  const groups = $derived.by(() => {
    const totals = new Map((page?.days ?? []).map((d) => [d.day, d]));
    const out: { day: string; calls: SignalCall[] }[] = [];
    for (const c of calls) {
      const day = wibDate(c.at);
      if (out.at(-1)?.day === day) out.at(-1)!.calls.push(c);
      else out.push({ day, calls: [c] });
    }
    return out.map((g) => ({ ...g, total: totals.get(g.day) }));
  });
  const filtered = $derived(status !== 'all' || !!symbol || !!indicator || !!since);
  const assetName = (s: string) => {
    const row = facets?.bySymbol.find((b) => b.symbol === s);
    return row ? friendlyName(row.tvSymbol) : assetCode(s);
  };
  const statusText = $derived.by(() => {
    if (!page) return 'Memuat…';
    const scope = [symbol && assetName(symbol), indicator && indicatorText(indicator.split('|')[0], indicator.split('|')[1], names), since && `sejak ${agoText(since)} ${wibClock(since)}`]
      .filter(Boolean)
      .join(', ');
    return `Menampilkan ${calls.length} dari ${page.total} call dalam ${days === 365 ? '1 tahun' : `${days} hari`}${scope ? ` (${scope})` : ''}`;
  });

  function clear() {
    status = 'all';
    indicator = null;
    ws.filterCalls({ symbol: null, since: null });
  }
  /** A call's asset on the Sinyal chart, at the call's timeframe. */
  function openAsset(c: SignalCall) {
    ws.setChartView('ai');
    if ((INTERVALS as readonly string[]).includes(c.timeframe)) ws.setTimeframe(c.timeframe as Interval);
    ws.setSymbol(c.tvSymbol);
  }
  const daySum = (t: CallPage['days'][number]) =>
    [`${t.total} call`, t.win && `${t.win} kena TP`, t.loss && `${t.loss} kena SL`, t.open && `${t.open} berjalan`, t.win + t.loss ? rText(t.r) : null].filter(Boolean).join(' · ');
</script>

{#snippet facet(label: string, n: number, r: number, on: boolean, pick: () => void)}
  <li>
    <button type="button" class="ta-facet" aria-pressed={on} onclick={pick}>
      <span class="truncate">{label}</span>
      <span class="ta-facet-n">{n}</span>
      <span class="ta-facet-r {rTone(r)}">{rText(r)}</span>
    </button>
  </li>
{/snippet}

<div class="h-full overflow-auto bg-base-200">
  <div class="ta-calls">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-col items-start gap-1">
        <button type="button" class="btn btn-ghost btn-sm -ml-3" onclick={() => ws.closeCalls()}><Icon name="left" size={16} />Beranda</button>
        <h1 class="ta-title">Riwayat call</h1>
        <p class="text-sm ta-muted">Tiap sinyal dari notifikasimu dan hasilnya, dinilai dari TP dan SL-nya. Waktu dalam WIB.</p>
      </div>
      <div class="join" role="group" aria-label="Periode">
        {#each PERIODS as p (p.days)}
          <button type="button" class="btn btn-sm join-item" class:btn-active={days === p.days} aria-pressed={days === p.days} onclick={() => (days = p.days)}>{p.label}</button>
        {/each}
      </div>
    </header>

    <aside class="flex flex-col gap-4 max-lg:hidden" aria-label="Saring menurut aset dan indikator">
      <section class="ta-card p-2" aria-labelledby="f-asset">
        <h2 id="f-asset" class="ta-group-label px-3 pt-2">Aset<span>R</span></h2>
        <ul>
          {#if facets}
            {@render facet('Semua aset', facets.summary.total, facets.summary.r, !symbol, () => ws.filterCalls({ symbol: null }))}
            {#each facets.bySymbol as a (a.symbol)}
              {@render facet(friendlyName(a.tvSymbol), a.total, a.r, symbol === a.symbol, () => ws.filterCalls({ symbol: a.symbol }))}
            {/each}
          {/if}
        </ul>
      </section>
      <section class="ta-card p-2" aria-labelledby="f-ind">
        <h2 id="f-ind" class="ta-group-label px-3 pt-2">Indikator<span>R</span></h2>
        <ul>
          {#if facets}
            {@render facet('Semua indikator', facets.summary.total, facets.summary.r, !indicator, () => (indicator = null))}
            {#each facets.byIndicator as g (g.indicator + g.timeframe)}
              {@const key = `${g.indicator}|${g.timeframe}`}
              {@render facet(indicatorText(g.indicator, g.timeframe, names), g.total, g.r, indicator === key, () => (indicator = key))}
            {/each}
          {/if}
        </ul>
      </section>
      <p class="px-1 text-xs ta-muted">R per aset dan indikator: call yang kena TP atau SL dalam periode ini, sebelum biaya.</p>
    </aside>

    <section class="flex min-w-0 flex-col gap-3" aria-labelledby="calls-title">
      <h2 id="calls-title" class="sr-only">Daftar call</h2>
      {#if facets}
        <div class="grid grid-cols-2 gap-2 lg:hidden">
          <select class="select select-sm w-full" aria-label="Aset" value={symbol ?? ''} onchange={(e) => ws.filterCalls({ symbol: e.currentTarget.value || null })}>
            <option value="">Semua aset</option>
            {#each facets.bySymbol as a (a.symbol)}<option value={a.symbol}>{friendlyName(a.tvSymbol)} ({a.total})</option>{/each}
          </select>
          <select class="select select-sm w-full" aria-label="Indikator" value={indicator ?? ''} onchange={(e) => (indicator = e.currentTarget.value || null)}>
            <option value="">Semua indikator</option>
            {#each facets.byIndicator as g (g.indicator + g.timeframe)}<option value="{g.indicator}|{g.timeframe}">{indicatorText(g.indicator, g.timeframe, names)} ({g.total})</option>{/each}
          </select>
        </div>
      {/if}
      <div class="flex flex-wrap gap-2" role="group" aria-label="Saring menurut hasil">
        {#each RESULTS as r (r.key)}
          <button type="button" class="ta-filter" aria-pressed={status === r.key} onclick={() => (status = r.key)}>{r.label}{#if page}<b>{page.counts[r.key]}</b>{/if}</button>
        {/each}
      </div>
      {#if since}
        <span class="ta-chip w-fit" data-size="lg">
          Sejak {agoText(since)}, {wibClock(since)}
          <button type="button" class="btn btn-ghost btn-xs btn-circle -mr-2" aria-label="Hapus saringan sejak kunjungan terakhir" onclick={() => ws.filterCalls({ since: null })}><Icon name="x" size={14} /></button>
        </span>
      {/if}
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p role="status" class="text-sm ta-muted">{statusText}</p>
        <span class="text-xs ta-muted">Terbaru dulu</span>
      </div>

      {#if error}
        <div role="alert" class="flex flex-wrap items-center gap-3 text-sm">
          <span class="text-error">{error}</span>
          <button type="button" class="btn btn-sm" onclick={load}>Coba lagi</button>
        </div>
      {/if}

      {#if !page}
        {#if !error}<div class="ta-card h-64 animate-pulse" aria-label="Memuat"></div>{/if}
      {:else if !page.total}
        <div class="ta-card flex flex-col items-start gap-3 p-5">
          <p>{filtered ? 'Tidak ada call dengan saringan ini dalam periode ini.' : 'Belum ada call dalam periode ini. Tiap sinyal dari notifikasimu tercatat di sini bersama hasilnya.'}</p>
          {#if filtered}<button type="button" class="btn btn-sm" onclick={clear}>Hapus saringan</button>{/if}
        </div>
      {:else}
        <div class="flex flex-col gap-3" class:opacity-60={loading}>
          {#each groups as g (g.day)}
            <section class="ta-card overflow-hidden" aria-label={dayName(g.day)}>
              <div class="ta-cday">
                <span class="ta-cday-name">{dayName(g.day)}</span>
                <span class="ta-cday-sum">{g.total ? daySum(g.total) : `${g.calls.length} call`}</span>
                <Beads outcomes={g.calls.map(outcomeOf)} max={60} />
              </div>
              {#each g.calls as c (c.id)}
                {@const res = resultOf(c)}
                <div class="ta-call">
                  <span class="ta-call-time">{wibClock(c.at)}</span>
                  <span class="flex min-w-0 items-center gap-2.5">
                    <span class="ta-mono" data-size="sm" data-watched={watch.has(c.symbol) || undefined}>{monogram(c.tvSymbol)}</span>
                    <button type="button" class="link link-hover truncate font-semibold" onclick={() => openAsset(c)}>{friendlyName(c.tvSymbol)}</button>
                    <span class="ta-chip" data-dir={c.side === 'SELL' ? 'down' : 'up'}><Icon name={c.side === 'SELL' ? 'arrowDown' : 'arrowUp'} size={12} stroke={2.4} />{sideName(c.side)}</span>
                  </span>
                  <span class="ta-call-meta">
                    <span class="truncate" title={indicatorText(c.indicator, c.timeframe, names)}>{indicatorText(c.indicator, c.timeframe, names)}</span>
                    <span class="ta-call-levels">E {priceText(c.entry)} · SL {priceText(c.stopLoss)} · TP {priceText(c.takeProfit)}</span>
                  </span>
                  <span class="ta-call-result">
                    <span class="ta-chip" data-dir={res.dir}><Icon name={res.icon} size={12} stroke={2.4} />{res.label}</span>
                    <span class="w-14 text-right text-sm font-semibold tabular-nums {rTone(c.r)}">{c.r == null ? '' : rText(c.r)}</span>
                  </span>
                </div>
              {/each}
            </section>
          {/each}
        </div>
        <div class="flex flex-col items-center gap-2 py-2">
          {#if next}
            <button type="button" class="btn" disabled={loadingMore} onclick={more}>
              {#if loadingMore}<span class="loading loading-spinner loading-sm"></span>{/if}Tampilkan {Math.min(PAGE, page.total - calls.length)} lagi
            </button>
          {/if}
          <span class="text-xs ta-muted">{next ? `${calls.length} dari ${page.total} call sudah tampil` : `Semua ${page.total} call sudah tampil`}</span>
        </div>
      {/if}
    </section>
  </div>
</div>
