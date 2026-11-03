<script lang="ts">
  // Pantau → Pantauanku (server/src/watch.ts): what the server analyses on its own each trading day. The schedule
  // on the side: when, this week's days, what the AI reads, the Telegram summary and a run outside the schedule.
  // The assets as cards: the price over a month and the AI's last call, which a run that failed or is still going
  // does not hide (the server keeps the decision and the last attempt apart). Removing one acts at once and can be
  // undone. A symbol joins from the star on the chart's head or the market list, or here: the asset opened last,
  // or the well-known ones Beranda offers.
  import { api, type Quote, type Watchlist } from '../../api';
  import { auth } from '../../auth.svelte';
  import { friendlyName, priceText, STARTERS } from '../../beginner/plain';
  import { formatDateTime, formatDay, formatWhen, today } from '../../format';
  import { callOf, dirOf, marketName, monogram, percentText, sparkPath } from '../../marks';
  import { catalog } from '../../stores/catalog.svelte';
  import { jobs } from '../../stores/jobs.svelte';
  import { usage } from '../../stores/usage.svelte';
  import { watch } from '../../stores/watch.svelte';
  import { ws } from '../../stores/workspace.svelte';
  import { assetCode, toYahoo } from '../../tv';
  import VerifyNote from '../../VerifyNote.svelte';
  import { STANDARD_DEPTH, STANDARD_LANGUAGE, standardAnalysts } from '../../../../../shared/analysis';
  import Icon from '../Icon.svelte';

  type Item = Watchlist['items'][number];

  usage.refresh();
  catalog.load();

  const DAY = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  /** The engine's analyst teams in a member's words; members always run on the server's model, so it goes unnamed. */
  const ANALYSTS: Record<string, string> = { market: 'pasar', social: 'sentimen', news: 'berita', fundamentals: 'fundamental' };
  const w = $derived(watch.value);
  const room = $derived(usage.left('analyses'));
  const daysLabel = $derived.by(() => {
    const d = [...(w?.schedule.days ?? [])].sort();
    if (!d.length) return '';
    const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    return run && d.length > 2 ? `${DAY[d[0]]}–${DAY[d[d.length - 1]]}` : d.map((x) => DAY[x]).join(', ');
  });

  /** This week's scheduled days, Monday first: done when the last scheduled round ran that day, today, or to come. */
  const week = $derived.by(() => {
    if (!w) return [];
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const midnight = Date.parse(`${todayIso}T00:00:00Z`);
    const weekday = ((new Date(midnight).getUTCDay() + 6) % 7) + 1;
    return [...w.schedule.days].sort().map((d) => {
      const iso = new Date(midnight + (d - weekday) * 86_400_000).toISOString().slice(0, 10);
      const state = w.lastRun?.day === iso ? 'done' : iso === todayIso ? 'today' : iso < todayIso ? 'past' : 'next';
      return { iso, name: DAY[d], date: formatDay(iso), state };
    });
  });

  // Prices and a month of closes for the cards, each minute while the tab is open (keyed by the symbols, so a list
  // refresh that changes nothing does not refetch).
  const symbols = $derived(w?.items.map((i) => i.symbol).join(',') ?? '');
  let quotes = $state<Record<string, Quote | null>>({});
  $effect(() => {
    const list = symbols ? symbols.split(',') : [];
    if (!list.length) return;
    const load = () =>
      api
        .quotes(list, true)
        .then((r) => (quotes = r.quotes))
        .catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  });

  /** What to add: the asset opened last when it can be analysed, then the well-known ones, none already here. */
  const suggestions = $derived.by(() => {
    const out: { tv: string; yahoo: string; name: string; recent: boolean }[] = [];
    const add = (tv: string, recent: boolean) => {
      const yahoo = toYahoo(tv);
      if (yahoo && !watch.has(yahoo) && !out.some((s) => s.yahoo === yahoo)) out.push({ tv, yahoo, name: friendlyName(tv), recent });
    };
    if (ws.recent[0]) add(ws.recent[0], true);
    for (const [tv] of STARTERS) add(tv, false);
    return out.slice(0, 6);
  });

  // --- Removing one acts at once; the line under the heading brings it back.
  let removed = $state<{ symbol: string; tvSymbol: string; name: string } | null>(null);
  async function remove(item: Item) {
    await watch.toggle(item.symbol, item.tvSymbol);
    if (!watch.error) removed = { symbol: item.symbol, tvSymbol: item.tvSymbol, name: friendlyName(item.tvSymbol) };
  }
  async function undo() {
    if (!removed) return;
    const back = removed;
    removed = null;
    await watch.toggle(back.symbol, back.tvSymbol);
  }

  // --- A run that failed is tried again on its own, as the standard analysis on the server's models.
  let retrying = $state<string | null>(null);
  let retryError = $state('');
  async function retry(item: Item) {
    const d = catalog.value?.defaults;
    if (!d) return;
    retrying = item.symbol;
    retryError = '';
    try {
      await api.create({
        ticker: item.symbol,
        date: today(),
        analysts: standardAnalysts([item.symbol]),
        depth: STANDARD_DEPTH,
        language: STANDARD_LANGUAGE,
        provider: d.provider,
        quickModel: d.quickModel,
        deepModel: d.deepModel,
        backendUrl: d.backendUrl ?? undefined,
      });
      await jobs.refresh();
      usage.refresh();
      watch.load();
    } catch (e) {
      retryError = (e as Error).message;
    } finally {
      retrying = null;
    }
  }

  function openLog(id: string, tv: string) {
    ws.openRun(id, { symbol: tv });
    ws.setDock('log');
  }

  const cost = (n: number) =>
    room === 0
      ? 'Kuota analisa hari ini habis; terisi lagi pukul 00.00 WIB.'
      : Number.isFinite(room)
        ? `Di luar jadwal; memakai ${n} dari ${room} kuota analisa yang tersisa hari ini.`
        : `Di luar jadwal; memakai ${n} kuota analisa.`;
