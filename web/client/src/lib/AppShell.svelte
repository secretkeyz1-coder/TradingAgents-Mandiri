<script lang="ts">
  // One workspace screen. Routing lives in the workspace store (URL hash), and
  // old page links are translated there, so the shell only draws the frame.
  // Loaded only once the user is signed in: the workspace store calls the API
  // as soon as it is imported.
  import { PLANS } from '../../../shared/plans';
  import { api } from './api';
  import ProfileDialog from './account/ProfileDialog.svelte';
  import UsersDialog from './account/UsersDialog.svelte';
  import { auth } from './auth.svelte';
  import Logo from './Logo.svelte';
  import { layout } from './stores/layout.svelte';
  import { layoutOf, viewport } from './stores/viewport.svelte';
  import SymbolSearch from './SymbolSearch.svelte';
  import UpdateNotice from './UpdateNotice.svelte';
  import WorkspaceShell from './workspace/WorkspaceShell.svelte';

  // Focus mode gives the chart the whole window; phones have no focus mode.
  const framed = $derived(!layout.focus || layoutOf(viewport) === 'narrow');

  let menu: HTMLDetailsElement | undefined = $state();
  let dialog = $state<'profile' | 'users' | null>(null);

  function open(which: 'profile' | 'users') {
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
</script>

<div class="flex h-dvh flex-col bg-base-100">
  <header class="flex shrink-0 items-center gap-3 border-b border-base-300 px-3 py-2 sm:px-4" class:hidden={!framed}>
    <a href="#/" class="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="TradingAgents">
      <Logo />
      <span class="hidden sm:inline">TradingAgents</span>
    </a>
    <div class="ml-auto w-full max-w-80 min-w-0">
      <SymbolSearch />
    </div>
    {#if auth.user}
      <details class="dropdown dropdown-end shrink-0" bind:this={menu}>
        <summary class="btn btn-ghost btn-sm gap-1.5 font-normal" aria-label="Menu akun {auth.user.username}">
          <span class="max-w-28 truncate font-mono">{auth.user.username}</span>
          {#if auth.isAdmin}<span class="badge badge-xs badge-ghost">admin</span>{:else}<span class="badge badge-xs badge-ghost">{PLANS[auth.user.plan].name}{auth.user.onTrial ? ' · trial' : ''}</span>{/if}
        </summary>
        <ul class="menu dropdown-content z-30 mt-1 w-44 rounded-box border border-base-300 bg-base-100 p-1 shadow-sm">
          <li><button onclick={() => open('profile')}>Profil</button></li>
          {#if auth.isAdmin}<li><button onclick={() => open('users')}>Pengguna</button></li>{/if}
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

  <WorkspaceShell />
  <UpdateNotice />
</div>

{#if dialog === 'profile'}
  <ProfileDialog onclose={() => (dialog = null)} />
{:else if dialog === 'users'}
  <UsersDialog onclose={() => (dialog = null)} />
{/if}
