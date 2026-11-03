<script lang="ts">
  // "Sinyalmu" (ADR 0021): how the member's signal calls did over 7 or 30 days, in one figure (R before costs, from
  // the calls that hit a target or a stop) with what it counts, the curve by day, and the newest calls by WIB day.
  // Every call, filtered and a page at a time, is one click away in Riwayat call.
  import type { SignalHistory } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { dayName, monogram, wibClock, wibDate } from '../../marks';
  import { ws } from '../../stores/workspace.svelte';
  import Icon from '../Icon.svelte';
  import ResultCurve from '../ResultCurve.svelte';
  import { indicatorText, resultOf, rText, rTone, sideName } from './calls';

  let {
    history,
    error,
    days,
    onDays,
    onRetry,
  }: { history: SignalHistory | null; error: string; days: number; onDays: (days: number) => void; onRetry: () => void } = $props();

  const PERIODS = [
    { days: 7, label: '7 hari' },
    { days: 30, label: '30 hari' },
  ];
  const s = $derived(history?.summary);
  const period = $derived(`${days} hari`);
  const names = $derived(history?.scriptNames ?? {});
  /** The newest calls by the WIB day they came in, newest day first. */
  const groups = $derived.by(() => {
    const out: { day: string; calls: SignalHistory['calls'] }[] = [];
    for (const c of history?.calls ?? []) {
      const day = wibDate(c.at);
      if (out.at(-1)?.day === day) out.at(-1)!.calls.push(c);
      else out.push({ day, calls: [c] });
    }
    return out;
  });
</script>

<section class="ta-card ta-pane" aria-labelledby="mine-title">
  <div class="ta-pane-head">
    <h2 id="mine-title" class="font-semibold">Sinyalmu</h2>
    <div class="join" role="group" aria-label="Periode">
      {#each PERIODS as p (p.days)}
        <button type="button" class="btn btn-sm join-item" class:btn-active={days === p.days} aria-pressed={days === p.days} onclick={() => onDays(p.days)}>{p.label}</button>
      {/each}
    </div>
  </div>

  {#if error}
    <div role="alert" class="flex flex-wrap items-center gap-3 text-sm">
      <span class="text-error">{error}</span>
      <button type="button" class="btn btn-sm" onclick={onRetry}>Coba lagi</button>
    </div>
  {:else if !history || !s}
    <div class="h-24 animate-pulse rounded-field bg-base-200" aria-label="Memuat"></div>
  {:else if !s.total}
    <p class="max-w-[60ch] ta-muted">
      {s.alerts ? `${s.alerts} notifikasi aktif, belum ada call dalam ${period} terakhir.` : `Belum ada call dalam ${period} terakhir.`}
      Tiap sinyal baru dari notifikasimu dan hasilnya (TP atau SL) tercatat di sini.
    </p>
  {:else}
    {@const settled = s.win + s.loss}
    {@const others = s.exit + s.expired + s.replaced + s.stopped}
    <div class="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div class="flex flex-col gap-1">
        <span class="text-4xl font-extrabold tracking-tight tabular-nums {rTone(s.r)}">{rText(s.r)}</span>
        <span class="text-xs ta-muted">sebelum biaya, dari {settled} call yang kena TP atau SL dalam {period}</span>
      </div>
      <dl class="flex flex-wrap gap-x-8 gap-y-2">
        <div class="flex flex-col-reverse"><dt class="text-xs ta-muted">kena TP dari yang selesai</dt><dd class="text-xl font-bold tabular-nums">{s.winRate == null ? '–' : `${Math.round(s.winRate * 100)}%`}</dd></div>
        <div class="flex flex-col-reverse"><dt class="text-xs ta-muted">call</dt><dd class="text-xl font-bold tabular-nums">{s.total}</dd></div>
        <div class="flex flex-col-reverse"><dt class="text-xs ta-muted">kena TP · kena SL</dt><dd class="text-xl font-bold tabular-nums">{s.win} · {s.loss}</dd></div>
      </dl>
    </div>
    {#if others}
      <p class="text-xs ta-muted">Juga {others} call diganti, keluar, atau tidak dipantau lagi: dihitung sebagai call, tidak masuk R karena harga keluarnya tidak tercatat.</p>
    {/if}
    {#if history.daily.some((d) => d.win + d.loss > 0)}
      <div class="flex flex-col gap-1">
        <h3 class="text-sm font-semibold">R kumulatif per hari</h3>
        <ResultCurve days={history.daily} />
      </div>
    {/if}
    <div class="flex flex-col">
      {#each groups as g (g.day)}
        <h3 class="px-2 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase ta-muted">{dayName(g.day)}</h3>
        <ul>
          {#each g.calls as c (c.id)}
            {@const res = resultOf(c)}
            <li class="ta-recent">
              <span class="text-sm tabular-nums ta-muted">{wibClock(c.at)}</span>
              <span class="ta-mono" data-size="sm">{monogram(c.tvSymbol)}</span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold">{friendlyName(c.tvSymbol)} · {sideName(c.side)}</span>
                <span class="block truncate text-xs ta-muted">{indicatorText(c.indicator, c.timeframe, names)}</span>
              </span>
              <span class="flex items-center gap-2">
                <span class="ta-chip" data-dir={res.dir} title={res.label}><Icon name={res.icon} size={12} stroke={2.4} />{res.short}</span>
                {#if c.r != null}<span class="w-12 text-right text-sm font-semibold tabular-nums {rTone(c.r)}">{rText(c.r)}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      {/each}
    </div>
    <div class="ta-pane-foot">
      <p class="max-w-[56ch] text-xs ta-muted">R adalah risiko satu trade, jarak entry ke SL: kena TP memberi jarak TP dibagi jarak SL, kena SL −1R.</p>
      <button type="button" class="btn btn-sm" onclick={() => ws.openCalls()}>Lihat semua {s.total} call<Icon name="right" size={16} /></button>
    </div>
  {/if}
</section>
