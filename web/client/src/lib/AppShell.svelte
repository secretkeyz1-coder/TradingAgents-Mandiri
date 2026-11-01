<script lang="ts">
  // One workspace screen, in one of two modes: Pemula (one asset in plain words)
  // or Pro (the full workspace), switched in the top bar. Routing lives in the
  // workspace store (URL hash), and old page links are translated there, so the
  // shell only draws the frame. Loaded only once the user is signed in: the
  // workspace store calls the API as soon as it is imported.
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
  import SymbolSearch from './SymbolSearch.svelte';
  import UpdateNotice from './UpdateNotice.svelte';
  import WorkspaceShell from './workspace/WorkspaceShell.svelte';

  // Focus mode gives the Pro chart the whole window; phones and Pemula have no focus mode.
  const framed = $derived(mode.value === 'pemula' || !layout.focus || layoutOf(viewport) === 'narrow');

  let menu: HTMLDetailsElement | undefined = $state();
  type Dialog = 'profile' | 'billing';
  let dialog = $state<Dialog | null>(null);

  function open(which: Dialog) {
    if (menu) menu.open = false;
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
      <span class="hidden md:inline">TradingAgents</span>
    </a>
    <div role="tablist" class="tabs tabs-box tabs-sm shrink-0" aria-label="Tampilan">
      <button role="tab" class="tab" class:tab-active={mode.value === 'pemula'} aria-selected={mode.value === 'pemula'} title="Satu aset, bahasa sederhana" onclick={() => mode.set('pemula')}>Pemula</button>
      <button role="tab" class="tab" class:tab-active={mode.value === 'pro'} aria-selected={mode.value === 'pro'} title="Semua alat: chart, analisa, backtest, sinyal" onclick={() => mode.set('pro')}>Pro</button>
    </div>
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
  {#if auth.user?.email && !auth.user.emailVerified}
    <div class="alert alert-soft alert-warning shrink-0 flex-wrap justify-between gap-2 rounded-none border-x-0 border-t-0 px-4 py-2 text-sm">
      <span>
        Verifikasi <strong>{auth.user.email}</strong> untuk memakai analisa AI dan chat agent{auth.user.trialUsed ? '' : ', sekaligus mengaktifkan trial Pro'}. Cek kotak masuk dan
        folder spam.
      </span>
      {#if resent}<span class="text-xs">{resent}</span>{:else}<button class="btn btn-xs" onclick={resend}>Kirim ulang tautan</button>{/if}
    </div>
  {/if}

  {#if mode.value === 'pemula'}
    <BeginnerShell onprofile={() => open('profile')} />
  {:else}
    <WorkspaceShell />
  {/if}
  <UpdateNotice />
</div>

{#if dialog === 'profile'}
  <ProfileDialog onclose={() => (dialog = null)} />
{:else if dialog === 'billing'}
  <BillingDialog onclose={() => (dialog = null)} />
{/if}
