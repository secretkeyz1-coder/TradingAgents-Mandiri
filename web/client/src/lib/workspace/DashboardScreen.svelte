<script lang="ts">
  // Beranda (ADR 0021): what changed since the last visit, what runs now, and how the member's signals did, in the
  // main column; the markets, Pantauanku, the AI brief and today's quota beside them; on a phone one column in that
  // order. An account without Pantauanku or a signal notification yet starts with the three steps that set them up,
  // in place of the parts that would only be empty. Riwayat call (every call, filtered and paged) opens in place of
  // the page from "Lihat semua", or from an asset in "Sejak kamu terakhir buka" (ws.calls).
  import { api, type Journal, type SignalHistory, type SinceVisit } from '../api';
  import { auth } from '../auth.svelte';
  import { sessionOf } from '../sessions';
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import CallHistory from './beranda/CallHistory.svelte';
  import MarketSide from './beranda/MarketSide.svelte';
  import MySignals from './beranda/MySignals.svelte';
  import RunningNow from './beranda/RunningNow.svelte';
  import SinceDigest from './beranda/SinceDigest.svelte';
  import StartSteps from './beranda/StartSteps.svelte';

  let days = $state(30);
  let history = $state<SignalHistory | null>(null);
  let historyError = $state('');
  let since = $state<SinceVisit | null>(null);
  let journal = $state<Journal | null>(null);

  function loadHistory() {
    const wanted = days;
    historyError = '';
    api
      .alertHistory(wanted)
      .then((h) => {
        if (wanted === days) history = h;
      })
      .catch((e) => {
        if (wanted === days) historyError = (e as Error).message;
      });
  }
  $effect(() => {
    void days;
    loadHistory();
  });
  api
    .sinceVisit()
    .then((s) => (since = s))
    .catch(() => {});
  api
    .journal(30)
    .then((j) => (journal = j))
    .catch(() => {});
  watch.load();

  const names = $derived(history?.scriptNames ?? {});
  const hasWatch = $derived((watch.value?.items.length ?? 0) > 0);
  const hasAlerts = $derived((history?.summary.alerts ?? 0) > 0);
  const trades = $derived((journal?.items ?? []).some((t) => t.status === 'open'));
  const showStart = $derived(!!watch.value && !!history && (!hasWatch || !hasAlerts));
  // A visit with nothing new still says so, except to an account still setting up, where it would only be empty.
  const quiet = $derived(!!since && !since.signals.total && !since.hits.length && !since.analyses.length);
  const visit = $derived(since?.since && !(showStart && quiet) ? (since as SinceVisit & { since: string }) : null);

  // The greeting and the day in WIB, and whether the markets a member here trades are open now.
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }));
  const greeting = hour < 4 ? 'Selamat malam' : hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam';
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });
  const sessions = [sessionOf('IDX:COMPOSITE'), sessionOf('BINANCE:BTCUSDT')].filter((s) => s != null);

  /** Signal notifications are set from the Sinyal chart's Notifikasi menu. */
  function openNotifications() {
    ws.setChartView('ai');
    ws.showChart();
  }
</script>

{#if ws.calls}
  <CallHistory />
{:else}
  <div class="h-full overflow-auto bg-base-200">
    <div class="ta-home">
      <header class="ta-home-head">
        <div class="flex flex-col gap-0.5">
          <p class="text-sm ta-muted">{greeting}{auth.user?.username ? `, ${auth.user.username}` : ''}</p>
          <h1 class="ta-title">{today}</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#each sessions as s (s.text)}
            <span class="ta-chip" data-size="lg"><span class="status {s.open ? 'status-success' : 'status-neutral'}" aria-hidden="true"></span>{s.text}</span>
          {/each}
        </div>
      </header>

      <div class="ta-home-main">
        {#if showStart}
          <StartSteps {hasWatch} {hasAlerts} hasTelegram={!!history?.telegram} onNotifications={openNotifications} />
        {/if}
        {#if visit}<SinceDigest since={visit} {names} />{/if}
        {#if !showStart || hasAlerts || trades}
          <RunningNow open={history ? history.open : historyError ? [] : null} {journal} {names} onJournal={(j) => (journal = j)} />
        {/if}
        {#if !showStart || hasAlerts || (history?.summary.total ?? 0) > 0}
          <MySignals {history} error={historyError} {days} onDays={(d) => (days = d)} onRetry={loadHistory} />
        {/if}
      </div>

      <aside class="ta-home-side" aria-label="Pasar dan asetmu">
        <MarketSide telegram={history ? history.telegram : null} starters={!showStart} />
      </aside>
    </div>
  </div>
{/if}
