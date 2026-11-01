<script lang="ts">
  // Pemula: one asset at a time, in plain words. Pantauanku on the left, the asset
  // in the middle (price, chart, the AI's advice, what to be told), and a chat on
  // the right; on a phone the three are tabs. The symbol is the workspace's own
  // (the URL hash), so switching to Pro keeps the same asset in focus.
  import { onMount, untrack } from 'svelte';
  import { agent } from '../stores/agent.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { usage } from '../stores/usage.svelte';
  import { layoutOf, viewport } from '../stores/viewport.svelte';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import ChatPanel from '../workspace/ChatPanel.svelte';
  import AssetView from './AssetView.svelte';
  import NotifyCard from './NotifyCard.svelte';
  import { friendlyName, questionsFor } from './plain';
  import VerdictCard from './VerdictCard.svelte';
  import WatchList from './WatchList.svelte';

  let { onprofile }: { onprofile: () => void } = $props();

  onMount(() => {
    jobs.start();
    catalog.load();
    watch.load();
    usage.refresh();
  });

  // The chat follows the asset in focus.
  $effect(() => {
    if (ws.yahoo) agent.load(ws.yahoo);
  });

  const name = $derived(friendlyName(ws.symbol));
  const narrow = $derived(layoutOf(viewport) === 'narrow');

  type Tab = 'list' | 'asset' | 'ai';
  let tab = $state<Tab>('asset');
  // An asset picked anywhere (the list, the search box) is shown.
  $effect(() => {
    void ws.symbol;
    untrack(() => {
      if (tab === 'list') tab = 'asset';
    });
  });

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'list', label: 'Pantauanku', icon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
    { key: 'asset', label: 'Aset', icon: 'M3 3v18h18M7 15l4-4 3 3 5-6' },
    { key: 'ai', label: 'Tanya AI', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  ];
</script>

{#snippet asset()}
  <div class="@container flex flex-col gap-5">
    <AssetView />
    <div class="grid gap-4 @2xl:grid-cols-2">
      <VerdictCard />
      <NotifyCard {onprofile} />
    </div>
  </div>
{/snippet}

{#snippet chat()}
  <ChatPanel simple suggestions={questionsFor(name)} intro="Tanya apa saja soal {name}. AI membaca data harganya, lalu menjawab dengan bahasa sederhana." />
{/snippet}

{#if narrow}
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto" class:flex={tab === 'ai'} class:flex-col={tab === 'ai'}>
      {#if tab === 'list'}
        <div class="p-4"><WatchList onpick={() => (tab = 'asset')} /></div>
      {:else if tab === 'asset'}
        <div class="p-4">{@render asset()}</div>
      {:else}
        <section class="flex min-h-0 flex-1 flex-col gap-2 p-4" aria-label="Tanya AI">{@render chat()}</section>
      {/if}
    </div>
    <nav class="grid shrink-0 grid-cols-3 border-t border-base-300 bg-base-100" aria-label="Bagian">
      {#each TABS as t (t.key)}
        <button
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium"
          class:text-primary={tab === t.key}
          class:text-base-content={tab !== t.key}
          aria-current={tab === t.key ? 'page' : undefined}
          onclick={() => (tab = t.key)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
          {t.label}
        </button>
      {/each}
    </nav>
  </div>
{:else}
  <div class="grid min-h-0 flex-1 grid-cols-[12rem_minmax(0,1fr)_18rem] xl:grid-cols-[15rem_minmax(0,1fr)_24rem]">
    <aside class="min-h-0 overflow-y-auto border-r border-base-300 p-3">
      <WatchList />
    </aside>
    <main class="min-h-0 overflow-y-auto px-6 py-5">
      <div class="mx-auto max-w-4xl">{@render asset()}</div>
    </main>
    <section class="flex min-h-0 flex-col gap-2 border-l border-base-300 p-3" aria-labelledby="chat-title">
      <h2 id="chat-title" class="text-sm font-semibold">Tanya AI</h2>
      {@render chat()}
    </section>
  </div>
{/if}
