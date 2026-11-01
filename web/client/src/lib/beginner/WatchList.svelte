<script lang="ts">
  // Pantauanku: the assets the user follows (the server's watchlist, analysed by the AI
  // each trading day), each with the AI's latest word on it, then well-known assets to
  // start from. Picking one brings it into focus; `onpick` lets a phone show it.
  import type { Watchlist } from '../api';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { friendlyName, ratingLean, STARTERS, toneOf } from './plain';

  let { onpick }: { onpick?: () => void } = $props();

  const items = $derived(watch.value?.items ?? []);
  const starters = $derived(STARTERS.filter(([tv]) => !items.some((i) => i.tvSymbol === tv)));

  function open(tv: string) {
    ws.setSymbol(tv);
    onpick?.();
  }

  type Last = NonNullable<Watchlist['items'][number]['last']>;
  function lastRun(last: Last | null): string {
    if (!last) return 'Belum dianalisa';
    if (last.status === 'queued' || last.status === 'running') return 'Sedang dianalisa…';
    if (last.status !== 'completed') return 'Analisa terakhir gagal';
    return `Dianalisa ${new Date(`${last.tradeDate}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}`;
  }

  function search() {
    document.querySelector<HTMLInputElement>('[data-symbol-search]')?.focus();
  }
</script>

<nav class="flex flex-col gap-5" aria-label="Daftar aset">
  <section class="flex flex-col gap-2" aria-labelledby="watch-title">
    <div class="flex items-baseline justify-between gap-2 px-1">
      <h2 id="watch-title" class="text-sm font-semibold">Pantauanku</h2>
      {#if watch.value}<span class="text-xs tabular-nums text-base-content/70">{items.length} dari {watch.value.max}</span>{/if}
    </div>
    {#if !watch.value}
      <div class="flex flex-col gap-2" aria-busy="true">
        <div class="skeleton h-11 w-full"></div>
        <div class="skeleton h-11 w-full"></div>
      </div>
    {:else if items.length === 0}
      <p class="px-1 text-sm text-base-content/70">Belum ada. Tekan <strong class="font-medium text-base-content">Pantau</strong> di aset yang ingin kamu ikuti; AI menganalisanya tiap hari bursa.</p>
    {:else}
      <ul class="menu w-full gap-0.5 p-0">
        {#each items as item (item.symbol)}
          {@const lean = item.last?.status === 'completed' ? ratingLean(item.last.rating) : null}
          <li>
            <button class="grid-cols-[minmax(0,1fr)_auto] gap-3 py-2" class:menu-active={item.tvSymbol === ws.symbol} aria-current={item.tvSymbol === ws.symbol ? 'true' : undefined} onclick={() => open(item.tvSymbol)}>
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-medium">{friendlyName(item.tvSymbol)}</span>
                <span class="truncate text-xs opacity-70">{lastRun(item.last)}</span>
              </span>
              {#if lean}
                <span class="shrink-0 text-xs font-medium {item.tvSymbol === ws.symbol ? '' : toneOf(lean.direction)}">{lean.label}</span>
              {:else if item.last && (item.last.status === 'queued' || item.last.status === 'running')}
                <span class="loading loading-dots loading-xs shrink-0" aria-label="sedang dianalisa"></span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if starters.length}
    <section class="flex flex-col gap-2" aria-labelledby="starters-title">
      <h2 id="starters-title" class="px-1 text-sm font-semibold">{items.length ? 'Aset populer' : 'Mulai dari sini'}</h2>
      <ul class="menu w-full gap-0.5 p-0">
        {#each starters as [tv, label] (tv)}
          <li><button class:menu-active={tv === ws.symbol} aria-current={tv === ws.symbol ? 'true' : undefined} onclick={() => open(tv)}>{label}</button></li>
        {/each}
      </ul>
    </section>
  {/if}

  <button class="btn btn-ghost btn-sm justify-start gap-2" onclick={search}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    Cari aset lain
  </button>
</nav>
