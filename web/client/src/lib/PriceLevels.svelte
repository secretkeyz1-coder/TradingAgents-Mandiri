<script lang="ts">
  // "Kabari saya saat harga menyentuh X" for one asset (server/src/price-alerts.ts): add a
  // level, see the ones waiting and the last that fired, remove one. The direction follows the
  // price now (`last`): a level above it waits for a rise, one below for a fall, and the line
  // under the box says which before it is added. Used by Pemula's Kabari saya card and the
  // chart's Notifikasi menu.
  import { api, type PriceLevel, type PriceLevels } from './api';

  let { symbol, tvSymbol, label, last = null }: { symbol: string; tvSymbol: string; label: string; last?: number | null } = $props();

  let data = $state<PriceLevels | null>(null);
  let text = $state('');
  let busy = $state(false);
  let error = $state('');

  async function load(asset: string) {
    try {
      const next = await api.priceLevels(asset);
      if (asset === symbol) data = next;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // The asset's levels, refreshed each minute so a fired one shows as fired.
  $effect(() => {
    const asset = symbol;
    data = null;
    error = '';
    text = '';
    load(asset);
    const timer = setInterval(() => load(asset), 60_000);
    return () => clearInterval(timer);
  });

  /**
   * A typed price, read the way it was likely meant: with dots as thousands and a decimal comma
   * (4.100,5) or the other way round (4,100.5), whichever lands nearer the price now, so "4.100"
   * is four thousand next to 3.900 and "1.0834" a decimal next to 1,08.
   */
  function parse(raw: string, near: number | null): number | null {
    const t = raw.replace(/\s|rp|us\$|\$/gi, '');
    if (!/^\d[\d.,]*$/.test(t)) return null;
    const read = (thousands: string, decimal: string) => Number(t.split(thousands).join('').replace(decimal, '.'));
    const ways = [read('.', ','), read(',', '.')].filter((v) => Number.isFinite(v) && v > 0);
    if (!ways.length) return null;
    if (!near || ways.length === 1) return ways[0];
    const off = (v: number) => Math.abs(Math.log(v / near));
    return off(ways[1]) < off(ways[0]) ? ways[1] : ways[0];
  }

  const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 5 : 8 });
  const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const value = $derived(parse(text, last));
  /** A level that reads the same as the price now (3.898,9 typed for 3.898,87) is the price now. */
  const same = $derived(value != null && last != null && fmt(value) === fmt(last));
  const rise = $derived(value != null && last != null ? value > last : null);
  /** Levels on crypto and gold are read live from Binance (server/src/binance.ts), the rest late from Yahoo. */
  const live = $derived(/-(USD|USDT|USDC)$/i.test(symbol) || symbol.toUpperCase() === 'GC=F');
  const channels = $derived([data?.telegram.configured && 'Telegram', data?.mail && 'email'].filter(Boolean).join(' dan '));
  const waiting = $derived(data?.items.filter((l) => l.active) ?? []);
  const fired = $derived(data?.items.filter((l) => !l.active).slice(0, 3) ?? []);
  const full = $derived(!!data && data.used >= data.max);
  const silent = $derived(!!data && !data.telegram.configured && !data.mail);

  const way = (l: Pick<PriceLevel, 'direction'>) => (l.direction === 'above' ? 'Naik ke' : 'Turun ke');

  async function add(event: SubmitEvent) {
    event.preventDefault();
    if (value == null) return;
    busy = true;
    error = '';
    try {
      await api.priceLevelAdd({ symbol, tvSymbol, price: value, label });
      text = '';
      await load(symbol);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
    error = '';
    try {
      await api.priceLevelRemove(id);
      await load(symbol);
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<div class="flex flex-col gap-2">
  <form class="flex flex-col gap-1.5" onsubmit={add}>
    <label class="text-sm" for="level-{symbol}">Kabari saya saat harga {label} menyentuh</label>
    <div class="join w-full">
      <input
        id="level-{symbol}"
        class="input input-sm join-item w-full tabular-nums"
        inputmode="decimal"
        autocomplete="off"
        placeholder={last != null ? `mis. ${fmt(last)}` : 'Harga'}
        disabled={full}
        bind:value={text}
      />
      <button class="btn btn-sm join-item" type="submit" disabled={busy || value == null || same || full}>
        {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
        Pasang
      </button>
    </div>
    <p class="text-xs text-base-content/70" aria-live="polite">
      {#if full}
        Semua jatah notifikasi paketmu ({data?.max}) sudah terpakai. Hapus satu dulu atau naikkan paket.
      {:else if same}
        Itu harga sekarang. Pilih harga di atas atau di bawahnya.
      {:else if value != null && rise != null}
        Kabari saat {rise ? 'naik' : 'turun'} ke {fmt(value)} (sekarang {fmt(last!)}).
      {:else if text.trim() && value == null}
        Tulis angka saja, mis. 4.100 atau 0,52.
      {:else}
        Dikirim sekali{channels ? ` lewat ${channels}` : ''}, lalu selesai.
      {/if}
    </p>
  </form>

  {#if error}<p role="alert" class="text-xs text-error">{error}</p>{/if}

  {#if waiting.length}
    <ul class="flex flex-col gap-1" aria-label="Notifikasi harga yang menunggu">
      {#each waiting as l (l.id)}
        <li class="flex items-center justify-between gap-2 text-sm">
          <span>
            <span class={l.direction === 'above' ? 'text-success' : 'text-error'} aria-hidden="true">{l.direction === 'above' ? '▲' : '▼'}</span>
            {way(l)} <strong class="font-semibold tabular-nums">{fmt(l.price)}</strong>
          </span>
          <button class="btn btn-ghost btn-xs" aria-label="Hapus notifikasi {way(l).toLowerCase()} {fmt(l.price)}" onclick={() => remove(l.id)}>Hapus</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if fired.length}
    <ul class="flex flex-col gap-1 text-xs text-base-content/70" aria-label="Notifikasi harga yang sudah terpicu">
      {#each fired as l (l.id)}
        <li class="flex items-center justify-between gap-2">
          <span>
            Terpicu {l.triggeredAt ? when(l.triggeredAt) : ''}: {way(l).toLowerCase()} {fmt(l.price)}{l.triggeredPrice != null ? `, harga ${fmt(l.triggeredPrice)}` : ''}{l.notified
              ? ''
              : '. Pesannya tidak terkirim: Telegram atau email belum diatur'}
          </span>
          <button class="btn btn-ghost btn-xs" aria-label="Hapus catatan {way(l).toLowerCase()} {fmt(l.price)}" onclick={() => remove(l.id)}>Hapus</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if data}
    <p class="text-xs text-base-content/70">
      {data.used} dari {data.max} notifikasi terpakai (harga dan sinyal).
      {#if !live}Harga aset ini tertunda, jadi notifikasinya bisa terlambat.{/if}
      {#if silent}
        <span class="text-warning">
          {data.telegram.bot
            ? 'Hubungkan Telegram di Profil → Notifikasi agar pesannya sampai.'
            : 'Server ini belum bisa mengirim pesan (Telegram dan email belum diatur), jadi notifikasi hanya tercatat di sini.'}
        </span>
      {/if}
    </p>
  {/if}
</div>
