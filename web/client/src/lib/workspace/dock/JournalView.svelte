<script lang="ts">
  // Pantau → Jurnal: the trades the member took (server/src/journal.ts), first what those that closed in the period
  // add up to: the total in R with every trade on a chart, then the pattern by mood and by source, so a habit like
  // "trades on FOMO lose" stands out. Then the trades still running, each between its stop and its target with where
  // the price is now (the server closes them at TP or SL; the owner can close at a price or mark one never taken),
  // then the closed ones. Most trades come from the chart's plan card ("Saya ambil"); the form here notes one by
  // hand on any asset, its entry filled from the price now and its R said before saving. Removing a closed trade or
  // marking one never taken asks first: neither comes back. Pantau's head keeps the list fresh (stores/journal).
  import { untrack } from 'svelte';
  import { api, type JournalGroup, type JournalMood, type JournalTrade, type Quote } from '../../api';
  import { INDICATOR_NAMES } from '../../alertLabels';
  import { friendlyName } from '../../beginner/plain';
  import ConfirmDialog from '../../ConfirmDialog.svelte';
  import { MOOD_LABEL, signedR, STATUS_LABEL } from '../../journalLabels';
  import { monogram } from '../../marks';
  import MoodPicker from '../../MoodPicker.svelte';
  import { journal } from '../../stores/journal.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { toYahoo } from '../../tv';
  import AssetFinder from '../AssetFinder.svelte';
  import Icon from '../Icon.svelte';
  import JournalChart from './JournalChart.svelte';

  const PERIODS = [7, 30, 90] as const;
  const data = $derived(journal.value);
  const summary = $derived(data?.summary ?? null);
  let note = $state('');

  const running = $derived(data?.items.filter((t) => t.status === 'open') ?? []);
  const finished = $derived(data?.items.filter((t) => t.status !== 'open') ?? []);
  /** The closed trades with a result, oldest first, for the chart. */
  const results = $derived(
    finished
      .filter((t) => t.r != null && t.closedAt)
      .sort((a, b) => a.closedAt!.localeCompare(b.closedAt!))
      .map((t) => ({ r: t.r!, day: dayOf(t.closedAt!) })),
  );

  // Prices for the running trades, each minute while the tab is open.
  const openSymbols = $derived([...new Set(running.map((t) => t.symbol))].join(','));
  let prices = $state<Record<string, Quote | null>>({});
  $effect(() => {
    const list = openSymbols ? openSymbols.split(',') : [];
    if (!list.length) return;
    const load = () =>
      api
        .quotes(list)
        .then((r) => (prices = r.quotes))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  /** Where a running trade stands: its stop on the left, its target on the right, the price now between them. */
  function track(t: JournalTrade, now: number | null) {
    const risk = Math.abs(t.entry - t.stopLoss);
    const reward = Math.abs(t.takeProfit - t.entry);
    const sl = risk + reward ? (risk / (risk + reward)) * 100 : 50;
    if (now == null) return { sl, now: null, at: sl, share: 0, toward: 'TP' as const };
    const moved = t.side === 'BUY' ? now - t.entry : t.entry - now;
    const share = Math.min(1, moved >= 0 ? (reward ? moved / reward : 0) : risk ? -moved / risk : 0);
    return { sl, now, at: moved >= 0 ? sl + share * (100 - sl) : sl - share * sl, share, toward: moved >= 0 ? ('TP' as const) : ('SL' as const) };
  }

  /** The mood that cost most, when one cost anything: the pattern the journal is for. */
  const worst = $derived.by(() => {
    const bad = summary?.byMood.filter((g) => g.key && g.totalR < 0 && g.n >= 2).sort((a, b) => a.totalR - b.totalR)[0];
    return bad ? { ...bad, label: MOOD_LABEL[bad.key as JournalMood] } : null;
  });
  const bars = $derived.by(() => {
    const moods = (summary?.byMood ?? []).filter((g) => g.key).map((g) => ({ key: `mood-${g.key}`, name: MOOD_LABEL[g.key as JournalMood], g }));
    const sources = (summary?.bySource ?? []).map((g) => ({ key: `source-${g.key}`, name: sourceWord(g.key), g }));
    const max = Math.max(0.0001, ...[...moods, ...sources].map((x) => Math.abs(x.g.totalR)));
    return { moods, sources, max };
  });

  // --- A trade noted by hand, on any asset: its entry filled from the price now, its sides checked as typed.
  let adding = $state(false);
  let choosing = $state(false);
  let formSymbol = $state(ws.symbol);
  const formYahoo = $derived(toYahoo(formSymbol));
  let formPrice = $state<number | null>(null);
  let side = $state<'BUY' | 'SELL'>('BUY');
  let entry = $state<number | null>(null);
  let stopLoss = $state<number | null>(null);
  let takeProfit = $state<number | null>(null);
  let mood = $state<JournalMood | null>(null);
  let memo = $state('');
  let busy = $state(false);

  $effect(() => {
    const yahoo = formYahoo;
    formPrice = null;
    if (!adding || !yahoo) return;
    let live = true;
    api
      .quotes([yahoo])
      .then((r) => {
        const price = r.quotes[yahoo]?.price ?? null;
        if (!live) return;
        formPrice = price;
        if (price != null && untrack(() => entry == null)) entry = Number(price.toPrecision(6));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  const risk = $derived(entry != null && stopLoss != null ? Math.abs(entry - stopLoss) : null);
  const reward = $derived(entry != null && takeProfit != null ? Math.abs(takeProfit - entry) : null);
  const below = $derived(side === 'BUY');
  const slWrong = $derived(entry != null && stopLoss != null && (below ? stopLoss >= entry : stopLoss <= entry));
  const tpWrong = $derived(entry != null && takeProfit != null && (below ? takeProfit <= entry : takeProfit >= entry));
  const plannedR = $derived(risk && reward != null && !slWrong && !tpWrong ? reward / risk : null);
  const slHint = $derived(
    slWrong
      ? `Untuk ${below ? 'Beli' : 'Jual'}, SL harus di ${below ? 'bawah' : 'atas'} entry.`
      : risk != null
        ? `${fmt(risk)} di ${below ? 'bawah' : 'atas'} entry`
        : `Di ${below ? 'bawah' : 'atas'} entry`,
  );
  const tpHint = $derived(
    tpWrong
      ? `Untuk ${below ? 'Beli' : 'Jual'}, TP harus di ${below ? 'atas' : 'bawah'} entry.`
      : reward != null
        ? `${fmt(reward)} di ${below ? 'atas' : 'bawah'} entry`
        : `Di ${below ? 'atas' : 'bawah'} entry`,
  );

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!formYahoo || entry == null || stopLoss == null || takeProfit == null) return;
    if (slWrong || tpWrong) {
      note = slWrong ? slHint : tpHint;
      return;
    }
    busy = true;
    note = '';
    try {
      await api.journalAdd({ symbol: formYahoo, tvSymbol: formSymbol, side, entry, stopLoss, takeProfit, source: 'manual', mood: mood ?? undefined, note: memo.trim() || undefined });
      entry = stopLoss = takeProfit = null;
      mood = null;
      memo = '';
      adding = false;
      note = 'Trade tercatat. Jurnal menutupnya sendiri saat harga menyentuh TP atau SL.';
      await journal.load();
    } catch (err) {
      note = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  // --- Closing a running trade at a price, marking one never taken, removing a closed one.
  let closing = $state<string | null>(null);
  let exit = $state<number | null>(null);
  let pending = $state<{ kind: 'drop' | 'remove'; trade: JournalTrade } | null>(null);

  async function act(run: () => Promise<unknown>) {
    note = '';
    try {
      await run();
      closing = null;
      exit = null;
    } catch (err) {
      note = (err as Error).message;
    }
    await journal.load();
  }
  const close = (t: JournalTrade) => exit != null && act(() => api.journalUpdate(t.id, { close: { price: exit! } }));
  function confirmed() {
    const p = pending;
    pending = null;
    if (!p) return;
    act(() => (p.kind === 'drop' ? api.journalUpdate(p.trade.id, { cancel: true }) : api.journalRemove(p.trade.id)));
  }
  /** Puts the cursor in a field as soon as it shows (the exit price when a trade is closed by hand). */
  const focusOnMount = (node: HTMLElement) => node.focus();

  function fmt(v: number) {
    return v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 5 : 8 });
  }
  const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function dayOf(iso: string) {
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }
  const tone = (r: number) => (r > 0 ? 'ta-up' : r < 0 ? 'ta-down' : '');
  const sideName = (t: Pick<JournalTrade, 'side'>) => (t.side === 'BUY' ? 'Beli' : 'Jual');
  /** A source as people say it: the plan card's label, a built-in engine's name, or Diisi sendiri. */
  function sourceWord(key: string) {
    return key === 'manual' ? 'Diisi sendiri' : (INDICATOR_NAMES[key] ?? key);
  }
  const sourceName = (t: JournalTrade) => t.label ?? sourceWord(t.source);
  const money = (t: JournalTrade) => (t.riskIdr && t.r != null ? `${t.r >= 0 ? '+' : '−'}Rp${Math.round(Math.abs(t.r * t.riskIdr)).toLocaleString('id-ID')}` : '');
</script>

{#snippet bar(name: string, g: JournalGroup, max: number)}
  <span class="flex min-w-0 flex-col pr-4">
    <span class="truncate font-semibold">{name}</span>
    <span class="text-xs ta-muted">{g.n} trade · {g.wins} untung</span>
  </span>
  <span class="ta-dbars-neg">{#if g.totalR < 0}<span style="width: {(Math.abs(g.totalR) / max) * 100}%"></span>{/if}</span>
  <span class="ta-dbars-pos">{#if g.totalR > 0}<span style="width: {(g.totalR / max) * 100}%"></span>{/if}</span>
  <span class="text-right font-bold tabular-nums {tone(g.totalR)}">{signedR(g.totalR)}</span>
{/snippet}

<div class="flex flex-col gap-4 p-4 sm:p-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex max-w-[65ch] flex-col gap-1 text-sm">
      <p>Catatan trade yang kamu ambil. Jurnal menutupnya sendiri saat harga menyentuh TP atau SL, dicek tiap menit dari candle 15 menit.</p>
      {#if data}
        <p class="text-xs ta-muted">{data.open} dari {data.max} trade berjalan terpakai.</p>
        {#if !data.telegram.bot}
          <p class="text-xs ta-muted">Kabar TP/SL dan rekap mingguan lewat Telegram belum tersedia di server ini.</p>
        {:else if !data.telegram.chat}
          <p class="text-xs text-warning">Hubungkan Telegram di menu akun → Profil agar dikabari saat TP atau SL kena, dan dapat rekap jurnal tiap Minggu malam.</p>
        {:else}
          <p class="text-xs ta-muted">Kabar TP/SL dan rekap jurnal tiap Minggu pukul 19.00 WIB dikirim ke Telegram-mu.</p>
        {/if}
      {/if}
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <div class="join" role="group" aria-label="Periode">
        {#each PERIODS as p (p)}
          <button type="button" class="btn join-item btn-sm" class:btn-active={journal.days === p} aria-pressed={journal.days === p} onclick={() => journal.setDays(p)}>{p} hari</button>
        {/each}
      </div>
      <button type="button" class="btn btn-sm" class:btn-primary={!adding && !!data?.items.length} aria-expanded={adding} onclick={() => (adding = !adding)}>
        <Icon name={adding ? 'x' : 'plus'} size={16} />{adding ? 'Tutup formulir' : 'Catat trade'}
      </button>
    </div>
  </div>

  {#if adding}
    <form class="ta-card flex flex-col gap-4 p-5" onsubmit={add} aria-labelledby="add-title">
      <h2 id="add-title" class="ta-section-title">Catat trade</h2>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-0 flex-[2_1_18rem] flex-col gap-1.5">
          <span class="text-sm font-medium" id="add-asset">Aset</span>
          {#if choosing}
            <div class="rounded-box border border-base-300 p-2">
              <AssetFinder
                autofocus
                onpick={(tv) => {
                  formSymbol = tv;
                  choosing = false;
                  entry = null;
                }}
                onclose={() => (choosing = false)}
              />
            </div>
          {:else}
            <button type="button" class="btn justify-start gap-3" aria-labelledby="add-asset add-asset-name" onclick={() => (choosing = true)}>
              <span class="ta-mono h-7 w-7 rounded-md">{monogram(formSymbol)}</span>
              <span id="add-asset-name" class="truncate">{friendlyName(formSymbol)}</span>
              {#if formPrice != null}<span class="ml-auto tabular-nums ta-muted">{fmt(formPrice)}</span>{/if}
              <span class="text-sm font-medium text-primary" class:ml-auto={formPrice == null}>Ganti</span>
            </button>
          {/if}
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-medium" id="add-side">Arah</span>
          <div class="join" role="group" aria-labelledby="add-side">
            <button type="button" class="btn join-item" class:btn-active={side === 'BUY'} aria-pressed={side === 'BUY'} onclick={() => (side = 'BUY')}>Beli</button>
            <button type="button" class="btn join-item" class:btn-active={side === 'SELL'} aria-pressed={side === 'SELL'} onclick={() => (side = 'SELL')}>Jual</button>
          </div>
        </div>
      </div>
      {#if !formYahoo}<p class="text-sm text-warning">Harga aset ini belum bisa dipantau, jadi belum bisa dicatat di jurnal. Pilih aset lain.</p>{/if}
      <div class="grid gap-3 sm:grid-cols-3">
        <label class="flex flex-col gap-1.5 text-sm font-medium">
          Entry
          <input class="input w-full tabular-nums" type="number" step="any" min="0" required bind:value={entry} />
          <span class="text-xs font-normal ta-muted">{formPrice != null ? `Harga sekarang ${fmt(formPrice)}` : 'Harga masuk'}</span>
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-medium">
          Stop loss (SL)
          <input
            class="input w-full tabular-nums"
            class:input-error={slWrong}
            type="number"
            step="any"
            min="0"
            required
            aria-invalid={slWrong || undefined}
            aria-describedby="add-sl-hint"
            bind:value={stopLoss}
          />
          <span id="add-sl-hint" class="text-xs font-normal {slWrong ? 'text-error' : 'ta-muted'}">{slHint}</span>
        </label>
        <label class="flex flex-col gap-1.5 text-sm font-medium">
          Take profit (TP)
          <input
            class="input w-full tabular-nums"
            class:input-error={tpWrong}
            type="number"
            step="any"
            min="0"
            required
            aria-invalid={tpWrong || undefined}
            aria-describedby="add-tp-hint"
            bind:value={takeProfit}
          />
          <span id="add-tp-hint" class="text-xs font-normal {tpWrong ? 'text-error' : 'ta-muted'}">{tpHint}</span>
        </label>
      </div>
      {#if plannedR != null && risk != null && reward != null}
        <p class="flex items-start gap-2 rounded-field bg-base-200 px-3 py-2 text-sm">
          <Icon name="info" size={16} class="mt-0.5" />
          <span>
            Risiko {fmt(risk)}, target {fmt(reward)}: 1 banding {plannedR.toLocaleString('id-ID', { maximumFractionDigits: 1 })}. Kalau TP kena hasilnya
            <b class="ta-up">{signedR(plannedR)}</b>, kalau SL kena <b class="ta-down">{signedR(-1)}</b>.
          </span>
        </p>
      {/if}
      <div class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Perasaan saat masuk <span class="font-normal ta-muted">(boleh dikosongkan)</span></span>
        <MoodPicker bind:value={mood} size="sm" />
      </div>
      <label class="flex flex-col gap-1.5 text-sm font-medium">
        Catatan
        <textarea class="textarea w-full font-normal" rows="2" maxlength="500" placeholder="Alasan masuk, rencana keluar" bind:value={memo}></textarea>
      </label>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-primary" disabled={busy || !formYahoo}>
          {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
          Simpan ke jurnal
        </button>
        <button type="button" class="btn btn-ghost" onclick={() => (adding = false)}>Batal</button>
      </div>
    </form>
  {/if}

  {#if journal.error}<p role="alert" class="text-sm text-error">{journal.error} <button type="button" class="link" onclick={() => journal.load()}>Coba lagi</button></p>{/if}
  {#if note}<p role="status" class="text-sm">{note}</p>{/if}

  {#if !data}
    {#if !journal.error}
      <div class="flex flex-col gap-3" aria-busy="true"><div class="skeleton h-56 w-full"></div><div class="skeleton h-28 w-full"></div></div>
    {/if}
  {:else if !data.items.length}
    <section class="ta-card flex flex-col gap-5 p-6" aria-labelledby="journal-empty">
      <div class="flex flex-col gap-1.5">
        <h2 id="journal-empty" class="ta-section-title">Belum ada trade dalam {data.days} hari</h2>
        <p class="max-w-prose text-sm ta-muted">Catat trade yang kamu ambil. Jurnal menutupnya sendiri, lalu menunjukkan pola yang membuatmu untung atau rugi.</p>
      </div>
      <ol class="grid gap-3 md:grid-cols-3">
        <li class="flex flex-col gap-2 rounded-box border border-base-300 p-4">
          <span class="ta-step-n" aria-hidden="true">1</span>
          <span class="font-semibold">Ambil rencana dari chart</span>
          <span class="text-sm ta-muted">Di kartu Rencana pada chart, tekan <b class="text-base-content">Saya ambil</b>. Entry, SL, dan TP terisi sendiri.</span>
        </li>
        <li class="flex flex-col gap-2 rounded-box border border-base-300 p-4">
          <span class="ta-step-n" aria-hidden="true">2</span>
          <span class="font-semibold">Jurnal yang menutupnya</span>
          <span class="text-sm ta-muted">Dicek tiap menit dari candle 15 menit; selesai saat harga menyentuh TP atau SL.</span>
        </li>
        <li class="flex flex-col gap-2 rounded-box border border-base-300 p-4">
          <span class="ta-step-n" aria-hidden="true">3</span>
          <span class="font-semibold">Lihat polanya</span>
          <span class="text-sm ta-muted">Hasil per perasaan dan per sumber muncul di sini{data.telegram.bot ? ', rekapnya tiap Minggu 19.00 WIB ke Telegram' : ''}.</span>
        </li>
      </ol>
      {#if !adding}<div><button type="button" class="btn btn-primary" onclick={() => (adding = true)}><Icon name="plus" size={16} />Catat trade pertama</button></div>{/if}
    </section>
  {:else}
    {#if summary && summary.closed}
      <section class="ta-card grid gap-6 p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] lg:items-center" aria-labelledby="journal-summary">
        <div class="flex flex-col gap-3">
          <h2 id="journal-summary" class="ta-section-title">Hasil {data.days} hari</h2>
          <p class="text-5xl font-extrabold tracking-tight tabular-nums {tone(summary.totalR)}">{signedR(summary.totalR)}</p>
          <p class="text-base">{summary.wins} dari {summary.closed} trade untung, rata-rata {signedR(summary.avgR ?? 0)} per trade.</p>
          <p class="text-xs ta-muted">R adalah risiko satu trade, jarak entry ke SL: +2,0R berarti untung dua kali risikonya, −1,0R berarti rugi sebesar risikonya.</p>
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <p class="text-sm ta-muted">Tiap trade dan total berjalannya</p>
          <JournalChart trades={results} />
        </div>
      </section>
      {#if bars.moods.length || bars.sources.length > 1}
        <section class="ta-card flex flex-col gap-4 p-5" aria-labelledby="journal-pattern">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="journal-pattern" class="ta-section-title">Polamu</h2>
            <span class="text-sm ta-muted">hasil menurut perasaan saat masuk dan sumber rencananya</span>
          </div>
          {#if worst}
            <p class="flex items-start gap-2 rounded-field bg-error/10 px-3 py-2 text-sm">
              <Icon name="alert" size={16} class="mt-0.5 ta-down" />
              <span>
                Trade saat <b>{worst.label}</b>: {worst.wins ? `${worst.wins} dari ${worst.n} untung` : `tidak ada dari ${worst.n} yang untung`}, {signedR(worst.totalR)}. Tanpa itu hasilmu {signedR(summary.totalR - worst.totalR)}.
              </span>
            </p>
          {/if}
          <div class="ta-dbars text-sm">
            {#each bars.moods as m (m.key)}{@render bar(m.name, m.g, bars.max)}{/each}
            {#if bars.moods.length && bars.sources.length}<span class="col-span-4 h-px bg-base-300"></span>{/if}
            {#each bars.sources as s (s.key)}{@render bar(s.name, s.g, bars.max)}{/each}
          </div>
        </section>
      {/if}
    {/if}

    <section class="flex flex-col gap-3" aria-labelledby="journal-running">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="journal-running" class="ta-section-title">Berjalan</h2>
        <span class="text-sm ta-muted">{running.length} dari {data.max} · ditutup otomatis di TP atau SL</span>
      </div>
      {#each running as t (t.id)}
        {@const tr = track(t, prices[t.symbol]?.price ?? null)}
        {@const name = friendlyName(t.tvSymbol)}
        <article class="ta-trade" aria-labelledby="trade-{t.id}">
          <div class="flex min-w-0 flex-col gap-2">
            <div class="flex items-center gap-3">
              <span class="ta-mono">{monogram(t.tvSymbol)}</span>
              <div class="min-w-0 flex-1">
                <h3 id="trade-{t.id}" class="truncate font-semibold"><button type="button" class="link link-hover" onclick={() => ws.setSymbol(t.tvSymbol)}>{name}</button></h3>
                <p class="truncate font-mono text-xs ta-muted">{t.tvSymbol.split(':').pop()}</p>
              </div>
              <span class="ta-chip" data-dir={t.side === 'BUY' ? 'up' : 'down'}><Icon name={t.side === 'BUY' ? 'arrowUp' : 'arrowDown'} size={12} stroke={2.4} />{sideName(t)}</span>
            </div>
            <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ta-muted">
              <span>{sourceName(t)}</span>{#if t.mood}<span class="ta-chip">{MOOD_LABEL[t.mood]}</span>{/if}<span>dicatat {when(t.openedAt)}</span>
            </p>
          </div>
          <div
            class="ta-track"
            role="img"
            aria-label="{name} {sideName(t)}: {tr.now != null
              ? `harga sekarang ${fmt(tr.now)}, sudah ${Math.round(tr.share * 100)} persen jalan menuju ${tr.toward}`
              : 'harga sekarang belum termuat'}; SL {fmt(t.stopLoss)}, masuk {fmt(t.entry)}, TP {fmt(t.takeProfit)}"
          >
            <span class="ta-track-sl" style="width: {tr.sl}%"></span>
            <span class="ta-track-tp" style="width: {100 - tr.sl}%"></span>
            <span class="ta-track-entry" style="left: {tr.sl}%"></span>
            {#if tr.now != null}
              <span class="ta-track-now" style="left: {tr.at}%"></span>
              <span class="ta-track-now-label" style="left: {Math.min(88, Math.max(12, tr.at))}%">sekarang {fmt(tr.now)}</span>
            {/if}
            <span class="ta-track-label ta-down" style="left: 0">SL {fmt(t.stopLoss)}</span>
            <span class="ta-track-label -translate-x-1/2" style="left: {Math.min(70, Math.max(30, tr.sl))}%">masuk {fmt(t.entry)}</span>
            <span class="ta-track-label ta-up" style="right: 0">TP {fmt(t.takeProfit)}</span>
          </div>
          <div class="flex flex-col items-start gap-2 lg:items-end">
            {#if tr.now != null}
              <span class="ta-chip" data-size="lg" data-dir={tr.toward === 'TP' ? 'up' : 'down'}>
                <Icon name={tr.toward === 'TP' ? 'target' : 'alert'} size={14} />{Math.round(tr.share * 100)}% menuju {tr.toward}
              </span>
            {/if}
            {#if closing === t.id}
              <form class="flex items-center gap-1" onsubmit={(e) => (e.preventDefault(), close(t))}>
                <input use:focusOnMount class="input input-sm w-28 tabular-nums" type="number" step="any" min="0" required aria-label="Harga keluar {name}" bind:value={exit} />
                <button class="btn btn-sm">Simpan</button>
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => (closing = null)}>Batal</button>
              </form>
            {:else}
              <div class="flex flex-wrap gap-1">
                <button type="button" class="btn btn-sm" onclick={() => ((closing = t.id), (exit = tr.now != null ? Number(tr.now.toPrecision(6)) : null))}>Tutup di harga…</button>
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => (pending = { kind: 'drop', trade: t })}>Tidak jadi</button>
              </div>
            {/if}
          </div>
        </article>
      {:else}
        <p class="text-sm ta-muted">Tidak ada trade berjalan. Ambil rencana dari chart (tombol Saya ambil) atau catat sendiri.</p>
      {/each}
    </section>

    {#if finished.length}
      <section class="ta-card overflow-hidden" aria-labelledby="journal-finished">
        <div class="ta-group-head">
          <h2 id="journal-finished" class="ta-section-title flex-1">Selesai</h2>
          <span class="text-sm ta-muted">{finished.length} trade · {data.days} hari</span>
        </div>
        <div class="ta-closed text-xs font-medium ta-muted max-lg:hidden" aria-hidden="true">
          <span>Aset</span><span>Hasil</span><span>Selesai</span><span>Sumber</span><span>Catatan</span><span></span>
        </div>
        {#each finished as t (t.id)}
          {@const name = friendlyName(t.tvSymbol)}
          <div class="ta-closed">
            <span class="flex min-w-0 items-center gap-2"><span class="truncate font-semibold">{name}</span><span class="ta-chip" data-dir={t.side === 'BUY' ? 'up' : 'down'}>{sideName(t)}</span></span>
            <span class="flex flex-col tabular-nums">
              {#if t.r != null}
                <b class={tone(t.r)}>{signedR(t.r)}</b>
                {#if money(t)}<span class="text-xs ta-muted">{money(t)}</span>{/if}
              {:else}
                <span class="ta-muted">—</span>
              {/if}
            </span>
            <span class="ta-closed-when flex min-w-0 flex-col">
              <span class="truncate">{STATUS_LABEL[t.status]}{t.exitPrice != null ? ` di ${fmt(t.exitPrice)}` : ''}</span>
              {#if t.closedAt}<span class="text-xs ta-muted">{when(t.closedAt)}</span>{/if}
            </span>
            <span class="flex min-w-0 flex-col items-start gap-1 max-lg:hidden"><span class="truncate">{sourceName(t)}</span>{#if t.mood}<span class="ta-chip">{MOOD_LABEL[t.mood]}</span>{/if}</span>
            <span class="truncate ta-muted max-lg:hidden" title={t.note ?? undefined}>{t.note ?? ''}</span>
            <button type="button" class="btn btn-square btn-ghost btn-sm text-error" aria-label="Hapus trade {name}{t.closedAt ? `, ${when(t.closedAt)}` : ''}, dari jurnal" onclick={() => (pending = { kind: 'remove', trade: t })}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        {/each}
      </section>
    {/if}
  {/if}
</div>

<ConfirmDialog
  open={!!pending}
  title={pending
    ? pending.kind === 'drop'
      ? `Tandai trade ${friendlyName(pending.trade.tvSymbol)} sebagai tidak jadi?`
      : `Hapus trade ${friendlyName(pending.trade.tvSymbol)} dari jurnal?`
    : ''}
  body={pending?.kind === 'drop'
    ? 'Trade ini dikeluarkan dari hasil dan berhenti dipantau. Pilih ini hanya kalau trade-nya memang tidak kamu ambil.'
    : 'Catatan, perasaan, dan hasilnya hilang dan tidak bisa dikembalikan. Hasil periode ini dihitung ulang tanpa trade ini.'}
  confirm={pending?.kind === 'drop' ? 'Tandai tidak jadi' : 'Hapus trade'}
  onconfirm={confirmed}
  oncancel={() => (pending = null)}
/>
