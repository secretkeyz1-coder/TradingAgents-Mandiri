<script lang="ts">
  // "Sejak kamu terakhir buka" (server analytics.ts /activity/since, ADR 0021). An active account gets dozens of calls
  // a night, so they are counted rather than listed: one sentence with where they stand now and the R of those
  // settled, then one row per asset, the busiest first, with a bead per call. An asset's row opens Riwayat call on
  // its calls since the visit, the link under them all of them. Price levels hit and analyses finished follow.
  import type { SinceVisit } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { callOf, monogram, wibClock, wibDate } from '../../marks';
  import { watch } from '../../stores/watch.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { assetCode } from '../../tv';
  import Icon from '../Icon.svelte';
  import Beads from './Beads.svelte';
  import { agoText, indicatorText, priceText, rText } from './calls';

  let { since, names }: { since: SinceVisit & { since: string }; names: Record<string, string> } = $props();

  /** Rows shown before "n aset lain": enough for a watchlist, few enough to read in a glance. */
  const ROWS = 5;
  const s = $derived(since.signals);
  const assets = $derived(since.byAsset.slice(0, ROWS));
  const hidden = $derived(since.byAsset.slice(ROWS).reduce((n, a) => n + a.total, 0));
  const settled = $derived(s.win + s.loss);
  /** The sentence's parts, those with a count only. */
  const parts = $derived(
    [
      { n: s.win, text: 'kena TP', tone: 'ta-up' },
      { n: s.loss, text: 'kena SL', tone: 'ta-down' },
      { n: s.open, text: 'masih berjalan', tone: '' },
      { n: s.other, text: 'diganti atau keluar', tone: '' },
    ].filter((p) => p.n > 0),
  );
  const quiet = $derived(!s.total && !since.hits.length && !since.analyses.length);

  /** When something happened, as a trader reads it: 04.12 today, kemarin 22.05, or the date. */
  function when(iso: string) {
    const day = wibDate(iso);
    const today = wibDate(new Date().toISOString());
    const yesterday = wibDate(new Date(Date.now() - 86_400_000).toISOString());
    return day === today ? `pukul ${wibClock(iso)}` : day === yesterday ? `kemarin ${wibClock(iso)}` : new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }
  const tallyText = (a: { win: number; loss: number; open: number }) =>
    [a.win && `${a.win} TP`, a.loss && `${a.loss} SL`, a.open && `${a.open} berjalan`].filter(Boolean).join(' · ') || 'belum ada hasil';
</script>

<section class="ta-card ta-pane" aria-labelledby="away-title">
  <div class="ta-pane-head">
    <h2 id="away-title" class="font-semibold">Sejak kamu terakhir buka</h2>
    <span class="text-sm ta-muted">{agoText(since.since)}, {wibClock(since.since)}</span>
  </div>

  {#if quiet}
    <p class="ta-muted">Belum ada sinyal, alert harga, atau analisa baru sejak itu.</p>
  {:else}
    {#if s.total}
      <p class="ta-say">
        <b>{s.total} sinyal baru</b>{#if parts.length}:{/if}
        {#each parts as p, i (p.text)}<b class={p.tone}>{p.n} {p.text}</b>{i < parts.length - 1 ? ', ' : '.'}{/each}
        {#if settled}Hasilnya <b class={s.r > 0 ? 'ta-up' : s.r < 0 ? 'ta-down' : ''}>{rText(s.r)}</b> sebelum biaya.{/if}
      </p>
      <ul class="flex flex-col" aria-label="Sinyal baru per aset">
        {#each assets as a (a.tvSymbol)}
          <li>
            <button type="button" class="ta-dg" onclick={() => ws.openCalls({ symbol: a.symbol, since: since.since })}>
              <span class="ta-mono" data-watched={watch.has(a.symbol) || undefined}>{monogram(a.tvSymbol)}</span>
              <span class="min-w-0">
                <span class="ta-row-title truncate">{friendlyName(a.tvSymbol)}</span>
                <span class="ta-row-sub truncate">{a.total} sinyal · {a.indicators.map((i) => indicatorText(i.indicator, i.timeframe, names)).join(', ')}</span>
              </span>
              <Beads outcomes={a.outcomes} />
              <span class="ta-dg-sum">{tallyText(a)}</span>
              <Icon name="right" size={16} class="ta-muted max-sm:hidden" />
            </button>
          </li>
        {/each}
      </ul>
      {#if hidden}<p class="text-sm ta-muted">Dan {hidden} sinyal di {since.byAsset.length - ROWS} aset lain.</p>{/if}
    {/if}

    {#if since.hits.length || since.analyses.length}
      <ul class="flex flex-col gap-1.5" aria-label="Alert harga dan analisa">
        {#each since.hits as h (h.id)}
          <li class="ta-ev">
            <span class="ta-ev-icon text-warning"><Icon name="target" size={16} /></span>
            <span class="min-w-0">
              <span class="block font-semibold text-pretty">{friendlyName(h.tvSymbol)} {h.direction === 'above' ? 'naik ke' : 'turun ke'} {priceText(h.price)}</span>
              <span class="block text-xs ta-muted">Alert harga kena {when(h.at)}</span>
            </span>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => ws.setSymbol(h.tvSymbol)}>Buka chart</button>
          </li>
        {/each}
        {#each since.analyses as a (a.id)}
          {@const call = callOf(a.rating)}
          <li class="ta-ev">
            <span class="ta-ev-icon text-info"><Icon name="ai" size={16} /></span>
            <span class="min-w-0">
              <span class="flex flex-wrap items-center gap-2"
                ><span class="font-semibold">Analisa {assetCode(a.ticker)} selesai</span>{#if a.rating}<span class="ta-chip" data-dir={call.dir}><Icon name={call.icon} size={12} stroke={2.4} />{call.label}</span>{/if}</span
              >
              <span class="block text-xs ta-muted">{when(a.at)}</span>
            </span>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => ws.openRun(a.id, {})}>Buka laporan</button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if s.total}
      <div class="ta-pane-foot">
        <span class="ta-legend" aria-hidden="true">
          <span><i class="ta-bead" data-o="win"></i>kena TP</span>
          <span><i class="ta-bead" data-o="loss"></i>kena SL</span>
          <span><i class="ta-bead" data-o="open"></i>berjalan</span>
          <span><i class="ta-bead" data-o="other"></i>diganti atau keluar</span>
        </span>
        <button type="button" class="btn btn-sm" onclick={() => ws.openCalls({ since: since.since })}>Lihat {s.total} sinyal di Riwayat call<Icon name="right" size={16} /></button>
      </div>
    {/if}
  {/if}
</section>
