<script lang="ts">
  // One workspace screen. Routing lives in the workspace store (URL hash), and
  // old page links are translated there, so the shell only draws the frame.
  // Loaded only once the user is signed in: the workspace store calls the API
  // as soon as it is imported.
  import { auth } from './auth.svelte';
  import Logo from './Logo.svelte';
  import SymbolSearch from './SymbolSearch.svelte';
  import WorkspaceShell from './workspace/WorkspaceShell.svelte';
</script>

<div class="flex h-dvh flex-col bg-base-100">
  <header class="flex shrink-0 items-center gap-3 border-b border-base-300 px-3 py-2 sm:px-4">
    <a href="#/" class="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="TradingAgents">
      <Logo />
      <span class="hidden sm:inline">TradingAgents</span>
    </a>
    <div class="ml-auto w-full max-w-80 min-w-0">
      <SymbolSearch />
    </div>
    {#if auth.enabled}
      <button class="btn btn-ghost btn-sm shrink-0" onclick={() => auth.logout()} title="Keluar dari {auth.user}">Keluar</button>
    {/if}
  </header>

  <WorkspaceShell />
</div>
