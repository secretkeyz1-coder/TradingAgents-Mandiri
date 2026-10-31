<script lang="ts">
  // The gate: ask the server whether this browser is signed in, then show the
  // login page or the workspace. The workspace is imported only after that,
  // because its stores call the API the moment they load. Links sent by e-mail
  // land here too: #/reset?token=… opens the new-password form whatever the
  // session, #/signup the sign-up form, and ?notice=… shows its message once.
  import { onMount } from 'svelte';
  import { auth } from './lib/auth.svelte';
  import LoginPage from './lib/LoginPage.svelte';

  const route = location.hash.match(/^#\/(reset|signup)\b/)?.[1];
  const token = route === 'reset' ? (new URLSearchParams(location.hash.split('?')[1] ?? '').get('token') ?? '') : '';

  onMount(() => {
    auth.takeNotice();
    auth.check();
  });
</script>

{#if route === 'reset'}
  <LoginPage mode="reset" {token} />
{:else if auth.state === 'in'}
  {#await import('./lib/AppShell.svelte') then shell}
    <shell.default />
  {/await}
{:else if auth.state === 'out'}
  <LoginPage mode={route === 'signup' ? 'signup' : 'login'} />
{:else}
  <div class="grid h-dvh place-items-center bg-base-100" aria-busy="true">
    <span class="loading loading-spinner" aria-label="Memuat"></span>
  </div>
{/if}
