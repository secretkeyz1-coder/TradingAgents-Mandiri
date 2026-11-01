<script lang="ts">
  // Notifications for the symbol in focus: a message when the price reaches a level
  // (PriceLevels, from the chart's last price), and Telegram messages for new signals:
  // switch PoB BYSTRA (15m, 1h) and Scalper Pro+ (15m) on or off, see every alert of
  // the account, send a test message. The server does the scanning. Crypto is
  // watched on the venue the chart shows (the Bursa menu): its own bars. On
  // Creator, an alert can be made public: its live signals go on the account's
  // track record at /c/<username> (server/src/creators.ts).
  import { api, type SignalAlert, type SignalAlerts } from '../api';
  import { auth } from '../auth.svelte';
  import PriceLevels from '../PriceLevels.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { CRYPTO_VENUES, nameOf, type VenueId } from '../tv';
  import { placeMenu } from './menuSide';

  let { symbol, venue = null, last = null }: { symbol: string; venue?: VenueId | null; last?: number | null } = $props();

  /** The venue as alerts store it: "" for the default source. */
  const here = $derived(venue && venue !== 'binance' ? venue : '');
  const venueLabel = $derived(venue ? (CRYPTO_VENUES.find((v) => v.id === venue)?.label ?? venue) : '');

  let open = $state(false);
  let place = $state({ rightward: false, maxHeight: 0 });
  let data = $state<SignalAlerts | null>(null);
  let error = $state('');
  let note = $state('');
  let busy = $state(false);
  let root: HTMLDivElement | undefined = $state();

  async function load() {
    try {
      data = await api.alerts();
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  $effect(() => {
    if (open) load();
  });
  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });

  const mine = (indicator: string, timeframe: string) =>
    data?.items.find((a) => a.symbol === symbol.toUpperCase() && (a.venue ?? '') === here && a.indicator === indicator && a.timeframe === timeframe);
  const activeHere = $derived(data ? data.items.filter((a) => a.symbol === symbol.toUpperCase() && (a.venue ?? '') === here).length : 0);

  async function toggle(indicator: SignalAlert['indicator'], timeframe: SignalAlert['timeframe']) {
    busy = true;
    note = '';
    try {
      const existing = mine(indicator, timeframe);
      if (existing) await api.removeAlert(existing.id);
      else await api.addAlert({ symbol, tvSymbol: ws.symbol, indicator, timeframe });
      await load();
    } catch (e) {
      note = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
    note = '';
    await api.removeAlert(id).catch((e) => (note = (e as Error).message));
    await load();
  }

  /** Turning an alert private stops new entries; what is already on the track record stays. */
  const creator = $derived(auth.user?.plan === 'creator');
  async function publish(id: string, box: HTMLInputElement) {
    note = '';
    try {
      await api.setAlertPublic(id, box.checked);
      note = box.checked ? 'Sinyal baru dari alert ini akan tercatat di halaman rekam jejak Anda.' : 'Alert ini privat lagi. Sinyal yang sudah tercatat tetap tampil.';
    } catch (e) {
      box.checked = !box.checked;
      note = (e as Error).message;
    }
    await load();
  }

  async function test() {
    note = '';
    try {
      await api.testAlert();
      note = 'Pesan tes terkirim. Cek Telegram Anda.';
    } catch (e) {
      note = (e as Error).message;
    }
  }

  const STATUS: Record<string, string> = { open: 'berjalan', win: 'TP kena', loss: 'SL kena', exit: 'keluar (kondisi)', expired: 'kedaluwarsa', replaced: 'diganti' };
  const NAME: Record<string, string> = { pob: 'PoB BYSTRA', scalper: 'Scalper Pro+', fib: 'Fib Golden Zone' };
  const TF: Record<string, string> = { '15m': '15m', '1h': '1j', '4h': '4j', '1d': 'harian' };
</script>

<div class="relative" bind:this={root}>
  <button
    class="btn btn-xs gap-1"
    class:btn-active={open}
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => {
      if (!open && root) place = placeMenu(root, 22);
      open = !open;
    }}
  >
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
    Notifikasi{#if activeHere}<span class="badge badge-xs badge-accent">{activeHere}</span>{/if}
  </button>
  {#if open}
    <div
      class="ta-pop absolute top-full {place.rightward ? 'left-0' : 'right-0'} z-40 mt-1 flex w-88 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-box border border-base-300 bg-base-100 p-3 text-sm shadow-xl"
      style:max-height="{place.maxHeight}px"
      role="dialog"
      aria-label="Notifikasi"
    >
      <h3 class="font-semibold">Notifikasi · <span class="font-mono">{symbol}</span>{venueLabel ? ` · ${venueLabel}` : ''}</h3>
      {#if error}
        <p class="text-xs text-error" role="alert">{error}</p>
      {:else if !data}
        <span class="loading loading-spinner loading-sm"></span>
      {:else}
        {#if !data.telegram.bot}
          <p class="text-xs text-warning">{auth.isAdmin ? 'Bot Telegram server belum diisi (TELEGRAM_BOT_TOKEN).' : 'Notifikasi Telegram belum tersedia di server ini. Hubungi admin.'}</p>
        {:else if !data.telegram.chat}
          <p class="text-xs text-warning">Isi Chat ID Telegram Anda di menu akun → Profil → Notifikasi, lalu kembali ke sini.</p>
        {/if}
        <section class="flex flex-col gap-2" aria-label="Notifikasi harga">
          <h4 class="text-xs font-semibold text-base-content/70">Harga</h4>
          <PriceLevels {symbol} tvSymbol={ws.symbol} label={nameOf(ws.symbol) ?? symbol} {last} />
        </section>
        <h4 class="border-t border-base-300 pt-2 text-xs font-semibold text-base-content/70">Sinyal</h4>
        <div class="flex flex-col gap-1.5">
          {#each data.combos as combo (combo.indicator + combo.timeframe)}
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                checked={!!mine(combo.indicator, combo.timeframe)}
                disabled={busy}
                onchange={() => toggle(combo.indicator, combo.timeframe)}
              />
              {combo.label}
            </label>
          {/each}
        </div>
        <p class="text-xs text-base-content/70">
          Dicek tiap 5 menit (1j: tiap 15 menit), hanya dari candle yang sudah tutup, dengan mesin yang sama dengan chart. Scalper Pro+ memakai
          pengaturan Scalper Anda di chart. Sinyal yang sudah ada saat notifikasi dinyalakan tidak dikirim.
          {#if venueLabel}Memakai candle {venueLabel} (real-time); ganti bursa di menu Bursa untuk notifikasi dari bursa lain.{:else}Harga Yahoo bisa tertunda beberapa menit.{/if}
        </p>
        {#if data.items.length}
          <div class="flex flex-col gap-1 border-t border-base-300 pt-2">
            <span class="text-xs text-base-content/70">Semua notifikasi sinyal Anda ({data.items.length}; {data.used}/{data.max} terpakai bersama notifikasi harga)</span>
            {#if creator}
              <span class="text-xs text-base-content/70">
                Nyalakan Publik agar sinyal baru alert itu tercatat di <a class="link" href="/c/{auth.user?.username}" target="_blank" rel="noopener">halaman rekam jejak</a> Anda.
              </span>
            {/if}
            {#each data.items as a (a.id)}
              <div class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate">
                  <span class="font-mono">{a.tvSymbol}</span> · {NAME[a.indicator] ?? data.combos.find((x) => x.indicator === a.indicator)?.label.replace(/ \S+$/, '') ?? 'Skrip'} {TF[a.timeframe] ?? a.timeframe}
                  {#if a.last}<span class="block truncate text-base-content/70">{a.last.label} · {STATUS[a.last.status]}</span>{:else if !a.primed}<span class="block text-base-content/70">menyiapkan…</span>{/if}
                  {#if a.settingsPending}
                    <span class="block truncate text-base-content/70" title="Sinyal yang sudah dikirim dipantau sampai selesai dengan pengaturan lama, lalu notifikasi memakai pengaturan Scalper yang baru.">
                      Pengaturan Scalper baru menyusul
                    </span>
                  {/if}
                </span>
                {#if creator || a.public}
                  <label class="flex shrink-0 cursor-pointer items-center gap-1" title="Tampilkan sinyal baru alert ini di halaman rekam jejak publik Anda">
                    <input
                      type="checkbox"
                      class="toggle toggle-xs"
                      checked={a.public}
                      aria-label="Publikkan notifikasi {a.tvSymbol} {NAME[a.indicator] ?? ''}"
                      onchange={(e) => publish(a.id, e.currentTarget)}
                    />
                    Publik
                  </label>
                {/if}
                <button class="btn btn-ghost btn-xs" aria-label="Hapus notifikasi {a.tvSymbol} {NAME[a.indicator]}" onclick={() => remove(a.id)}>Hapus</button>
              </div>
            {/each}
          </div>
        {/if}
        <button class="btn btn-sm" disabled={!data.telegram.configured} onclick={test}>Kirim pesan tes</button>
      {/if}
      {#if note}<p class="text-xs text-base-content/80" role="status">{note}</p>{/if}
    </div>
  {/if}
</div>
