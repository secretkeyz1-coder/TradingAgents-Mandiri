<script lang="ts">
  // One value per day as columns, oldest left (admin activity pages). A readout above names
  // the day under the pointer, or the one the arrow keys picked once the chart has focus, and
  // the newest day otherwise; the table under it has every day, so nothing hides in a hover.
  type Day = { day: string; value: number; text: string };
  let { days, label }: { days: Day[]; label: string } = $props();

  let picked = $state<number | null>(null);
  const index = $derived(picked ?? days.length - 1);
  const shown = $derived(days[index]);
  const peak = $derived(Math.max(1, ...days.map((d) => d.value)));
  const date = (day: string, long = false) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('id-ID', long ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function key(e: KeyboardEvent) {
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'Home' ? -days.length : e.key === 'End' ? days.length : 0;
    if (!step) return;
    e.preventDefault();
    picked = Math.min(days.length - 1, Math.max(0, index + step));
  }
</script>

{#if shown}
  <div class="flex flex-col gap-2">
    <p class="min-h-5 text-sm" aria-hidden="true"><strong class="tabular-nums">{shown.text}</strong> <span class="text-base-content/70">· {date(shown.day, true)}</span></p>
    <!-- A slider over the days: the arrow keys move it, and a screen reader hears the day's value. -->
    <div
      class="flex h-32 items-end gap-0.5 border-b border-base-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
      role="slider"
      tabindex="0"
      aria-label="{label} per hari"
      aria-valuemin={0}
      aria-valuemax={days.length - 1}
      aria-valuenow={index}
      aria-valuetext="{shown.text}, {date(shown.day, true)}"
      onkeydown={key}
      onpointerleave={() => (picked = null)}
      onblur={() => (picked = null)}
    >
      {#each days as d, i (d.day)}
        <div class="flex h-full min-w-0 flex-1 items-end justify-center" role="presentation" onpointerenter={() => (picked = i)}>
          <div
            class="w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity"
            class:opacity-50={picked !== null && i !== index}
            style:height="{(d.value / peak) * 100}%"
          ></div>
        </div>
      {/each}
    </div>
    <div class="flex justify-between text-xs text-base-content/70" aria-hidden="true">
      <span>{date(days[0].day)}</span>
      {#if days.length > 2}<span>{date(days[Math.floor(days.length / 2)].day)}</span>{/if}
      <span>{date(days[days.length - 1].day)}</span>
    </div>
    <details class="text-sm">
      <summary class="cursor-pointer text-xs text-base-content/70">Tabel per hari</summary>
      <div class="mt-2 max-h-64 overflow-auto">
        <table class="table table-xs">
          <thead><tr><th>Tanggal</th><th class="text-right">{label}</th></tr></thead>
          <tbody>
            {#each [...days].reverse() as d (d.day)}
              <tr><td>{date(d.day, true)}</td><td class="text-right tabular-nums">{d.text}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  </div>
{/if}
