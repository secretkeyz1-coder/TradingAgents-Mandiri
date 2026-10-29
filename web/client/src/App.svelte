<script lang="ts">
  // The gate: ask the server whether this browser is signed in, then show the
  // login page or the workspace. The workspace is imported only after that,
  // because its stores call the API the moment they load.
  import { onMount } from 'svelte';
  import { auth } from './lib/auth.svelte';
  import LoginPage from './lib/LoginPage.svelte';

  onMount(() => {
    auth.check();
  });
</script>

{#if auth.state === 'in'}
  {#await import('./lib/AppShell.svelte') then shell}
    <shell.default />
  {/await}
{:else if auth.state === 'out'}
  <LoginPage />
{:else}
  <div class="grid h-dvh place-items-center bg-base-100" aria-busy="true">
    <span class="loading loading-spinner" aria-label="Memuat"></span>
  </div>
{/if}
