<script lang="ts">
  // A running call or trade between its stop (left) and its target (right), with where the price is now: the same
  // track as Pantau → Jurnal (marks.ts levelTrack, ta-track in app.css), so a trade reads alike on both screens.
  import { levelTrack } from '../../marks';
  import { priceText } from './calls';

  let { level, now, label }: { level: { side: string; entry: number; stopLoss: number; takeProfit: number }; now: number | null; label: string } = $props();

  const tr = $derived(levelTrack(level, now));
</script>

<div
  class="ta-track"
  role="img"
  aria-label="{label}: {tr.now != null
    ? `harga sekarang ${priceText(tr.now)}, ${Math.round(tr.share * 100)} persen jalan menuju ${tr.toward}`
    : 'harga sekarang belum termuat'}; SL {priceText(level.stopLoss)}, masuk {priceText(level.entry)}, TP {priceText(level.takeProfit)}"
>
  <span class="ta-track-sl" style="width: {tr.sl}%"></span>
  <span class="ta-track-tp" style="width: {100 - tr.sl}%"></span>
  <span class="ta-track-entry" style="left: {tr.sl}%"></span>
  {#if tr.now != null}
    <span class="ta-track-now" style="left: {tr.at}%"></span>
    <span class="ta-track-now-label" style="left: {Math.min(85, Math.max(15, tr.at))}%">{priceText(tr.now)}</span>
  {/if}
  <span class="ta-track-label ta-down" style="left: 0">SL {priceText(level.stopLoss)}</span>
  <span class="ta-track-label ta-up" style="right: 0">TP {priceText(level.takeProfit)}</span>
</div>