</script>

{#if !w}
  <div class="flex flex-col gap-4 p-4 sm:p-6 lg:flex-row" aria-busy="true">
    <div class="flex flex-1 flex-col gap-3"><div class="skeleton h-28 w-full"></div><div class="skeleton h-28 w-full"></div></div>
    <div class="skeleton h-96 w-full lg:w-[22rem]"></div>
  </div>
{:else}
  <div class="flex flex-col gap-5 p-4 sm:p-6 lg:flex-row lg:items-start">
    <section class="flex min-w-0 flex-1 flex-col gap-3" aria-labelledby="assets-title">
      <h2 id="assets-title" class="ta-section-title">Asetmu <span class="text-base font-normal ta-muted">{w.items.length} dari {w.max}</span></h2>
      {#if removed}
        <div role="status" class="flex flex-wrap items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-2.5 text-sm">
          <span class="min-w-0 flex-1">{removed.name} dihapus dari Pantauanku.</span>
          <button type="button" class="btn btn-sm" onclick={undo}>Urungkan</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (removed = null)}>Tutup</button>
        </div>
      {/if}
      {#if watch.error}<p role="alert" class="text-sm text-error">{watch.error}</p>{/if}
      {#if retryError}<p role="alert" class="text-sm text-error">{retryError}</p>{/if}
      {#if watch.notice}<p role="status" class="text-sm">{watch.notice}</p>{/if}

      {#each w.items as item (item.symbol)}
        {@const q = quotes[item.symbol]}
        {@const name = friendlyName(item.tvSymbol)}
        {@const decided = item.decision}
        {@const call = decided?.rating ? callOf(decided.rating) : null}
        {@const live = item.last?.status === 'queued' || item.last?.status === 'running'}
        {@const failedLast = item.last?.status === 'failed' && item.last.id !== decided?.id ? item.last : null}
        {@const market = marketName(item.tvSymbol)}
        <article class="ta-watch" aria-labelledby="watch-{item.symbol}">
          <span class="ta-mono" data-size="lg" data-watched>{monogram(item.tvSymbol)}</span>
          <div class="min-w-0">
            <h3 id="watch-{item.symbol}" class="truncate text-lg leading-tight font-semibold">{name}</h3>
            <p class="truncate text-xs ta-muted"><span class="font-mono">{assetCode(item.symbol)}</span>{market ? ` · ${market}` : ''}</p>
          </div>
          <div class="ta-watch-spark">
            {#if q?.spark && q.spark.length > 1}
              <svg
                class="ta-spark"
                data-dir={dirOf(q.month)}
                viewBox="0 0 100 32"
                preserveAspectRatio="none"
                role="img"
                aria-label="Harga {name} sebulan terakhir: {q.month == null ? 'tanpa perubahan' : `${(q.month ?? 0) > 0 ? 'naik' : 'turun'} ${percentText(Math.abs(q.month ?? 0))}`}"
              ><path d={sparkPath(q.spark)} /></svg>
            {/if}
          </div>
          <div class="flex flex-col items-end gap-1 tabular-nums">
            {#if q}
              <span class="font-semibold">{priceText(q.price, q.currency, item.symbol)}</span>
              {#if q.change != null}<span class="ta-chip" data-dir={dirOf(q.change)}>{percentText(q.change)}</span>{/if}
            {:else}
              <span class="skeleton h-4 w-20"></span>
            {/if}
          </div>
          <div class="ta-watch-call flex min-w-0 flex-col gap-1">
            <span class="text-xs ta-muted">Keputusan AI</span>
            {#if live}
              <span class="flex items-center gap-2 text-sm"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{item.last?.status === 'queued' ? 'Antre' : 'Sedang dianalisa'}…</span>
            {:else if call && decided}
              <span class="flex flex-wrap items-center gap-2">
                <span class="ta-chip" data-size="lg" data-dir={call.dir}><Icon name={call.icon} size={14} stroke={2.4} />{call.label}</span>
                <span class="text-sm ta-muted">{formatDay(decided.tradeDate)}</span>
              </span>
            {:else}
              <span class="ta-chip w-fit" data-size="lg">Belum ada</span>
            {/if}
          </div>
          <div class="ta-watch-act flex items-center justify-end gap-1">
            <button type="button" class="btn btn-sm" onclick={() => (decided ? ws.openRun(decided.id, { symbol: item.tvSymbol }) : ws.research(item.tvSymbol))}>
              {decided ? 'Baca laporan' : 'Buka di Riset AI'}
            </button>
            <div class="dropdown dropdown-end">
              <button type="button" class="btn btn-square btn-ghost btn-sm" aria-label="Pilihan lain untuk {name}"><Icon name="more" stroke={2.8} /></button>
              <ul class="dropdown-content menu z-10 w-60 rounded-box border border-base-300 bg-base-100 p-1">
                <li><button type="button" onclick={() => ws.research(item.tvSymbol)}>Buka chart di Riset AI</button></li>
                <li><button type="button" class="text-error" onclick={() => remove(item)}>Hapus dari Pantauanku</button></li>
              </ul>
            </div>
          </div>
          {#if failedLast && !live}
            <div class="ta-flag">
              <Icon name="alert" size={16} />
              <span class="min-w-0 flex-1">Analisa {formatDateTime(failedLast.createdAt)} gagal{decided ? `, jadi keputusan di atas masih dari ${formatDay(decided.tradeDate)}` : ''}.</span>
              <button type="button" class="btn btn-sm" disabled={!!retrying || room === 0 || auth.unverified || !catalog.value} onclick={() => retry(item)}>
                {#if retrying === item.symbol}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
                Coba lagi
              </button>
              <button type="button" class="link text-sm" onclick={() => openLog(failedLast.id, item.tvSymbol)}>Lihat log</button>
            </div>
          {:else if !decided && !live}
            <div class="ta-flag" data-tone="info"><Icon name="clock" size={16} />Dianalisa pertama kali {formatWhen(w.schedule.next)}.</div>
          {/if}
        </article>
      {/each}

      {#if w.items.length < w.max}
        <div class="flex flex-col gap-3 rounded-box border-[1.5px] border-dashed border-base-300 p-5">
          <div class="flex items-start gap-3">
            <span class="ta-choice-icon"><Icon name="plus" /></span>
            <div class="min-w-0">
              <p class="font-semibold">{w.items.length ? 'Tambah aset lain' : 'Tambah aset yang kamu ikuti'}</p>
              <p class="text-sm ta-muted">
                AI menganalisanya tiap hari bursa pukul {w.schedule.time.replace(':', '.')} WIB; tiap aset memakai 1 kuota analisa. Bisa juga lewat bintang di kepala chart atau di daftar pasar.
              </p>
            </div>
          </div>
          {#if suggestions.length}
            <div class="flex flex-wrap gap-2">
              {#each suggestions as s (s.yahoo)}
                <button type="button" class="btn btn-sm" disabled={watch.busy} onclick={() => watch.toggle(s.yahoo, s.tv)}>
                  <Icon name="plus" size={14} />{s.name}{#if s.recent}<span class="font-normal ta-muted">· terakhir dibuka</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <aside class="flex min-w-0 flex-col gap-4 lg:w-[22rem] lg:shrink-0">
      <section class="ta-card flex flex-col gap-4 p-5" aria-labelledby="sched-title">
        <div class="flex items-center justify-between gap-2">
          <h2 id="sched-title" class="ta-section-title">Analisa otomatis</h2>
          {#if w.items.length}<span class="ta-chip" data-dir="up"><Icon name="check" size={12} stroke={2.4} />Aktif</span>{/if}
        </div>
        <div class="flex flex-col gap-1">
          <p class="ta-big text-4xl">{w.schedule.time.replace(':', '.')} <span class="text-lg font-semibold ta-muted">WIB</span></p>
          <p class="text-sm ta-muted">{daysLabel}. Berikutnya <b class="text-base-content">{formatWhen(w.schedule.next)}</b>.</p>
        </div>
        {#if week.length}
          <ol class="ta-week" style="grid-template-columns: repeat({week.length}, minmax(0, 1fr))" aria-label="Jadwal minggu ini">
            {#each week as d (d.iso)}
              <li class="ta-day" data-state={d.state}>
                <b>{d.name}</b>
                <span class="ta-day-mark">
                  {#if d.state === 'done'}<Icon name="check" size={14} stroke={2.4} />{:else if d.state === 'today'}<Icon name="clock" size={14} />{/if}
                </span>
                {d.state === 'today' ? 'hari ini' : d.date}<span class="sr-only">{d.state === 'done' ? ', sudah dianalisa' : d.state === 'next' || d.state === 'today' ? ', terjadwal' : ''}</span>
              </li>
            {/each}
          </ol>
        {/if}
        <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt class="ta-muted">AI membaca</dt>
          <dd>{w.schedule.analysts.map((a) => ANALYSTS[a] ?? a).join(', ')}</dd>
          <dt class="ta-muted">Kedalaman</dt>
          <dd>{w.schedule.depth}</dd>
          <dt class="ta-muted">Biaya</dt>
          <dd>1 kuota analisa per aset</dd>
        </dl>
        <div class="flex items-center gap-3 border-t border-base-300 pt-4">
          <span class="ta-choice-icon"><Icon name="send" /></span>
          <div class="min-w-0 flex-1">
            <p class="font-medium">Ringkasan ke Telegram</p>
            <p class="text-xs ta-muted">
              {w.telegram.configured
                ? 'Dikirim saat semua analisa selesai.'
                : !w.telegram.bot
                  ? 'Belum tersedia di server ini. Analisa tetap berjalan; hasilnya ada di Riwayat.'
                  : 'Hubungkan Telegram di menu akun → Profil agar ringkasannya sampai. Analisa tetap berjalan tanpa itu.'}
            </p>
          </div>
          {#if w.telegram.configured}<button type="button" class="btn btn-ghost btn-sm" onclick={() => watch.test()} disabled={watch.busy}>Kirim tes</button>{/if}
        </div>
        <div class="flex flex-col gap-2 border-t border-base-300 pt-4">
          <button
            type="button"
            class="btn btn-primary"
            onclick={() => watch.runNow()}
            disabled={watch.busy || !w.items.length || room === 0 || auth.unverified}
          >
            {#if watch.busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{:else}<Icon name="play" size={16} />{/if}
            Jalankan sekarang · {w.items.length} aset
          </button>
          {#if auth.unverified}<VerifyNote />{:else if w.items.length}<p class="text-xs ta-muted">{cost(w.items.length)}</p>{/if}
          {#if w.lastRun}
            <p class="text-xs ta-muted">
              Putaran terjadwal terakhir {formatDay(w.lastRun.day, true)}: {w.lastRun.analysisIds.length} analisa{w.lastRun.skipped.length
                ? `, ${w.lastRun.skipped.length} dilewati (kuota)`
                : ''}{w.telegram.configured ? (w.lastRun.notifiedAt ? ', ringkasan terkirim' : ', ringkasan belum terkirim') : ''}.
            </p>
          {/if}
        </div>
      </section>
    </aside>
  </div>
{/if}
