<script lang="ts">
  // The signed-in app in one of two modes: Pemula (one asset in plain words) or Pro,
  // switched in the top bar, where Pro also lists its screens (Beranda, Pasar, Riset AI,
  // Pantau, Uji strategi; a phone has them in a bottom tab bar instead). Routing lives in
  // the workspace store (URL hash), and old page links are translated there, so the
  // shell only draws the frame. Loaded only once the user is signed in: the workspace
  // store calls the API as soon as it is imported.
  import { PLANS } from '../../../shared/plans';
  import { api } from './api';
  import BillingDialog from './account/BillingDialog.svelte';
  import ProfileDialog from './account/ProfileDialog.svelte';
  import { auth } from './auth.svelte';
  import BeginnerShell from './beginner/BeginnerShell.svelte';
  import Logo from './Logo.svelte';
  import { layout } from './stores/layout.svelte';
  import { mode } from './stores/mode.svelte';
  import { layoutOf, viewport } from './stores/viewport.svelte';
  import { isChartScreen, SCREENS, ws } from './stores/workspace.svelte';
  import SymbolSearch from './SymbolSearch.svelte';
  import UpdateNotice from './UpdateNotice.svelte';
  import WorkspaceShell from './workspace/WorkspaceShell.svelte';

  const narrow = $derived(layoutOf(viewport) === 'narrow');
  const pro = $derived(mode.value === 'pro');
  // Focus mode gives a Pro chart screen the whole window; phones and Pemula have no focus mode.
  const framed = $derived(!pro || !layout.focus || narrow || !isChartScreen(ws.screen));

  let menu: HTMLDetailsElement | undefined = $state();
  type Dialog = 'profile' | 'billing';
  type ProfileTab = 'akun' | 'notifikasi' | 'publik' | 'keamanan';
  let dialog = $state<Dialog | null>(null);
  let profileTab = $state<ProfileTab>('akun');

  /** Open a dialog; the profile can open on one of its tabs. */
  function open(which: Dialog, tab: ProfileTab = 'akun') {
    if (menu) menu.open = false;
    profileTab = tab;
    dialog = which;
  }

  const TONE = { success: 'alert-success', error: 'alert-error', info: 'alert-info' } as const;
  let resent = $state('');
  async function resend() {
    try {
      const r = await api.resendVerification();
      resent = r.mailed ? 'Tautan baru sudah dikirim.' : 'Pengiriman email belum diatur di server; minta admin memverifikasi akunmu.';
    } catch (e) {
      resent = (e as Error).message;
    }
  }
  // Whether the server can e-mail a link decides what an unverified account is asked to do:
  // open the link, or wait for the admin (no mail set up, Konsol admin → Pengguna).
  $effect(() => {
    if (auth.user?.email && !auth.user.emailVerified && !auth.configLoaded) auth.loadConfig();
  });

  /** The account button: initials, the name people chose (else the username), and one badge for role or plan. */
  const shownName = $derived(auth.user ? auth.user.displayName || auth.user.username : '');
  const initials = $derived(
    shownName
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?',
  );
</script>

