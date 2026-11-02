<script lang="ts">
  // Pantau → Analisa terjadwal (the server's watchlist, server/src/watch.ts): what
  // the server analyses on its own each trading day, the latest decision for each symbol, and
  // whether Telegram gets the summary. A symbol joins from the chart's Analisa harian button.
  import { auth } from '../../auth.svelte';
  import { formatDateTime, ratingBadge } from '../../format';
  import { usage } from '../../stores/usage.svelte';
  import { watch } from '../../stores/watch.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import StatusBadge from '../../StatusBadge.svelte';

  watch.load();
  usage.refresh();

  const DAY = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const w = $derived(watch.value);
  const daysLabel = $derived.by(() => {
    const d = [...(w?.schedule.days ?? [])].sort();
    if (!d.length) return '';
    const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    return run && d.length > 2 ? `${DAY[d[0]]}–${DAY[d[d.length - 1]]}` : d.map((x) => DAY[x]).join(', ');
  });
  const room = $derived(usage.left('analyses'));
</script>

<div class="flex flex-col gap-4 p-4">
  {#if !w}
    <p class="text-sm text-base-content/70">Memuat…</p>
  {:else}
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex max-w-[70ch] flex-col gap-1 text-sm">
        <p>
          Dianalisa otomatis setiap <strong>{daysLabel}</strong> pukul <strong>{w.schedule.time} WIB</strong>
          · berikutnya {formatDateTime(w.schedule.next)}.
        </p>
        <p class="text-xs text-base-content/70">
          Analis: {w.schedule.analysts.join(', ')} · kedalaman {w.schedule.depth} · model default server. Tiap simbol memakai satu
          kuota analisa harian{room !== Infinity ? ` (sisa hari ini ${room})` : ''}.
        </p>
        {#if w.telegram.configured}
          <p class="text-xs"><span class="status status-success status-xs" aria-hidden="true"></span> Ringkasan dikirim ke Telegram saat semua analisa selesai.</p>
        {:else if !w.telegram.bot}
          <p class="text-xs text-warning">
            {#if auth.isAdmin}Bot Telegram belum diatur di server (<code>TELEGRAM_BOT_TOKEN</code>).{:else}Notifikasi Telegram belum tersedia di server ini.{/if}
            Analisa tetap berjalan dan hasilnya ada di Riwayat.
          </p>
        {:else}
          <p class="text-xs text-warning">Isi chat ID Telegram-mu di menu akun → Profil untuk menerima ringkasan. Analisa tetap berjalan tanpa itu.</p>
        {/if}
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        {#if w.telegram.configured}
          <button class="btn btn-ghost btn-sm" onclick={() => watch.test()} disabled={watch.busy}>Kirim tes</button>
        {/if}
        <button
          class="btn btn-sm"
          onclick={() => watch.runNow()}
          disabled={watch.busy || !w.items.length || room === 0 || auth.unverified}
          title="Analisa semua simbol sekarang, di luar jadwal"
        >
          {#if watch.busy}<span class="loading loading-spinner loading-xs"></span>{/if}
          Jalankan sekarang · {w.items.length}
        </button>
      </div>
    </div>

    {#if watch.error}<p role="alert" class="text-sm text-error">{watch.error}</p>{/if}
    {#if watch.notice}<p role="status" class="text-sm text-success">{watch.notice}</p>{/if}

    {#if !w.items.length}
      <p class="text-sm text-base-content/70">
        Belum ada simbol. Buka chart sebuah saham, kripto, atau forex, lalu klik <strong>Analisa harian</strong> di atas chart (maksimal {w.max}).
      </p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Simbol</th>
              <th>Keputusan terakhir</th>
              <th>Status</th>
              <th>Dibuat</th>
              <th><span class="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            {#each w.items as item (item.symbol)}
              <tr>
                <td>
                  <button class="link link-hover font-mono font-semibold" onclick={() => ws.setSymbol(item.tvSymbol)}>{item.symbol}</button>
                </td>
                <td>
                  {#if item.last?.rating}
                    <button class="badge badge-sm {ratingBadge(item.last.rating)}" onclick={() => ws.openRun(item.last!.id, { symbol: item.tvSymbol })}>
                      {item.last.rating}
                    </button>
                    <span class="ml-1 text-xs tabular-nums text-base-content/70">{item.last.tradeDate}</span>
                  {:else}
                    <span class="text-base-content/70">–</span>
                  {/if}
                </td>
                <td>{#if item.last}<StatusBadge status={item.last.status} />{/if}</td>
                <td class="tabular-nums">{item.last ? formatDateTime(item.last.createdAt) : '–'}</td>
                <td class="text-right">
                  <button class="btn btn-ghost btn-xs" onclick={() => watch.toggle(item.symbol, item.tvSymbol)}>Hapus</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if w.lastRun}
      <p class="text-xs text-base-content/70">
        Putaran terjadwal terakhir {w.lastRun.day}: {w.lastRun.analysisIds.length} analisa{w.lastRun.skipped.length
          ? `, ${w.lastRun.skipped.length} dilewati (kuota)`
          : ''}{w.telegram.configured ? (w.lastRun.notifiedAt ? ', ringkasan terkirim' : ', ringkasan belum terkirim') : ''}.
      </p>
    {/if}
  {/if}
</div>
