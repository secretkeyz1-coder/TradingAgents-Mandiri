<script lang="ts">
  // Admin only: how members use the app (server/src/analytics.ts), from the minutes counted
  // while a member's tab is in front and in use, and from what the server saw them do. The
  // overview answers who is online now, how many use the app each day, at which hours, where
  // and for what; #/admin/aktivitas/<id> shows one member's sessions, habits and history.
  // Admin accounts are not counted, and nothing is kept longer than 90 days.
  import { PLANS } from '../../../../shared/plans';
  import { api, type ActivityDetail, type ActivityKind, type ActivityOverview, type ActivityScreen } from '../api';
  import DayBars from './DayBars.svelte';
  import WeekHeatmap from './WeekHeatmap.svelte';

  const PERIODS = [7, 30, 90] as const;
  const SCREEN: Record<ActivityScreen, string> = { beranda: 'Beranda', pasar: 'Pasar', riset: 'Riset AI', pantau: 'Pantau', uji: 'Uji strategi', pemula: 'Mode Pemula' };
  const TAB: Record<string, string> = {
    history: 'Riwayat',
    report: 'Laporan',
    log: 'Log',
    watch: 'Analisa terjadwal',
    alerts: 'Alert',
    backtest: 'Backtest',
    lab: 'Lab',
    signals: 'Strategi live',
    screener: 'Screener',
  };
  const KIND: Record<ActivityKind, string> = {
    login: 'Masuk',
    analysis: 'Analisa AI',
    backtest: 'Backtest',
    chat: 'Pesan ke agent chart',
    lab: 'Uji Lab',
    alert: 'Notifikasi sinyal baru',
    price_alert: 'Notifikasi harga baru',
    watch: 'Simbol ke analisa harian',
    script: 'Skrip baru',
  };
  const INDICATOR: Record<string, string> = { pob: 'PoB BYSTRA', scalper: 'Scalper Pro+', fib: 'Fib GZ' };
  const TF: Record<string, string> = { '15m': '15m', '1h': '1j', '4h': '4j', '1d': 'harian' };

  const readMember = () => location.hash.match(/^#\/admin\/aktivitas\/([0-9a-f-]{36})/)?.[1] ?? null;
  let member = $state<string | null>(readMember());
  let days = $state<number>(30);
  let overview = $state<ActivityOverview | null>(null);
  let detail = $state<ActivityDetail | null>(null);
  let error = $state('');

  $effect(() => {
    const follow = () => (member = readMember());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  });

  async function load(id: string | null, n: number) {
    try {
      if (id) detail = await api.adminActivityUser(id, n);
      else overview = await api.adminActivity(n);
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  $effect(() => {
    const id = member;
    const n = days;
    if (id) detail = null;
    load(id, n);
    // Who is online changes by the minute: the overview refreshes while it is open.
    if (id) return;
    const timer = setInterval(() => load(null, n), 60_000);
    return () => clearInterval(timer);
  });

  const duration = (m: number) => (m < 60 ? `${m} menit` : `${Math.floor(m / 60)} jam${m % 60 ? ` ${m % 60} menit` : ''}`);
  const cellUnit = (m: number) => (m ? duration(m) : 'tidak dipakai');
  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  function ago(iso: string | null, online = false) {
    if (online) return 'online sekarang';
    if (!iso) return 'belum ada data';
    const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    if (minutes < 24 * 60) return rtf.format(-Math.round(minutes / 60), 'hour');
    if (minutes < 7 * 24 * 60) return rtf.format(-Math.round(minutes / 1440), 'day');
    return wib(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const wib = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', ...options });
  const clock = (at: number) => new Date(at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const place = (screen: ActivityScreen, tab: string | null) => (tab && TAB[tab] ? `${SCREEN[screen]} → ${TAB[tab]}` : SCREEN[screen]);
  /** The days of the period in WIB, oldest first. */
  const dayList = (n: number) => {
    const today = Date.now() + 7 * 3_600_000;
    return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
  };
  /** Minutes per screen, busiest first, with its tabs when it showed more than one. */
  function byScreen(rows: { screen: ActivityScreen; tab: string | null; minutes: number }[]) {
    const out = new Map<ActivityScreen, { screen: ActivityScreen; minutes: number; tabs: { tab: string; minutes: number }[] }>();
    for (const r of rows) {
      const s = out.get(r.screen) ?? { screen: r.screen, minutes: 0, tabs: [] };
      s.minutes += r.minutes;
      if (r.tab && TAB[r.tab]) s.tabs.push({ tab: r.tab, minutes: r.minutes });
      out.set(r.screen, s);
    }
    return [...out.values()].map((s) => ({ ...s, tabs: s.tabs.length > 1 ? s.tabs.sort((a, b) => b.minutes - a.minutes) : [] })).sort((a, b) => b.minutes - a.minutes);
  }
  /** What an event's detail says, in words. */
  function what(e: ActivityDetail['events'][number]) {
    const d = e.detail ?? {};
    if (e.kind === 'backtest') return `${d.cells} sel`;
    if (e.kind === 'lab') return `${d.strategy} · ${TF[String(d.timeframe)] ?? d.timeframe}${Number(d.symbols) > 1 ? ` · ${d.symbols} simbol` : ''}`;
    if (e.kind === 'alert') {
      const key = String(d.indicator ?? '');
      return `${INDICATOR[key] ?? (key.startsWith('catalog:') ? 'Indikator katalog' : 'Skrip sendiri')} · ${TF[String(d.timeframe)] ?? d.timeframe}`;
    }
    if (e.kind === 'price_alert') return `di ${Number(d.price).toLocaleString('id-ID')}`;
    if (e.kind === 'script') return String(d.name ?? '');
    return '';
  }

  const overviewDays = $derived.by(() => {
    if (!overview) return [];
    const by = new Map(overview.daily.map((d) => [d.day, d]));
    return dayList(overview.days).map((day) => {
      const d = by.get(day);
      return { day, value: d?.people ?? 0, text: d ? `${d.people} member · ${duration(d.minutes)}` : 'Tidak ada member aktif' };
    });
  });
  const overviewScreens = $derived(overview ? byScreen(overview.screens) : []);
  const detailDays = $derived.by(() => {
    if (!detail) return [];
    const by = new Map(detail.daily.map((d) => [d.day, d.minutes]));
    return dayList(detail.days).map((day) => ({ day, value: by.get(day) ?? 0, text: by.has(day) ? duration(by.get(day)!) : 'Tidak aktif' }));
  });
  const detailScreens = $derived(detail ? byScreen(detail.screens) : []);
  const detailTotal = $derived(detail ? detail.daily.reduce((n, d) => n + d.minutes, 0) : 0);
</script>

{#snippet screenList(rows: ReturnType<typeof byScreen>)}
  {@const total = rows.reduce((n, r) => n + r.minutes, 0) || 1}
  {#if rows.length}
    <ul class="flex flex-col gap-3 text-sm">
      {#each rows as r (r.screen)}
        <li class="flex flex-col gap-1">
          <div class="flex items-baseline justify-between gap-2">
            <span>{SCREEN[r.screen]}</span>
            <span class="tabular-nums text-base-content/70">{duration(r.minutes)} · {Math.round((r.minutes / total) * 100)}%</span>
          </div>
          <div class="h-2 bg-base-200" aria-hidden="true"><div class="h-2 rounded-r-[4px] bg-accent" style:width="{(r.minutes / total) * 100}%"></div></div>
          {#if r.tabs.length}
            <span class="text-xs text-base-content/70">{r.tabs.map((t) => `${TAB[t.tab]} ${Math.round((t.minutes / r.minutes) * 100)}%`).join(' · ')}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-sm text-base-content/70">Belum ada menit aktif di periode ini.</p>
  {/if}
{/snippet}

<!-- A grid, not a flex column: a column would squeeze the wide tables to nothing. -->
<section class="grid grid-cols-[minmax(0,1fr)] gap-6" aria-labelledby="activity-title">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex max-w-[70ch] flex-col gap-1">
      {#if member}
        <a class="link link-hover flex items-center gap-1 text-sm" href="#/admin/aktivitas">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          Semua member
        </a>
      {/if}
      <h1 id="activity-title" class="text-2xl font-semibold">{member ? (detail?.user.username ?? 'Aktivitas member') : 'Aktivitas'}</h1>
      <p class="text-sm text-base-content/70">
        Dihitung per menit selama tab aplikasi terbuka dan dipakai (ada klik, sentuhan, atau ketikan dalam 5 menit terakhir), ditambah tindakan yang tercatat di server. Akun
        admin tidak dihitung; data disimpan 90 hari. Jam dalam WIB.
      </p>
    </div>
    <div class="join" role="group" aria-label="Periode">
      {#each PERIODS as n (n)}
        <button class="btn btn-sm join-item" class:btn-active={days === n} aria-pressed={days === n} onclick={() => (days = n)}>{n} hari</button>
      {/each}
    </div>
  </div>

  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}

  {#if !member}
    {#if !overview}
      <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
    {:else}
      <section class="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="online-title">
        <h2 id="online-title" class="flex items-center gap-2 font-semibold">
          Online sekarang <span class="badge badge-sm {overview.online.length ? 'badge-success badge-soft' : 'badge-ghost'}">{overview.online.length}</span>
        </h2>
        {#if overview.online.length}
          <ul class="flex flex-col gap-1.5 text-sm">
            {#each overview.online as o (o.id)}
              <li class="flex flex-wrap items-center gap-x-2">
                <span class="status status-success" aria-hidden="true"></span>
                <a class="link link-hover font-medium" href="#/admin/aktivitas/{o.id}">{o.username}</a>
                <span class="text-base-content/70">di {place(o.screen, o.tab)}{o.symbol ? ` · ${o.symbol}` : ''}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-base-content/70">Tidak ada member yang sedang memakai aplikasi. Halaman ini memuat ulang tiap menit.</p>
        {/if}
      </section>

      <div class="stats stats-vertical w-full border border-base-300 bg-base-100 lg:stats-horizontal">
        <div class="stat">
          <div class="stat-title whitespace-normal">Aktif hari ini</div>
          <div class="stat-value text-2xl tabular-nums">{overview.summary.today}</div>
          <div class="stat-desc whitespace-normal">member, sejak 00.00 WIB</div>
        </div>
        <div class="stat">
          <div class="stat-title whitespace-normal">Aktif {overview.days} hari terakhir</div>
          <div class="stat-value text-2xl tabular-nums">{overview.summary.active}</div>
          <div class="stat-desc whitespace-normal">dari {overview.summary.members} member</div>
        </div>
        <div class="stat">
          <div class="stat-title whitespace-normal">Rata-rata sehari</div>
          <div class="stat-value text-2xl tabular-nums">{duration(overview.summary.perDay)}</div>
          <div class="stat-desc whitespace-normal">per member, di hari ia membuka aplikasi</div>
        </div>
        <div class="stat">
          <div class="stat-title whitespace-normal">Total waktu aktif</div>
          <div class="stat-value text-2xl tabular-nums">{duration(overview.summary.minutes)}</div>
          <div class="stat-desc whitespace-normal">semua member, {overview.days} hari terakhir</div>
        </div>
      </div>

      <div class="grid gap-6 xl:grid-cols-2">
        <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="daily-title">
          <h2 id="daily-title" class="font-semibold">Member aktif per hari</h2>
          <DayBars days={overviewDays} label="Member aktif" />
        </section>
        <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="hours-title">
          <h2 id="hours-title" class="font-semibold">Jam ramai</h2>
          <WeekHeatmap cells={overview.heatmap} unit={cellUnit} />
        </section>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="screens-title">
          <h2 id="screens-title" class="font-semibold">Layar yang dipakai</h2>
          {@render screenList(overviewScreens)}
        </section>
        <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="features-title">
          <h2 id="features-title" class="font-semibold">Fitur yang dipakai</h2>
          {#if overview.features.length}
            <table class="table table-sm">
              <thead><tr><th>Tindakan</th><th class="text-right">Kali</th><th class="text-right">Member</th></tr></thead>
              <tbody>
                {#each overview.features as f (f.kind)}
                  <tr><td>{KIND[f.kind] ?? f.kind}</td><td class="text-right tabular-nums">{f.count}</td><td class="text-right tabular-nums">{f.people}</td></tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="text-sm text-base-content/70">Belum ada tindakan tercatat di periode ini.</p>
          {/if}
        </section>
        <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="symbols-title">
          <h2 id="symbols-title" class="font-semibold">Aset yang paling lama dibuka</h2>
          {#if overview.symbols.length}
            <table class="table table-sm">
              <thead><tr><th>Simbol</th><th class="text-right">Waktu</th><th class="text-right">Member</th></tr></thead>
              <tbody>
                {#each overview.symbols as s (s.symbol)}
                  <tr><td class="font-mono">{s.symbol}</td><td class="text-right whitespace-nowrap tabular-nums">{duration(s.minutes)}</td><td class="text-right tabular-nums">{s.people}</td></tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="text-sm text-base-content/70">Belum ada chart yang dibuka di periode ini.</p>
          {/if}
        </section>
      </div>

      <section class="flex min-w-0 flex-col gap-3" aria-labelledby="members-title">
        <h2 id="members-title" class="font-semibold">Member</h2>
        <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Member</th>
                <th>Paket</th>
                <th>Terakhir aktif</th>
                <th class="text-right">Waktu aktif</th>
                <th class="text-right">Hari aktif</th>
                <th>Paling sering di</th>
                <th class="text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {#each overview.users as u (u.id)}
                <tr>
                  <td>
                    <a class="link link-hover font-medium" href="#/admin/aktivitas/{u.id}">{u.username}</a>
                    {#if u.email}<span class="block text-xs text-base-content/70">{u.email}</span>{/if}
                  </td>
                  <td>{PLANS[u.plan].name}</td>
                  <td class="whitespace-nowrap">
                    {#if u.online}<span class="status status-success mr-1" aria-hidden="true"></span>{/if}{ago(u.lastSeen, u.online)}
                  </td>
                  <td class="text-right whitespace-nowrap tabular-nums">{u.minutes ? duration(u.minutes) : '–'}</td>
                  <td class="text-right tabular-nums">{u.days || '–'}</td>
                  <td>{u.topScreen ? SCREEN[u.topScreen] : '–'}</td>
                  <td class="text-right tabular-nums">{u.events || '–'}</td>
                </tr>
              {:else}
                <tr><td colspan="7" class="text-base-content/70">Belum ada member.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {:else if !detail}
    <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
  {:else}
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span class="badge badge-sm badge-ghost">{PLANS[detail.user.plan].name}</span>
      {#if detail.user.email}<span class="text-base-content/70">{detail.user.email}</span>{/if}
      <span class="flex items-center gap-1.5">
        {#if detail.user.online}<span class="status status-success" aria-hidden="true"></span>{/if}
        {detail.user.online ? 'Online sekarang' : `Terakhir aktif ${ago(detail.user.lastSeen)}`}
      </span>
      <span class="text-base-content/70">Bergabung {wib(detail.user.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
    </p>

    <div class="stats stats-vertical w-full border border-base-300 bg-base-100 lg:stats-horizontal">
      <div class="stat">
        <div class="stat-title whitespace-normal">Waktu aktif</div>
        <div class="stat-value text-2xl tabular-nums">{duration(detailTotal)}</div>
        <div class="stat-desc whitespace-normal">{detail.days} hari terakhir</div>
      </div>
      <div class="stat">
        <div class="stat-title whitespace-normal">Hari aktif</div>
        <div class="stat-value text-2xl tabular-nums">{detail.daily.length}</div>
        <div class="stat-desc whitespace-normal">dari {detail.days} hari</div>
      </div>
      <div class="stat">
        <div class="stat-title whitespace-normal">Rata-rata sehari</div>
        <div class="stat-value text-2xl tabular-nums">{duration(detail.daily.length ? Math.round(detailTotal / detail.daily.length) : 0)}</div>
        <div class="stat-desc whitespace-normal">di hari ia membuka aplikasi</div>
      </div>
      <div class="stat">
        <div class="stat-title whitespace-normal">Sesi</div>
        <div class="stat-value text-2xl tabular-nums">{detail.sessions.length}{detail.sessions.length === 30 ? '+' : ''}</div>
        <div class="stat-desc whitespace-normal">jeda lebih dari 15 menit memulai sesi baru</div>
      </div>
    </div>

    <div class="grid gap-6 xl:grid-cols-2">
      <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="member-daily-title">
        <h2 id="member-daily-title" class="font-semibold">Waktu aktif per hari</h2>
        <DayBars days={detailDays} label="Waktu aktif" />
      </section>
      <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="member-hours-title">
        <h2 id="member-hours-title" class="font-semibold">Kebiasaan: jam ia memakai aplikasi</h2>
        <WeekHeatmap cells={detail.heatmap} unit={cellUnit} />
      </section>
    </div>

    <section class="flex min-w-0 flex-col gap-3" aria-labelledby="sessions-title">
      <h2 id="sessions-title" class="font-semibold">Kapan ia online</h2>
      <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table class="table table-sm">
          <thead><tr><th>Hari</th><th>Jam (WIB)</th><th class="text-right">Aktif</th><th>Layar</th></tr></thead>
          <tbody>
            {#each detail.sessions as s (s.start)}
              <tr>
                <td class="whitespace-nowrap">{wib(s.start, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                <td class="whitespace-nowrap tabular-nums">{clock(Date.parse(s.start))}–{clock(Date.parse(s.end) + 60_000)}</td>
                <td class="text-right whitespace-nowrap tabular-nums">{duration(s.minutes)}</td>
                <td>{s.screens.map((x) => SCREEN[x] ?? x).join(', ')}</td>
              </tr>
            {:else}
              <tr><td colspan="4" class="text-base-content/70">Belum ada sesi di periode ini.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <div class="grid gap-6 lg:grid-cols-3">
      <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="member-screens-title">
        <h2 id="member-screens-title" class="font-semibold">Layar yang dipakai</h2>
        {@render screenList(detailScreens)}
      </section>
      <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="member-features-title">
        <h2 id="member-features-title" class="font-semibold">Fitur yang dipakai</h2>
        {#if detail.features.length}
          <table class="table table-sm">
            <thead><tr><th>Tindakan</th><th class="text-right">Kali</th></tr></thead>
            <tbody>
              {#each detail.features as f (f.kind)}
                <tr><td>{KIND[f.kind] ?? f.kind}</td><td class="text-right tabular-nums">{f.count}</td></tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="text-sm text-base-content/70">Belum ada tindakan tercatat di periode ini.</p>
        {/if}
      </section>
      <section class="flex min-w-0 flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4" aria-labelledby="member-symbols-title">
        <h2 id="member-symbols-title" class="font-semibold">Aset yang paling lama dibuka</h2>
        {#if detail.symbols.length}
          <table class="table table-sm">
            <thead><tr><th>Simbol</th><th class="text-right">Waktu</th></tr></thead>
            <tbody>
              {#each detail.symbols as s (s.symbol)}
                <tr><td class="font-mono">{s.symbol}</td><td class="text-right whitespace-nowrap tabular-nums">{duration(s.minutes)}</td></tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="text-sm text-base-content/70">Belum ada chart yang dibuka di periode ini.</p>
        {/if}
      </section>
    </div>

    <section class="flex min-w-0 flex-col gap-3" aria-labelledby="events-title">
      <h2 id="events-title" class="font-semibold">Yang ia lakukan</h2>
      <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table class="table table-sm">
          <thead><tr><th>Waktu (WIB)</th><th>Tindakan</th><th>Simbol</th><th>Keterangan</th></tr></thead>
          <tbody>
            {#each detail.events as e, i (i)}
              <tr>
                <td class="whitespace-nowrap tabular-nums">{wib(e.at, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{KIND[e.kind] ?? e.kind}</td>
                <td class="font-mono">{e.symbol ?? '–'}</td>
                <td>{what(e) || '–'}</td>
              </tr>
            {:else}
              <tr><td colspan="4" class="text-base-content/70">Belum ada tindakan tercatat di periode ini.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if detail.events.length === 100}<p class="text-xs text-base-content/70">Menampilkan 100 tindakan terakhir.</p>{/if}
    </section>
  {/if}
</section>
