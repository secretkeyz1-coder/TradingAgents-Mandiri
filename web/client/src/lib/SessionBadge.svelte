<script lang="ts">
  // Whether the symbol's market is in its regular hours, and when that changes, in WIB
  // (sessions.ts): a trader wondering why a price stands still sees the market is closed.
  // Refreshed every 30 seconds; nothing shows for a market whose hours are not known.
  import { sessionOf } from './sessions';

  let { tv }: { tv: string } = $props();

  let now = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(timer);
  });
  const session = $derived(sessionOf(tv, now));
</script>

{#if session}
  <span class="badge badge-xs badge-ghost gap-1 whitespace-nowrap" title="Jam bursa reguler; hari libur bursa tidak dihitung">
    <span class="status status-xs {session.open ? 'status-success' : 'status-neutral'}" aria-hidden="true"></span>
    {session.text}
  </span>
{/if}
