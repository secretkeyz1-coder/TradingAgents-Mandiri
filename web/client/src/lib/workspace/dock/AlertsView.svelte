<script lang="ts">
  // Pantau → Alert: every notification on the account, grouped by asset, so an asset's alerts read together. Price
  // levels (a message when the price reaches X, server/src/price-alerts.ts) and signal alerts (new signals of an
  // indicator, server/src/alerts.ts). A signal's state is a chip with an icon and a word (Berjalan, Kena TP, Kena
  // SL), which the filters above count; on Creator a signal alert can be made public. Removing one asks first: it
  // stops for good. New ones are set from the chart's Notifikasi menu, where the symbol's price and indicators are
  // at hand, so this tab only points there. Pantau's head keeps the list fresh (stores/alerts).
  import { api, type PriceLevel, type Quote, type SignalAlert } from '../../api';
  import { indicatorName, SIGNAL_STATE, signalParts, TIMEFRAME_LABELS, UNAVAILABLE_NOTE } from '../../alertLabels';
  import { auth } from '../../auth.svelte';
  import { friendlyName, priceText } from '../../beginner/plain';
  import ConfirmDialog from '../../ConfirmDialog.svelte';
  import { dirOf, marketName, monogram, percentText } from '../../marks';
  import { alerts } from '../../stores/alerts.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';

  type Status = NonNullable<SignalAlert['last']>['status'];
  const STATE_DIR: Partial<Record<Status, 'run' | 'up' | 'down'>> = { open: 'run', win: 'up', loss: 'down' };
  const STATE_ICON: Record<Status, IconName> = { open: 'clock', win: 'check', loss: 'x', partial: 'check', exit: 'right', expired: 'clock', unfilled: 'minus', replaced: 'refresh' };
  const FILTERS: { key: 'all' | Status; label: string }[] = [
    { key: 'all', label: 'Semua' },
    { key: 'open', label: SIGNAL_STATE.open },
    { key: 'win', label: SIGNAL_STATE.win },
    { key: 'loss', label: SIGNAL_STATE.loss },
  ];

  let filter = $state<'all' | Status>('all');
  let note = $state('');
  let pending = $state<{ kind: 'level' | 'signal'; id: string; what: string } | null>(null);

  const levels = $derived(alerts.levels);
  const signals = $derived(alerts.signals);
  const creator = $derived(auth.user?.plan === 'creator');
  const showPublic = $derived(creator || !!signals?.items.some((a) => a.public));
  const allowance = $derived(signals ?? levels);
  const telegram = $derived(signals?.telegram ?? levels?.telegram);
  /** The Notifikasi menu lives on the Keputusan AI chart, which an engine symbol can open. */
  const toChart = $derived(!!ws.yahoo);

  /** Each asset's alerts, in the order the assets first come; price levels show under Semua only. */
  const groups = $derived.by(() => {
    const by = new Map<string, { tv: string; symbol: string; signals: SignalAlert[]; levels: PriceLevel[] }>();
    const slot = (tv: string, symbol: string) => {
      if (!by.has(tv)) by.set(tv, { tv, symbol, signals: [], levels: [] });
      return by.get(tv)!;
    };
    for (const a of signals?.items ?? []) if (filter === 'all' || a.last?.status === filter) slot(a.tvSymbol, a.symbol).signals.push(a);
    if (filter === 'all') for (const l of levels?.items ?? []) slot(l.tvSymbol, l.symbol).levels.push(l);
    return [...by.values()];
  });
  const count = (key: 'all' | Status) => (key === 'all' ? (signals?.items.length ?? 0) : (signals?.items.filter((a) => a.last?.status === key).length ?? 0));

  // Prices for the groups' heads, each minute while the tab is open (keyed by the symbols, so a refresh of the
  // list that changes nothing does not refetch).
  const symbols = $derived([...new Set([...(signals?.items ?? []).map((a) => a.symbol), ...(levels?.items ?? []).map((l) => l.symbol)])].join(','));
  let quotes = $state<Record<string, Quote | null>>({});
  $effect(() => {
    const list = symbols ? symbols.split(',') : [];
    if (!list.length) return;
    const load = () =>
      api
        .quotes(list)
        .then((r) => (quotes = r.quotes))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  /** Turning an alert private stops new entries; what is already on the track record stays. */
  async function publish(id: string, box: HTMLInputElement) {
    note = '';
    try {
      await api.setAlertPublic(id, box.checked);
      note = box.checked ? 'Sinyal baru dari alert ini akan tercatat di halaman rekam jejakmu.' : 'Alert ini privat lagi. Sinyal yang sudah tercatat tetap tampil.';
    } catch (e) {
      box.checked = !box.checked;
      note = (e as Error).message;
    }
    await alerts.load();
  }

  async function remove() {
    const p = pending;
    pending = null;
    if (!p) return;
    note = '';
    try {
      if (p.kind === 'level') await api.priceLevelRemove(p.id);
      else await api.removeAlert(p.id);
      note = `${p.what.charAt(0).toUpperCase()}${p.what.slice(1)} dihapus.`;
    } catch (e) {
      note = (e as Error).message;
    }
    await alerts.load();
  }

  function openChart() {
    ws.setChartView('ai');
    ws.showChart();
  }

  const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 5 : 8 });
  const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<div class="flex flex-col gap-4 p-4 sm:p-6">
  <section class="ta-card flex flex-wrap items-center gap-x-6 gap-y-3 p-5" aria-label="Pemakaian alert">
    <div class="flex min-w-0 flex-[1_1_22rem] flex-col gap-2">
      {#if allowance}
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-semibold">Alert terpakai</span>
          <span class="text-sm tabular-nums"><b>{allowance.used}</b> dari {allowance.max} di paketmu</span>
        </div>
        <progress class="progress progress-primary w-full" value={allowance.used} max={Math.max(allowance.max, 1)} aria-label="{allowance.used} dari {allowance.max} alert terpakai"></progress>
      {:else if !alerts.error}
        <div class="skeleton h-9 w-full"></div>
      {/if}
      {#if telegram && !telegram.bot}
        <p class="text-xs text-warning">Notifikasi Telegram belum tersedia di server ini.{levels?.mail ? ' Notifikasi harga tetap dikirim lewat email.' : ''}</p>
      {:else if telegram && !telegram.chat}
        <p class="text-xs text-warning">Hubungkan Telegram di menu akun → Profil → Notifikasi agar pesannya sampai.</p>
      {:else if telegram}
        <p class="flex items-center gap-1.5 text-xs ta-muted"><Icon name="send" size={14} />Pesannya masuk ke Telegram-mu; sinyal dicek tiap menit.</p>
      {/if}
    </div>
    <div class="flex flex-col items-start gap-1 sm:ml-auto sm:items-end">
      <button type="button" class="btn btn-primary" disabled={!toChart} onclick={openChart}><Icon name="plus" size={16} />Pasang alert baru</button>
      <span class="text-xs ta-muted">Dibuka di chart, lewat tombol Notifikasi</span>
    </div>
  </section>

  {#if alerts.error}<p role="alert" class="text-sm text-error">{alerts.error} <button type="button" class="link" onclick={() => alerts.load()}>Coba lagi</button></p>{/if}
  {#if note}<p role="status" class="text-sm">{note}</p>{/if}

  {#if signals?.items.length}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-2" role="group" aria-label="Saring menurut keadaan sinyal terakhir">
        {#each FILTERS as f (f.key)}
          <button type="button" class="ta-filter" aria-pressed={filter === f.key} onclick={() => (filter = f.key)}>
            {#if f.key === 'open'}
              <span class="status status-info status-xs" aria-hidden="true"></span>
            {:else if f.key === 'win'}
              <Icon name="check" size={14} stroke={2.4} class="ta-up" />
            {:else if f.key === 'loss'}
              <Icon name="x" size={14} stroke={2.4} class="ta-down" />
            {/if}
            {f.label}<b>{count(f.key)}</b>
          </button>
        {/each}
      </div>
      {#if creator}
        <p class="flex items-center gap-1.5 text-xs ta-muted">
          <Icon name="eye" size={14} /><span><b class="text-base-content">Publik</b>: sinyal baru dari alert itu tercatat di <a class="link" href="/c/{auth.user?.username}" target="_blank" rel="noopener">halaman rekam jejak</a>-mu.</span>
        </p>
      {/if}
    </div>
  {/if}

  {#if !signals && !levels && !alerts.error}
    <div class="flex flex-col gap-3" aria-busy="true"><div class="skeleton h-32 w-full"></div><div class="skeleton h-32 w-full"></div></div>
  {:else}
    {#each groups as g (g.tv)}
      {@const q = quotes[g.symbol]}
      {@const name = friendlyName(g.tv)}
      {@const market = marketName(g.tv)}
      {@const venue = g.tv.includes(':') ? g.tv.split(':')[0] : ''}
      <section class="ta-card overflow-hidden" aria-labelledby="alert-{g.tv}">
        <div class="ta-group-head">
          <span class="ta-mono">{monogram(g.tv)}</span>
          <div class="min-w-0 flex-1">
            <h2 id="alert-{g.tv}" class="truncate text-base font-semibold"><button type="button" class="link link-hover" onclick={() => ws.setSymbol(g.tv)}>{name}</button></h2>
            <p class="truncate text-xs ta-muted"><span class="font-mono">{g.tv.split(':').pop()}</span>{market ? ` · ${market}` : ''}{venue ? ` · ${venue}` : ''}</p>
          </div>
          {#if q}
            <span class="flex flex-col items-end gap-1 tabular-nums">
              <span class="font-semibold">{priceText(q.price, q.currency, g.symbol)}</span>
              {#if q.change != null}<span class="ta-chip" data-dir={dirOf(q.change)}>{percentText(q.change)}</span>{/if}
            </span>
          {/if}
          <span class="ta-chip">{g.signals.length + g.levels.length} alert</span>
        </div>
        {#each g.signals as a (a.id)}
          {@const ind = indicatorName(a, signals?.combos ?? [])}
          {@const tf = TIMEFRAME_LABELS[a.timeframe] ?? a.timeframe}
          {@const parts = a.last ? signalParts(a.last.label) : null}
          {@const what = `alert ${ind} ${tf} untuk ${name}`}
          <div class="ta-alert">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="flex min-w-0 flex-wrap items-center gap-2"><span class="truncate font-semibold">{ind}</span><span class="ta-tf">{tf}</span></span>
              {#if a.settingsPending}
                <span class="text-xs ta-muted" title="Sinyal yang sudah dikirim dipantau sampai selesai dengan pengaturan lama, lalu notifikasi memakai pengaturan Scalper yang baru.">Pengaturan Scalper baru menyusul</span>
              {/if}
              {#if !a.available}<span class="text-xs text-warning">{UNAVAILABLE_NOTE}</span>{/if}
            </div>
            <div class="ta-alert-signal flex min-w-0 items-center gap-2 text-sm ta-muted">
              {#if parts}
                {#if parts.side}
                  <span class="ta-chip" data-dir={parts.side === 'BUY' ? 'up' : 'down'}><Icon name={parts.side === 'BUY' ? 'arrowUp' : 'arrowDown'} size={12} stroke={2.4} />{parts.side === 'BUY' ? 'Beli' : 'Jual'}</span>
                {/if}
                <span class="truncate" title={parts.setup}>{parts.setup}</span>
              {:else}
                <span>{a.primed ? 'Belum ada sinyal' : 'Menyiapkan…'}</span>
              {/if}
            </div>
            <span>
              {#if a.last}
                <span class="ta-chip" data-dir={STATE_DIR[a.last.status]}>
                  {#if a.last.status === 'open'}
                    <span class="status status-info status-xs motion-safe:animate-pulse" aria-hidden="true"></span>
                  {:else}
                    <Icon name={STATE_ICON[a.last.status]} size={12} stroke={2.4} />
                  {/if}
                  {SIGNAL_STATE[a.last.status]}
                </span>
              {/if}
            </span>
            <span>
              {#if showPublic && (creator || a.public)}
                <label class="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" class="toggle toggle-sm toggle-primary" checked={a.public} aria-label="Publikkan {what}" onchange={(e) => publish(a.id, e.currentTarget)} />
                  <span aria-hidden="true">Publik</span>
                </label>
              {/if}
            </span>
            <button type="button" class="btn btn-square btn-ghost btn-sm text-error" aria-label="Hapus {what}" onclick={() => (pending = { kind: 'signal', id: a.id, what })}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        {/each}
        {#each g.levels as l (l.id)}
          {@const what = `notifikasi harga ${name} ${l.direction === 'above' ? 'naik ke' : 'turun ke'} ${fmt(l.price)}`}
          <div class="ta-alert">
            <span class="font-semibold">Notifikasi harga</span>
            <div class="ta-alert-signal flex min-w-0 items-center gap-2 text-sm">
              <span class="ta-chip"><Icon name={l.direction === 'above' ? 'arrowUp' : 'arrowDown'} size={12} stroke={2.4} />{l.direction === 'above' ? 'Naik ke' : 'Turun ke'}</span>
              <b class="tabular-nums">{fmt(l.price)}</b>
              {#if !l.active && l.triggeredAt}
                <span class="truncate ta-muted">terpicu {when(l.triggeredAt)}{l.triggeredPrice != null ? `, di ${fmt(l.triggeredPrice)}` : ''}</span>
              {/if}
            </div>
            <span>
              {#if l.active}
                <span class="ta-chip" data-dir="run"><Icon name="clock" size={12} stroke={2.4} />Menunggu</span>
              {:else}
                <span class="ta-chip" data-dir="up"><Icon name="check" size={12} stroke={2.4} />Terpicu</span>
                {#if !l.notified}<span class="mt-1 block text-xs text-warning">Pesannya tidak terkirim: Telegram atau email belum diatur.</span>{/if}
              {/if}
            </span>
            <span></span>
            <button type="button" class="btn btn-square btn-ghost btn-sm text-error" aria-label="Hapus {what}" onclick={() => (pending = { kind: 'level', id: l.id, what })}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        {/each}
      </section>
    {:else}
      {#if filter !== 'all'}
        <p class="text-sm ta-muted">
          Tidak ada alert sinyal yang {SIGNAL_STATE[filter].toLowerCase()} sekarang. <button type="button" class="link" onclick={() => (filter = 'all')}>Tampilkan semua</button>
        </p>
      {:else if signals && !signals.items.length}
        <section class="ta-card flex flex-col items-start gap-3 p-6" aria-labelledby="alerts-empty">
          <h2 id="alerts-empty" class="ta-section-title">Belum ada alert sinyal</h2>
          <p class="max-w-prose text-sm ta-muted">
            Pilih indikator di chart, lalu tekan Notifikasi: kamu dikabari tiap kali indikator itu memberi sinyal baru, dan akhirnya (kena TP atau SL) tercatat di sini.
          </p>
        </section>
      {/if}
    {/each}

    {#if levels && !levels.items.length && filter === 'all'}
      <section class="flex flex-wrap items-center gap-4 rounded-box border-[1.5px] border-dashed border-base-300 p-5" aria-labelledby="levels-empty">
        <span class="ta-choice-icon"><Icon name="bell" /></span>
        <div class="min-w-0 flex-1">
          <h2 id="levels-empty" class="font-semibold">Belum ada notifikasi harga</h2>
          <p class="text-sm ta-muted">Dikabari saat harga menyentuh level pilihanmu, misalnya Emas naik ke 4.100. Pasang dari tombol Notifikasi di chart.</p>
        </div>
      </section>
    {/if}
  {/if}
</div>

<ConfirmDialog
  open={!!pending}
  title={pending ? `Hapus ${pending.what}?` : ''}
  body={pending?.kind === 'signal'
    ? 'Notifikasi baru dari alert ini berhenti. Untuk memasangnya lagi, buka chart aset itu dan tekan Notifikasi.'
    : 'Notifikasi ini berhenti dan tidak bisa dikembalikan; pasang lagi dari chart kalau perlu.'}
  confirm={pending?.kind === 'signal' ? 'Hapus alert' : 'Hapus notifikasi'}
  onconfirm={remove}
  oncancel={() => (pending = null)}
/>
