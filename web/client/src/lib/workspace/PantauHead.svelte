<script lang="ts">
  // Pantau's head (PageScreen): the page's title and its three tabs as cards that carry their state, so the page
  // says what is going on before a tab is opened: how many assets the AI analyses and when it runs next, how many
  // alerts are on and signals still running, the trades open and the period's result. It also keeps the three
  // tabs' data fresh each minute while Pantau is open (stores/watch, alerts, journal).
  import { formatWhen } from '../format';
  import { signedR } from '../journalLabels';
  import { alerts } from '../stores/alerts.svelte';
  import { journal } from '../stores/journal.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws, type DockTab } from '../stores/workspace.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  $effect(() => {
    const load = () => {
      watch.load();
      alerts.load();
      journal.load();
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  const w = $derived(watch.value);
  const allowance = $derived(alerts.signals ?? alerts.levels);
  const running = $derived(alerts.signals?.items.filter((a) => a.last?.status === 'open').length ?? 0);
  const j = $derived(journal.value);

  type Card = { key: DockTab; label: string; icon: IconName; count: string; unit: string; state: string; live?: boolean };
  const cards = $derived<Card[]>([
    {
      key: 'watch',
      label: 'Pantauanku',
      icon: 'radar',
      count: w ? String(w.items.length) : '–',
      unit: 'aset',
      state: !w ? 'Memuat…' : w.items.length ? `Berikutnya ${formatWhen(w.schedule.next)}` : 'Belum ada aset',
    },
    {
      key: 'alerts',
      label: 'Alert',
      icon: 'bell',
      count: allowance ? String(allowance.used) : '–',
      unit: allowance ? `dari ${allowance.max}` : 'alert',
      state: !alerts.signals
        ? 'Memuat…'
        : running
          ? `${running} sinyal berjalan`
          : alerts.signals.items.length
            ? 'Tidak ada sinyal berjalan'
            : 'Belum ada alert sinyal',
      live: running > 0,
    },
    {
      key: 'journal',
      label: 'Jurnal',
      icon: 'book',
      count: j ? String(j.open) : '–',
      unit: 'berjalan',
      state: !j ? 'Memuat…' : j.summary.closed ? `${signedR(j.summary.totalR)} dalam ${j.days} hari` : 'Belum ada trade selesai',
    },
  ]);
</script>

<header class="flex flex-col gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
  <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
    <div class="min-w-0">
      <h1 id="page-title" class="ta-title">Pantau</h1>
      <p class="text-sm ta-muted max-md:hidden">Yang dijaga untukmu: analisa AI harian, notifikasi sinyal dan harga, dan trade yang sedang berjalan.</p>
    </div>
    <p class="flex items-center gap-1.5 text-xs ta-muted max-md:hidden"><Icon name="refresh" size={14} />Diperbarui tiap menit</p>
  </div>
  <nav class="ta-ptabs" aria-label="Bagian Pantau">
    {#each cards as c (c.key)}
      <button type="button" class="ta-ptab" aria-current={ws.dock === c.key ? 'page' : undefined} onclick={() => ws.setDock(c.key)}>
        <span class="ta-ptab-icon"><Icon name={c.icon} size={22} /></span>
        <span class="ta-ptab-name">{c.label}</span>
        <span class="ta-ptab-state">
          {#if c.live}<span class="status status-info status-xs shrink-0 motion-safe:animate-pulse" aria-hidden="true"></span>{/if}
          <span class="truncate">{c.state}</span>
        </span>
        <span class="ta-ptab-count">{c.count}<small>{c.unit}</small></span>
      </button>
    {/each}
  </nav>
</header>
