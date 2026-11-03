<script lang="ts">
  // The period's closed trades in the order they closed (Pantau → Jurnal): each one's result in R as a bar from
  // zero, green above and red below with the sign in the axis and the total, and the running total as a line that
  // ends on its value. Drawn at the width it is given (bind:clientWidth), so the labels stay at 12px in any column.
  import { formatR } from '../../format';
  import { signedR } from '../../journalLabels';

  let { trades }: { trades: { r: number; day: string }[] } = $props();

  const H = 200;
  const PAD = { top: 18, right: 64, bottom: 26, left: 40 };
  let width = $state(600);

  const totals = $derived(trades.reduce<number[]>((acc, t) => [...acc, (acc.at(-1) ?? 0) + t.r], []));
  const total = $derived(totals.at(-1) ?? 0);
  // At least half an R either side of zero, so a trade closed near entry draws a small bar, not a full one.
  const hi = $derived(Math.max(0.5, ...trades.map((t) => t.r), ...totals));
  const lo = $derived(Math.min(-0.5, ...trades.map((t) => t.r), ...totals));
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const step = $derived(Math.max(1, width - PAD.left - PAD.right) / Math.max(1, trades.length));
  const barW = $derived(Math.max(4, Math.min(36, step * 0.6)));
  const cx = (i: number) => PAD.left + step * i + step / 2;
  const line = $derived(totals.map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' '));
  const ticks = $derived([...new Set([Math.ceil(lo), 0, Math.floor(hi)])].filter((v) => v >= lo && v <= hi));
  const showDays = $derived(trades.length <= 10 && step >= 52);
</script>

<div class="w-full" bind:clientWidth={width}>
  <svg {width} height={H} viewBox="0 0 {width} {H}" role="img" aria-label="{trades.length} trade selesai, urut waktu; totalnya {signedR(total)}" class="block overflow-visible">
    {#each ticks as t (t)}
      <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} class={t === 0 ? 'stroke-base-content/40' : 'stroke-base-300'} stroke-dasharray={t === 0 ? '4 4' : undefined} />
      <text x={PAD.left - 8} y={y(t) + 4} text-anchor="end" class="fill-base-content/70 text-xs tabular-nums">{t === 0 ? '0R' : formatR(t, 0)}</text>
    {/each}
    {#each trades as t, i (i)}
      <rect x={cx(i) - barW / 2} y={t.r >= 0 ? y(t.r) : y(0)} width={barW} height={Math.max(2, Math.abs(y(t.r) - y(0)))} rx="3" class={t.r >= 0 ? 'fill-success/80' : 'fill-error/80'} />
      {#if showDays}<text x={cx(i)} y={H - 6} text-anchor="middle" class="fill-base-content/70 text-xs">{t.day}</text>{/if}
    {/each}
    {#if totals.length}
      <path d={line} fill="none" class="stroke-primary" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={cx(totals.length - 1)} cy={y(total)} r="5" class="fill-primary stroke-base-100" stroke-width="3" />
      <text x={cx(totals.length - 1) + 12} y={y(total) + 5} class="fill-base-content text-sm font-bold tabular-nums">{signedR(total)}</text>
    {/if}
  </svg>
</div>
