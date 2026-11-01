<script lang="ts">
  // Pantau → Alert: every notification on the account in one place. Price levels
  // (a message when the price reaches X, server/src/price-alerts.ts) and signal alerts (new
  // signals of an indicator, server/src/alerts.ts), each removable; on Creator a signal alert
  // can be made public. New ones are set from the chart's Notifikasi menu, where the symbol's
  // price and indicators are at hand, so this list only points there.
  import { indicatorName, SIGNAL_STATUS, TIMEFRAME_LABELS } from '../../alertLabels';
  import { api, type PriceLevel, type PriceLevels, type SignalAlerts } from '../../api';
  import { auth } from '../../auth.svelte';
  import { ws } from '../../stores/workspace.svelte';

  let levels = $state<PriceLevels | null>(null);
  let signals = $state<SignalAlerts | null>(null);
  let error = $state('');
  let note = $state('');

  async function load() {
    try {
      [levels, signals] = await Promise.all([api.priceLevels(), api.alerts()]);
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // Refreshed each minute, so a level that fired shows as fired and one added from the chart appears.
  $effect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  async function removeLevel(id: string) {
    note = '';
    await api.priceLevelRemove(id).catch((e) => (note = (e as Error).message));
    await load();
  }

  async function removeSignal(id: string) {
    note = '';
    await api.removeAlert(id).catch((e) => (note = (e as Error).message));
    await load();
  }

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
    await load();
  }

  const creator = $derived(auth.user?.plan === 'creator');
  const allowance = $derived(signals ?? levels);
  const telegram = $derived(signals?.telegram ?? levels?.telegram);
  /** The Notifikasi menu lives on the Keputusan AI chart, which an engine symbol can open. */
  const toChart = $derived(!!ws.yahoo);

  const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 5 : 8 });
  const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const way = (l: Pick<PriceLevel, 'direction'>) => (l.direction === 'above' ? 'Naik ke' : 'Turun ke');

  function openChart() {
    ws.setChartView('ai');
    ws.showChart();
  }
</script>

