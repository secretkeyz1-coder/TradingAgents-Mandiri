<script lang="ts">
  // One line on how an engine has done on a timeframe, from the signal ledger's live record
  // (stores/record.svelte.ts): the share of signals that paid after costs, the mean net R, and how
  // many signals that rests on, or that there are still too few to judge. Nothing shows for an
  // engine the ledger does not follow, such as a script. A menu explains the record once at its
  // foot; where there is no such note (the plan card), `showScope` names the symbols in the line.
  import { TIMEFRAME_LABELS } from '../alertLabels';
  import { toneOf } from '../beginner/plain';
  import { ENOUGH, ledgerName, record } from '../stores/record.svelte';

  let {
    source,
    timeframe,
    symbol = null,
    lead = '',
    withTimeframe = true,
    exact = false,
    showScope = false,
  }: {
    /** The ledger's engine: pob, scalper, fib, donchian. */
    source: string;
    timeframe: string;
    /** Engine spelling of the symbol in focus: its own record when the ledger follows it. */
    symbol?: string | null;
    /** Words before the timeframe ("Rekam jejak"). */
    lead?: string;
    withTimeframe?: boolean;
    /** Only this timeframe's record, never the engine's only tracked one in its place. */
    exact?: boolean;
    /** Name the symbols a shared record covers. */
    showScope?: boolean;
  } = $props();

  $effect(() => {
    record.load();
  });
  const found = $derived(record.of(source, timeframe, symbol, exact));
  const where = $derived(found?.scope ? ` di ${ledgerName(found.scope)}` : showScope ? ` di ${record.covered}` : '');
  const head = $derived(
    [lead, withTimeframe && found ? (TIMEFRAME_LABELS[found.timeframe as keyof typeof TIMEFRAME_LABELS] ?? found.timeframe) : ''].filter(Boolean).join(' '),
  );
  const r = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R`;
</script>

{#if found}
  {@const brief = found.brief}
  <span class="text-xs text-base-content/70" title="Sinyal live {record.value?.days} hari terakhir di {found.scope ? ledgerName(found.scope) : record.covered}, setelah biaya">
    {#if head}{head}:{/if}
    {#if brief.closed >= ENOUGH}
      <span class="tabular-nums">{Math.round((brief.winRate ?? 0) * 100)}% untung bersih</span> · rata-rata
      <span class="font-medium tabular-nums {toneOf(brief.expectancy ?? 0)}">{r(brief.expectancy ?? 0)}</span> ·
      <span class="tabular-nums">{brief.closed} sinyal</span>{where}
    {:else if brief.closed}
      baru {brief.closed} sinyal selesai{where}, belum cukup untuk dinilai
    {:else}
      belum ada sinyal yang selesai{where}
    {/if}
  </span>
{/if}
