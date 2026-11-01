<script lang="ts">
  // Active minutes in each hour of the week, WIB (admin activity pages): habits at a glance.
  // One hue, more color for more minutes: four steps of the accent over the card, so the
  // order reads the same in dark mode, and an hour nobody used stays the card's gray. It is a
  // real table, each cell carrying its value for screen readers, with one tab stop (arrow keys
  // move between hours); a readout names the hour under the pointer or in focus, and the
  // busiest hours are listed under it.
  import type { ActivityHeat } from '../api';

  let { cells, unit }: { cells: ActivityHeat[]; unit: (minutes: number) => string } = $props();

  const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  const STEPS = [18, 42, 68, 100];

  const byHour = $derived(new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.minutes])));
  const peak = $derived(Math.max(0, ...cells.map((c) => c.minutes)));
  const busiest = $derived([...cells].filter((c) => c.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, 3));
  let pointed = $state<{ dow: number; hour: number } | null>(null);
  let focused = $state<{ dow: number; hour: number } | null>(null);
  const shown = $derived(pointed ?? focused ?? (busiest[0] ? { dow: busiest[0].dow, hour: busiest[0].hour } : null));
  /** The one cell the Tab key lands on. */
  const stop = $derived(focused ?? (busiest[0] ? { dow: busiest[0].dow, hour: busiest[0].hour } : { dow: 1, hour: 0 }));
  let table: HTMLTableElement | undefined = $state();

  const minutesAt = (dow: number, hour: number) => byHour.get(`${dow}-${hour}`) ?? 0;
  const fill = (m: number) => {
    if (m <= 0 || !peak) return 'var(--color-base-200)';
    const step = STEPS[Math.min(STEPS.length, Math.max(1, Math.ceil((m / peak) * STEPS.length))) - 1];
    return `color-mix(in oklab, var(--color-accent) ${step}%, var(--color-base-100))`;
  };
  const two = (h: number) => String(h).padStart(2, '0');
  const slot = (dow: number, hour: number) => `${DAYS[dow - 1]} ${two(hour)}.00–${two((hour + 1) % 24)}.00`;

  function key(e: KeyboardEvent) {
    const move: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const step = move[e.key];
    if (!step) return;
    e.preventDefault();
    const next = { dow: Math.min(7, Math.max(1, stop.dow + step[0])), hour: Math.min(23, Math.max(0, stop.hour + step[1])) };
    focused = next;
    table?.querySelector<HTMLElement>(`[data-cell="${next.dow}-${next.hour}"]`)?.focus();
  }
</script>

<div class="flex flex-col gap-2">
  <p class="min-h-5 text-sm" aria-live="polite">
    {#if shown}
      <strong class="tabular-nums">{unit(minutesAt(shown.dow, shown.hour))}</strong> <span class="text-base-content/70">· {slot(shown.dow, shown.hour)} WIB</span>
    {:else}
      <span class="text-base-content/70">Belum ada menit aktif di periode ini.</span>
    {/if}
  </p>
  <!-- Relative, so the cells' screen-reader text (absolutely placed) scrolls inside it rather than widening the page. -->
  <div class="relative overflow-x-auto">
    <table
      bind:this={table}
      class="w-full min-w-[26rem] table-fixed border-separate border-spacing-0.5"
      role="grid"
      aria-label="Menit aktif per jam dalam seminggu, WIB; panah memilih jam"
      onkeydown={key}
      onpointerleave={() => (pointed = null)}
    >
      <thead>
        <tr>
          <th class="w-10"><span class="sr-only">Hari</span></th>
          {#each HOURS as h (h)}
            <th class="text-center text-xs font-normal text-base-content/70">
              {#if h % 3 === 0}{h}{:else}<span class="sr-only">{h}</span>{/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each DAYS as name, d (name)}
          <tr>
            <th scope="row" class="pr-1 text-left text-xs font-normal text-base-content/70"><abbr title={name} class="no-underline">{SHORT[d]}</abbr></th>
            {#each HOURS as h (h)}
              {@const m = minutesAt(d + 1, h)}
              <td
                data-cell="{d + 1}-{h}"
                tabindex={stop.dow === d + 1 && stop.hour === h ? 0 : -1}
                class="h-5 rounded-[3px] p-0 outline-offset-1 focus-visible:outline-2 focus-visible:outline-accent"
                style:background={fill(m)}
                onpointerenter={() => (pointed = { dow: d + 1, hour: h })}
                onfocus={() => (focused = { dow: d + 1, hour: h })}
              >
                <span class="sr-only">{slot(d + 1, h)}: {unit(m)}</span>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-base-content/70">
    <span class="flex items-center gap-1.5">
      <span class="size-3 rounded-[3px]" style:background="var(--color-base-200)"></span> Tidak dipakai
      <span class="ml-2">Sedikit</span>
      {#each STEPS as s (s)}<span class="size-3 rounded-[3px]" style:background="color-mix(in oklab, var(--color-accent) {s}%, var(--color-base-100))"></span>{/each}
      <span>Banyak</span>
    </span>
    {#if busiest.length}
      <span>Paling ramai: {busiest.map((c) => `${slot(c.dow, c.hour)} (${unit(c.minutes)})`).join('; ')}</span>
    {/if}
  </div>
</div>
