<script lang="ts">
  // Riset AI's start: which asset to research. On a wide screen it sits where the chart will be,
  // beside the AI panel, which names the asset it works on until one is picked here (ADR 0018); on
  // a phone it is the whole screen. The last asset opened is one click away (stores/workspace
  // recent), then Pantauanku, well-known assets and the latest analyses with their rating; the
  // search box (AssetFinder) takes anything else, and on a wide screen it lists each market with its
  // prices (IDX to Komoditas) so a first visit is not an empty page. Picking one opens its chart here.
  import { friendlyName, STARTERS } from '../beginner/plain';
  import { ratingBadge } from '../format';
  import { jobs } from '../stores/jobs.svelte';
  import { usage } from '../stores/usage.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { toTradingView } from '../tv';
  import AssetFinder from './AssetFinder.svelte';

  watch.load();
  usage.refresh();

  const last = $derived(ws.recent[0] ?? null);
  /** A phone's keyboard would cover the choices below the box, so the box waits for a tap there. */
  const wide = $derived(layoutOf(viewport) !== 'narrow');
  const watched = $derived(watch.value?.items ?? []);
  const latest = $derived(jobs.analyses.filter((a) => a.kind === 'analysis').slice(0, 6));
  const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const STATUS: Record<string, string> = { queued: 'antre', running: 'berjalan', failed: 'gagal', cancelled: 'dibatalkan' };
  const quota = (u: { used: number; limit: number }) => (u.limit ? `${u.used} dari ${u.limit}` : `${u.used}, tanpa batas`);
</script>

<div class="h-full overflow-auto bg-base-100">
  <section class="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:py-12" aria-labelledby="picker-title">
    <div class="flex flex-col gap-3">
      <h1 id="picker-title" class="text-xl font-semibold tracking-tight sm:text-2xl">Aset mana yang mau diriset?</h1>
      {#if last}
        <div><button class="btn btn-primary btn-sm" onclick={() => ws.research(last)}>Lanjutkan: {friendlyName(last)}</button></div>
      {/if}
      <div class="flex min-h-0 flex-col {wide ? 'max-h-[26rem]' : ''}">
        <AssetFinder autofocus={wide} browse={wide} onpick={(tv) => ws.research(tv)} />
      </div>
    </div>

    {#if watched.length}
      <div class="flex flex-col gap-2">
        <h2 class="text-xs font-semibold text-base-content/70">Pantauanku</h2>
        <div class="flex flex-wrap gap-1.5">
          {#each watched as item (item.symbol)}
            <button class="btn btn-sm" onclick={() => ws.research(item.tvSymbol)}>{friendlyName(item.tvSymbol)}</button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- The market lists above cover these on a wide screen. -->
    <div class="flex flex-col gap-2" class:hidden={wide}>
      <h2 class="text-xs font-semibold text-base-content/70">Populer</h2>
      <div class="flex flex-wrap gap-1.5">
        {#each STARTERS as [tv, name] (tv)}
          <button class="btn btn-sm" onclick={() => ws.research(tv)}>{name}</button>
        {/each}
      </div>
    </div>

    {#if latest.length}
      <div class="flex flex-col gap-1">
        <h2 class="text-xs font-semibold text-base-content/70">Riset terakhir</h2>
        <ul class="divide-y divide-base-200">
          {#each latest as a (a.id)}
            <li>
              <button class="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-base-200" onclick={() => ws.openRun(a.id, { symbol: toTradingView(a.ticker) })}>
                <span class="min-w-0 flex-1 truncate">{friendlyName(toTradingView(a.ticker))} <span class="text-base-content/70">· {day(a.tradeDate)}</span></span>
                {#if a.rating}
                  <span class="badge badge-sm {ratingBadge(a.rating)}">{a.rating}</span>
                {:else if STATUS[a.status]}
                  <span class="text-xs text-base-content/70">{STATUS[a.status]}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if usage.value}
      <p class="text-xs text-base-content/70">Kuota hari ini: analisa AI {quota(usage.value.analyses)} · tanya AI {quota(usage.value.chat)}.</p>
    {/if}
  </section>
</div>