<div class="flex h-dvh flex-col bg-base-100">
  <header class="flex shrink-0 items-center gap-3 border-b border-base-300 px-3 py-2 sm:px-4" class:hidden={!framed}>
    <a href="#/" class="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="TradingAgents">
      <Logo />
      <span class="hidden {pro ? 'xl:inline' : 'md:inline'}">TradingAgents</span>
    </a>
    <div role="tablist" class="tabs tabs-box tabs-sm shrink-0" aria-label="Tampilan">
      <button role="tab" class="tab" class:tab-active={mode.value === 'pemula'} aria-selected={mode.value === 'pemula'} title="Satu aset, bahasa sederhana" onclick={() => mode.set('pemula')}>Pemula</button>
      <button role="tab" class="tab" class:tab-active={mode.value === 'pro'} aria-selected={mode.value === 'pro'} title="Semua alat: chart, analisa, backtest, sinyal" onclick={() => mode.set('pro')}>Pro</button>
    </div>
    {#if pro && !narrow}
      <nav class="flex min-w-0 items-center gap-0.5" aria-label="Menu utama">
        {#each SCREENS as s (s.key)}
          <a
            class="ta-nav"
            href="#/{s.key}"
            aria-current={ws.screen === s.key ? 'page' : undefined}
            onclick={(e) => {
              e.preventDefault();
              ws.go(s.key);
            }}
          >
            {s.label}
            {#if s.tabs.some((t) => ws.live(t.key))}<span class="status status-xs status-info motion-safe:animate-pulse" aria-label="berjalan"></span>{/if}
          </a>
        {/each}
      </nav>
    {/if}
    <div class="ml-auto w-full max-w-80 min-w-0">
      <SymbolSearch />
    </div>
    {#if auth.user}
      <details class="dropdown dropdown-end shrink-0" bind:this={menu}>
        <summary class="btn btn-ghost btn-sm gap-2 rounded-full pl-1 font-normal" aria-label="Menu akun {shownName}">
          <span class="grid size-7 place-items-center rounded-full bg-accent/15 text-xs font-semibold" aria-hidden="true">{initials}</span>
          <span class="hidden max-w-28 truncate sm:inline">{shownName}</span>
          {#if auth.isAdmin}<span class="badge badge-xs badge-soft badge-secondary hidden sm:inline-flex">Admin</span>{:else}<span class="badge badge-xs badge-soft badge-info hidden sm:inline-flex">{PLANS[auth.user.plan].name}{auth.user.onTrial ? ', trial' : ''}</span>{/if}
        </summary>
        <ul class="menu dropdown-content z-30 mt-1 w-44 rounded-box border border-base-300 bg-base-100 p-1 shadow-sm">
          <li><button onclick={() => open('profile')}>Profil</button></li>
          {#if !auth.isAdmin}<li><button onclick={() => open('billing')}>Paket & tagihan</button></li>{/if}
          {#if auth.isAdmin}<li><a href="#/admin" onclick={() => menu && (menu.open = false)}>Konsol admin</a></li>{/if}
          {#if auth.enabled}<li><button onclick={() => auth.logout()}>Keluar</button></li>{/if}
        </ul>
      </details>
    {/if}
  </header>

  {#if auth.notice}
    <div role="status" class="alert alert-soft {TONE[auth.notice.tone]} shrink-0 justify-between rounded-none border-x-0 border-t-0 px-4 py-2 text-sm">
      <span>{auth.notice.text}</span>
      <button class="btn btn-ghost btn-xs" onclick={() => (auth.notice = null)}>Tutup</button>
    </div>
  {/if}
  {#if auth.user?.email && !auth.user.emailVerified && auth.configLoaded}
    <div class="alert alert-soft alert-warning shrink-0 flex-wrap justify-between gap-2 rounded-none border-x-0 border-t-0 px-4 py-2 text-sm">
      {#if auth.config.mail}
        <span>
          Verifikasi <strong>{auth.user.email}</strong> untuk memakai analisa AI dan chat agent{auth.user.trialUsed ? '' : ', sekaligus mengaktifkan trial Pro'}. Cek kotak masuk dan
          folder spam.
        </span>
        {#if resent}<span class="text-xs">{resent}</span>{:else}<button class="btn btn-xs" onclick={resend}>Kirim ulang tautan</button>{/if}
      {:else}
        <span>
          Akunmu menunggu verifikasi admin. Setelah itu analisa AI dan chat agent bisa dipakai{auth.user.trialUsed ? '' : ', dan trial Pro aktif'}.
        </span>
      {/if}
    </div>
  {/if}

  {#if mode.value === 'pemula'}
    <BeginnerShell onprofile={() => open('profile', 'notifikasi')} />
  {:else}
    <WorkspaceShell />
  {/if}
  <UpdateNotice />
</div>

{#if dialog === 'profile'}
  <ProfileDialog start={profileTab} onclose={() => (dialog = null)} />
{:else if dialog === 'billing'}
  <BillingDialog onclose={() => (dialog = null)} />
{/if}
