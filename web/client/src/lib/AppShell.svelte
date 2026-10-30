<script lang="ts">
  // One workspace screen. Routing lives in the workspace store (URL hash), and
  // old page links are translated there, so the shell only draws the frame.
  // Loaded only once the user is signed in: the workspace store calls the API
  // as soon as it is imported.
  import ProfileDialog from './account/ProfileDialog.svelte';
  import UsersDialog from './account/UsersDialog.svelte';
  import { auth } from './auth.svelte';
  import Logo from './Logo.svelte';
  import { layout } from './stores/layout.svelte';
  import { layoutOf, viewport } from './stores/viewport.svelte';
  import SymbolSearch from './SymbolSearch.svelte';
  import WorkspaceShell from './workspace/WorkspaceShell.svelte';

  // Focus mode gives the chart the whole window; phones have no focus mode.
  const framed = $derived(!layout.focus || layoutOf(viewport) === 'narrow');

  let menu: HTMLDetailsElement | undefined = $state();
  let dialog = $state<'profile' | 'users' | null>(null);

  function open(which: 'profile' | 'users') {
    if (menu) menu.open = false;
    dialog = which;
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
          {#if auth.isAdmin}<span class="badge badge-xs badge-ghost">admin</span>{/if}
        </summary>
        <ul class="menu dropdown-content z-30 mt-1 w-44 rounded-box border border-base-300 bg-base-100 p-1 shadow-sm">
          <li><button onclick={() => open('profile')}>Profil</button></li>
          {#if auth.isAdmin}<li><button onclick={() => open('users')}>Pengguna</button></li>{/if}
          {#if auth.enabled}<li><button onclick={() => auth.logout()}>Keluar</button></li>{/if}
        </ul>
      </details>
    {/if}
  </header>

  <WorkspaceShell />
</div>

{#if dialog === 'profile'}
  <ProfileDialog onclose={() => (dialog = null)} />
{:else if dialog === 'users'}
  <UsersDialog onclose={() => (dialog = null)} />
{/if}
