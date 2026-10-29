<script lang="ts">
  // The open analysis's activity, newest first; only an error carries colour.
  import { ws } from '../../stores/workspace.svelte';

  const KIND: Record<string, string> = {
    Agent: 'Agen',
    Tool: 'Alat',
    Data: 'Data',
    Report: 'Laporan',
    Error: 'Galat',
    System: 'Sistem',
    User: 'Pengguna',
  };
  const entries = $derived(ws.run ? [...ws.run.log].reverse() : []);
</script>

{#if !ws.run}
  <p class="p-6 text-sm text-base-content/70">Log muncul di sini saat sebuah analisa dibuka atau sedang berjalan.</p>
{:else}
  <ul class="divide-y divide-base-300">
    {#each entries as entry (entry.seq)}
      <li class="flex gap-3 px-3 py-2 text-sm">
        <span class="badge badge-sm w-16 shrink-0 justify-center {entry.kind === 'Error' ? 'badge-error badge-soft' : 'badge-ghost'}">
          {KIND[entry.kind] ?? entry.kind}
        </span>
        <p class="line-clamp-4 min-w-0 whitespace-pre-wrap break-words text-base-content/80">{entry.text}</p>
      </li>
    {:else}
      <li class="px-3 py-6 text-sm text-base-content/70">Belum ada aktivitas.</li>
    {/each}
  </ul>
{/if}
