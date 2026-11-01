<script lang="ts">
  // The admin console (#/admin, App.svelte): the business, accounts, payments,
  // coupons, service status and server settings, on their own pages apart from
  // the trading workspace, so members never see this menu and admins never
  // work in a modal over a chart. #/admin/<page> picks the page.
  import { api } from '../api';
  import { auth } from '../auth.svelte';
  import Logo from '../Logo.svelte';
  import BusinessPage from './BusinessPage.svelte';
  import ConfigPage from './ConfigPage.svelte';
  import CouponsPage from './CouponsPage.svelte';
  import PaymentsPage from './PaymentsPage.svelte';
  import StatusPage from './StatusPage.svelte';
  import UsersPage from './UsersPage.svelte';

  const PAGES = [
    { key: 'ringkasan', label: 'Ringkasan', icon: 'M4 4h7v9H4zM15 4h5v5h-5zM15 13h5v7h-5zM4 17h7v3H4z' },
    { key: 'pengguna', label: 'Pengguna', icon: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5' },
    { key: 'pembayaran', label: 'Pembayaran', icon: 'M2.5 7a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2zM2.5 10h19' },
    { key: 'kupon', label: 'Kupon', icon: 'M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4zM14 7v12' },
    { key: 'status', label: 'Status layanan', icon: 'M3 12h4l3-8 4 16 3-8h4' },
    { key: 'pengaturan', label: 'Pengaturan server', icon: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4' },
  ] as const;
  type Page = (typeof PAGES)[number]['key'];

  const read = (): Page => {
    const name = location.hash.match(/^#\/admin\/([a-z]+)/)?.[1];
    return PAGES.find((p) => p.key === name)?.key ?? 'ringkasan';
  };
  let page = $state<Page>(read());
  $effect(() => {
    const follow = () => (page = read());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  });

  // The payments badge; it refreshes whenever the page changes, so a confirmation shows at once.
  let waiting = $state(0);
  $effect(() => {
    void page;
    api
      .adminPayments('open')
      .then((r) => (waiting = r.length))
      .catch(() => {});
  });
</script>

<div class="flex min-h-dvh flex-col bg-base-200">
  <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-base-300 bg-base-100 px-3 py-2 sm:px-4">
    <a href="#/admin" class="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="Konsol admin TradingAgents">
      <Logo />
      <span class="hidden sm:inline">TradingAgents</span>
    </a>
    <span class="badge badge-soft badge-secondary gap-1">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" /></svg>
      Konsol admin
    </span>
    <div class="ml-auto flex items-center gap-2">
      <a href="#/" class="btn btn-sm gap-1">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        Buka aplikasi trading
      </a>
      {#if auth.enabled}<button class="btn btn-ghost btn-sm" onclick={() => auth.logout()}>Keluar</button>{/if}
    </div>
  </header>

  <div class="flex min-h-0 flex-1 flex-col md:flex-row">
    <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-base-300 bg-base-100 p-2 md:w-60 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-3" aria-label="Menu admin">
      {#each PAGES as p (p.key)}
        <a
          href="#/admin/{p.key}"
          class="btn btn-ghost shrink-0 justify-start gap-3 font-normal whitespace-nowrap"
          class:btn-active={page === p.key}
          aria-current={page === p.key ? 'page' : undefined}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={p.icon} /></svg>
          {p.label}
          {#if p.key === 'pembayaran' && waiting}<span class="badge badge-sm badge-warning ml-auto">{waiting}</span>{/if}
        </a>
      {/each}
    </nav>

    <main class="min-w-0 flex-1 p-4 md:p-6">
      <div class="mx-auto max-w-6xl">
        {#if page === 'ringkasan'}
          <BusinessPage />
        {:else if page === 'pengguna'}
          <UsersPage />
        {:else if page === 'pembayaran'}
          <PaymentsPage />
        {:else if page === 'kupon'}
          <CouponsPage />
        {:else if page === 'status'}
          <StatusPage />
        {:else}
          <ConfigPage />
        {/if}
      </div>
    </main>
  </div>
</div>