<div class="flex flex-col gap-5 p-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex max-w-[70ch] flex-col gap-1 text-sm">
      <p>Semua notifikasi akunmu. Pasang yang baru dari tombol <strong>Notifikasi</strong> di chart Keputusan AI.</p>
      {#if allowance}
        <p class="text-xs text-base-content/70">{allowance.used} dari {allowance.max} notifikasi terpakai (harga dan sinyal).</p>
      {/if}
      {#if telegram && !telegram.bot}
        <p class="text-xs text-warning">
          {auth.isAdmin ? 'Bot Telegram server belum diisi (TELEGRAM_BOT_TOKEN).' : 'Notifikasi Telegram belum tersedia di server ini. Hubungi admin.'}
          {levels?.mail ? 'Notifikasi harga tetap dikirim lewat email.' : ''}
        </p>
      {:else if telegram && !telegram.chat}
        <p class="text-xs text-warning">Isi Chat ID Telegram-mu di menu akun → Profil → Notifikasi agar pesannya sampai.</p>
      {/if}
    </div>
    <div class="flex shrink-0 flex-wrap gap-2">
      {#if toChart}<button class="btn btn-sm" onclick={openChart}>Buka chart Keputusan AI</button>{/if}
      <button class="btn btn-ghost btn-sm" onclick={load}>Muat ulang</button>
    </div>
  </div>

  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if note}<p role="status" class="text-sm text-base-content/80">{note}</p>{/if}

  <section class="flex flex-col gap-1" aria-labelledby="alerts-price">
    <h3 id="alerts-price" class="text-sm font-semibold">Harga</h3>
    {#if !levels}
      {#if !error}<span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>{/if}
    {:else if !levels.items.length}
      <p class="text-sm text-base-content/70">Belum ada notifikasi harga.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Aset</th>
              <th>Kabari saat</th>
              <th>Status</th>
              <th><span class="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            {#each levels.items as l (l.id)}
              <tr>
                <td>
                  <button class="link link-hover font-mono font-semibold" onclick={() => ws.setSymbol(l.tvSymbol)}>{l.symbol}</button>
                  {#if l.label && l.label !== l.symbol}<span class="block text-xs text-base-content/70">{l.label}</span>{/if}
                </td>
                <td class="whitespace-nowrap tabular-nums">
                  <span class={l.direction === 'above' ? 'text-success' : 'text-error'}>{way(l)}</span>
                  <span class="font-semibold">{fmt(l.price)}</span>
                </td>
                <td class="text-xs">
                  {#if l.active}
                    <span class="badge badge-sm badge-ghost">Menunggu</span>
                  {:else}
                    Terpicu {l.triggeredAt ? when(l.triggeredAt) : ''}{l.triggeredPrice != null ? `, harga ${fmt(l.triggeredPrice)}` : ''}
                    {#if !l.notified}<span class="block text-warning">Pesannya tidak terkirim: Telegram atau email belum diatur.</span>{/if}
                  {/if}
                </td>
                <td class="text-right">
                  <button class="btn btn-ghost btn-xs" aria-label="Hapus notifikasi {l.symbol} {way(l).toLowerCase()} {fmt(l.price)}" onclick={() => removeLevel(l.id)}>
                    Hapus
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section class="flex flex-col gap-1" aria-labelledby="alerts-signal">
    <h3 id="alerts-signal" class="text-sm font-semibold">Sinyal</h3>
    {#if !signals}
      {#if !error}<span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>{/if}
    {:else if !signals.items.length}
      <p class="text-sm text-base-content/70">Belum ada notifikasi sinyal.</p>
    {:else}
      {#if creator}
        <p class="text-xs text-base-content/70">
          Nyalakan Publik agar sinyal baru alert itu tercatat di <a class="link" href="/c/{auth.user?.username}" target="_blank" rel="noopener">halaman rekam jejak</a>-mu.
        </p>
      {/if}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Aset</th>
              <th>Indikator</th>
              <th>Sinyal terakhir</th>
              {#if creator || signals.items.some((a) => a.public)}<th>Publik</th>{/if}
              <th><span class="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            {#each signals.items as a (a.id)}
              {@const name = indicatorName(a, signals.combos)}
              <tr>
                <td><button class="link link-hover font-mono font-semibold" onclick={() => ws.setSymbol(a.tvSymbol)}>{a.tvSymbol}</button></td>
                <td>
                  <span class="whitespace-nowrap">{name} {TIMEFRAME_LABELS[a.timeframe] ?? a.timeframe}</span>
                  {#if a.settingsPending}
                    <span class="block text-xs text-base-content/70" title="Sinyal yang sudah dikirim dipantau sampai selesai dengan pengaturan lama, lalu notifikasi memakai pengaturan Scalper yang baru.">
                      Pengaturan Scalper baru menyusul
                    </span>
                  {/if}
                </td>
                <td class="text-xs">
                  {#if a.last}
                    {a.last.label} · {SIGNAL_STATUS[a.last.status]}
                  {:else if !a.primed}
                    <span class="text-base-content/70">Menyiapkan…</span>
                  {:else}
                    <span class="text-base-content/70">Belum ada</span>
                  {/if}
                </td>
                {#if creator || signals.items.some((x) => x.public)}
                  <td>
                    {#if creator || a.public}
                      <input
                        type="checkbox"
                        class="toggle toggle-xs"
                        checked={a.public}
                        aria-label="Publikkan notifikasi {a.tvSymbol} {name}"
                        onchange={(e) => publish(a.id, e.currentTarget)}
                      />
                    {/if}
                  </td>
                {/if}
                <td class="text-right">
                  <button class="btn btn-ghost btn-xs" aria-label="Hapus notifikasi {a.tvSymbol} {name}" onclick={() => removeSignal(a.id)}>Hapus</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
