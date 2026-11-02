<script lang="ts">
  // Pantau → Jurnal: the trades the member took (server/src/journal.ts). First what the trades that
  // closed in the period add up to (how many paid, total and mean R, by mood and by source, so a
  // pattern like "trades on FOMO lose" shows), then the trades still running, which the server closes
  // at TP or SL and the owner can close at a price or drop, then the closed ones. Most trades come
  // from the chart's plan card ("Saya ambil"); the form here notes one by hand on the asset in focus.
  import { api, type Journal, type JournalGroup, type JournalMood, type JournalTrade } from '../../api';
  import { friendlyName } from '../../beginner/plain';
  import { MOOD_LABEL, signedR, STATUS_LABEL } from '../../journalLabels';
  import MoodPicker from '../../MoodPicker.svelte';
  import { ws } from '../../stores/workspace.svelte';

  const PERIODS = [7, 30, 90] as const;
  let days = $state<number>(30);
  let data = $state<Journal | null>(null);
  let error = $state('');
  let note = $state('');

  async function load() {
    try {
      data = await api.journal(days);
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // Refreshed each minute, so a trade the price check settled shows as settled.
  $effect(() => {
    void days;
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  const running = $derived(data?.items.filter((t) => t.status === 'open') ?? []);
  const finished = $derived(data?.items.filter((t) => t.status !== 'open') ?? []);

  // --- A trade noted by hand, on the asset in focus.
  let adding = $state(false);
  let side = $state<'BUY' | 'SELL'>('BUY');
  let entry = $state<number | null>(null);
  let stopLoss = $state<number | null>(null);
  let takeProfit = $state<number | null>(null);
  let mood = $state<JournalMood | null>(null);
  let memo = $state('');
  let busy = $state(false);

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!ws.yahoo || entry == null || stopLoss == null || takeProfit == null) return;
    busy = true;
    note = '';
    try {
      await api.journalAdd({ symbol: ws.yahoo, tvSymbol: ws.symbol, side, entry, stopLoss, takeProfit, source: 'manual', mood: mood ?? undefined, note: memo.trim() || undefined });
      entry = stopLoss = takeProfit = null;
      mood = null;
      memo = '';
      adding = false;
      note = 'Trade tercatat. Jurnal menutupnya otomatis saat harga menyentuh TP atau SL.';
      await load();
    } catch (err) {
      note = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  // --- Closing a running trade at a price, or dropping one never taken.
  let closing = $state<string | null>(null);
  let exit = $state<number | null>(null);

  async function act(run: () => Promise<unknown>) {
    note = '';
    try {
      await run();
      closing = null;
      exit = null;
    } catch (err) {
      note = (err as Error).message;
    }
    await load();
  }
  const close = (t: JournalTrade) => exit != null && act(() => api.journalUpdate(t.id, { close: { price: exit! } }));
  const drop = (t: JournalTrade) => act(() => api.journalUpdate(t.id, { cancel: true }));
  const remove = (t: JournalTrade) => act(() => api.journalRemove(t.id));

  const fmt = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 5 : 8 });
  const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const tone = (r: number) => (r > 0 ? 'text-success' : r < 0 ? 'text-error' : '');
  const sideName = (t: Pick<JournalTrade, 'side'>) => (t.side === 'BUY' ? 'Beli' : 'Jual');
  const sourceName = (t: JournalTrade) => t.label ?? (t.source === 'manual' ? 'Diisi sendiri' : t.source);
  const money = (t: JournalTrade) => (t.riskIdr && t.r != null ? `${t.r >= 0 ? '+' : '−'}Rp ${Math.round(Math.abs(t.r * t.riskIdr)).toLocaleString('id-ID')}` : '');
  const groupText = (g: JournalGroup, name: string) => `${name} ${signedR(g.totalR)} (${g.n} trade, ${Math.round((g.wins / g.n) * 100)}% untung)`;
</script>

<div class="flex flex-col gap-5 p-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex max-w-[70ch] flex-col gap-1 text-sm">
      <p>
        Catatan trade yang kamu ambil. Tambahkan dari kartu <strong>Rencana</strong> di chart (tombol Saya ambil), atau isi sendiri. Trade berjalan selesai otomatis saat
        harga menyentuh TP atau SL, dicek tiap menit dari candle 15 menit.
      </p>
      {#if data}
        <p class="text-xs text-base-content/70">{data.open} dari {data.max} trade berjalan terpakai.</p>
        {#if !data.telegram.bot}
          <p class="text-xs text-base-content/70">Kabar TP/SL dan rekap mingguan lewat Telegram belum tersedia di server ini.</p>
        {:else if !data.telegram.chat}
          <p class="text-xs text-warning">Hubungkan Telegram di menu akun → Profil agar dikabari saat TP atau SL kena, dan dapat rekap jurnal tiap Minggu malam.</p>
        {:else}
          <p class="text-xs text-base-content/70">Kabar TP/SL dan rekap jurnal tiap Minggu pukul 19.00 WIB dikirim ke Telegram-mu.</p>
        {/if}
      {/if}
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <select class="select select-sm w-auto" aria-label="Periode jurnal" bind:value={days}>
        {#each PERIODS as p (p)}<option value={p}>{p} hari</option>{/each}
      </select>
      <button class="btn btn-sm" class:btn-primary={!adding} aria-expanded={adding} onclick={() => (adding = !adding)}>{adding ? 'Tutup form' : 'Catat trade'}</button>
    </div>
  </div>

  {#if adding}
    <form class="flex flex-col gap-3 rounded-box border border-base-300 p-3" onsubmit={add} aria-label="Catat trade">
      <p class="text-sm">
        Aset: <strong>{friendlyName(ws.symbol)}</strong> <span class="font-mono text-xs text-base-content/70">{ws.symbol}</span>
        <span class="text-xs text-base-content/70">· ganti aset dari kotak cari di atas</span>
      </p>
      {#if !ws.yahoo}<p class="text-xs text-warning">Harga aset ini belum bisa dipantau, jadi belum bisa dicatat di jurnal.</p>{/if}
      <div class="flex flex-wrap items-end gap-3">
        <div class="join" role="group" aria-label="Arah">
          <button type="button" class="btn btn-sm join-item" class:btn-active={side === 'BUY'} aria-pressed={side === 'BUY'} onclick={() => (side = 'BUY')}>Beli</button>
          <button type="button" class="btn btn-sm join-item" class:btn-active={side === 'SELL'} aria-pressed={side === 'SELL'} onclick={() => (side = 'SELL')}>Jual</button>
        </div>
        <label class="flex flex-col gap-0.5 text-xs">
          Entry
          <input class="input input-sm w-32 tabular-nums" type="number" step="any" min="0" required bind:value={entry} />
        </label>
        <label class="flex flex-col gap-0.5 text-xs">
          SL
          <input class="input input-sm w-32 tabular-nums" type="number" step="any" min="0" required bind:value={stopLoss} />
        </label>
        <label class="flex flex-col gap-0.5 text-xs">
          TP
          <input class="input input-sm w-32 tabular-nums" type="number" step="any" min="0" required bind:value={takeProfit} />
        </label>
      </div>
      <div class="flex flex-col gap-1 text-xs">
        <span>Perasaan saat masuk (boleh dikosongkan)</span>
        <MoodPicker bind:value={mood} size="sm" />
      </div>
      <label class="flex flex-col gap-0.5 text-xs">
        Catatan
        <textarea class="textarea textarea-sm" rows="2" maxlength="500" placeholder="Alasan masuk, rencana keluar" bind:value={memo}></textarea>
      </label>
      <div><button class="btn btn-sm btn-primary" disabled={busy || !ws.yahoo}>Simpan ke jurnal</button></div>
    </form>
  {/if}

  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if note}<p role="status" class="text-sm text-base-content/80">{note}</p>{/if}

  {#if !data}
    {#if !error}<span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>{/if}
  {:else}
    {@const s = data.summary}
    <section class="flex flex-col gap-2" aria-labelledby="journal-summary">
      <h3 id="journal-summary" class="text-sm font-semibold">Hasil {data.days} hari</h3>
      {#if !s.closed}
        <p class="text-sm text-base-content/70">Belum ada trade yang selesai dalam {data.days} hari terakhir.</p>
      {:else}
        <!-- Two by two on a phone, one row from sm up; the gap over the border colour draws the hairlines. -->
        <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-box border border-base-300 bg-base-300 sm:grid-cols-4">
          <div class="bg-base-100 px-4 py-3">
            <dt class="text-xs text-base-content/70">Selesai</dt>
            <dd class="text-2xl font-semibold tabular-nums">{s.closed}</dd>
          </div>
          <div class="bg-base-100 px-4 py-3">
            <dt class="text-xs text-base-content/70">Untung</dt>
            <dd class="text-2xl font-semibold tabular-nums">{Math.round((s.winRate ?? 0) * 100)}%</dd>
            <dd class="text-xs text-base-content/70">{s.wins} dari {s.closed} trade</dd>
          </div>
          <div class="bg-base-100 px-4 py-3">
            <dt class="text-xs text-base-content/70">Total</dt>
            <dd class="text-2xl font-semibold tabular-nums {tone(s.totalR)}">{signedR(s.totalR)}</dd>
          </div>
          <div class="bg-base-100 px-4 py-3">
            <dt class="text-xs text-base-content/70">Rata-rata per trade</dt>
            <dd class="text-2xl font-semibold tabular-nums {tone(s.avgR ?? 0)}">{signedR(s.avgR ?? 0)}</dd>
          </div>
        </dl>
        {#if s.byMood.some((g) => g.key)}
          <p class="text-sm">
            <span class="text-base-content/70">Per perasaan:</span>
            {s.byMood
              .filter((g) => g.key)
              .map((g) => groupText(g, MOOD_LABEL[g.key as JournalMood]))
              .join(' · ')}
          </p>
        {/if}
        <p class="text-sm"><span class="text-base-content/70">Per sumber:</span> {s.bySource.map((g) => groupText(g, g.key === 'manual' ? 'Diisi sendiri' : g.key)).join(' · ')}</p>
        <p class="text-xs text-base-content/70">R adalah risiko satu trade (jarak entry ke SL): +2,0R berarti untung dua kali risikonya, −1,0R berarti rugi sebesar risikonya.</p>
      {/if}
    </section>

    <section class="flex flex-col gap-1" aria-labelledby="journal-running">
      <h3 id="journal-running" class="text-sm font-semibold">Berjalan</h3>
      {#if !running.length}
        <p class="text-sm text-base-content/70">Tidak ada trade berjalan.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Aset</th>
                <th>Rencana</th>
                <th>Sumber</th>
                <th>Dicatat</th>
                <th><span class="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              {#each running as t (t.id)}
                <tr>
                  <td>
                    <button class="link link-hover font-mono font-semibold" onclick={() => ws.setSymbol(t.tvSymbol)}>{t.tvSymbol}</button>
                    <span class="badge badge-sm badge-soft ml-1 {t.side === 'BUY' ? 'badge-success' : 'badge-error'}">{sideName(t)}</span>
                  </td>
                  <td class="whitespace-nowrap tabular-nums">
                    {fmt(t.entry)} · SL <span class="text-error">{fmt(t.stopLoss)}</span> · TP <span class="text-success">{fmt(t.takeProfit)}</span>
                  </td>
                  <td class="text-xs">
                    {sourceName(t)}{#if t.mood}<span class="block text-base-content/70">{MOOD_LABEL[t.mood]}</span>{/if}
                  </td>
                  <td class="text-xs whitespace-nowrap">{when(t.openedAt)}</td>
                  <td class="text-right">
                    {#if closing === t.id}
                      <form class="flex items-center justify-end gap-1" onsubmit={(e) => (e.preventDefault(), close(t))}>
                        <input class="input input-xs w-28 tabular-nums" type="number" step="any" min="0" required aria-label="Harga keluar {t.tvSymbol}" bind:value={exit} />
                        <button class="btn btn-xs">Simpan</button>
                        <button type="button" class="btn btn-ghost btn-xs" onclick={() => (closing = null)}>Batal</button>
                      </form>
                    {:else}
                      <span class="flex justify-end gap-1">
                        <button class="btn btn-xs" onclick={() => ((closing = t.id), (exit = null))}>Tutup di harga…</button>
                        <button class="btn btn-ghost btn-xs" title="Trade ini ternyata tidak diambil: tidak dihitung di hasil" onclick={() => drop(t)}>Tidak jadi</button>
                      </span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="flex flex-col gap-1" aria-labelledby="journal-finished">
      <h3 id="journal-finished" class="text-sm font-semibold">Selesai</h3>
      {#if !finished.length}
        <p class="text-sm text-base-content/70">Belum ada trade selesai dalam {data.days} hari terakhir.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Aset</th>
                <th>Hasil</th>
                <th>Selesai</th>
                <th>Sumber</th>
                <th>Catatan</th>
                <th><span class="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              {#each finished as t (t.id)}
                <tr>
                  <td>
                    <button class="link link-hover font-mono font-semibold" onclick={() => ws.setSymbol(t.tvSymbol)}>{t.tvSymbol}</button>
                    <span class="block text-xs text-base-content/70">{sideName(t)} di {fmt(t.entry)}</span>
                  </td>
                  <td class="whitespace-nowrap">
                    {#if t.r != null}
                      <span class="font-semibold tabular-nums {tone(t.r)}">{signedR(t.r)}</span>
                      {#if money(t)}<span class="block text-xs tabular-nums text-base-content/70">{money(t)}</span>{/if}
                    {:else}
                      <span class="text-base-content/70">—</span>
                    {/if}
                  </td>
                  <td class="text-xs">
                    {STATUS_LABEL[t.status]}{t.exitPrice != null ? ` di ${fmt(t.exitPrice)}` : ''}
                    {#if t.closedAt}<span class="block text-base-content/70">{when(t.closedAt)}</span>{/if}
                  </td>
                  <td class="text-xs">
                    {sourceName(t)}{#if t.mood}<span class="block text-base-content/70">{MOOD_LABEL[t.mood]}</span>{/if}
                  </td>
                  <td class="max-w-64 text-xs">{t.note ?? ''}</td>
                  <td class="text-right">
                    <button class="btn btn-ghost btn-xs" aria-label="Hapus trade {t.tvSymbol} dari jurnal" onclick={() => remove(t)}>Hapus</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</div>
