<script lang="ts">
  // The one login of the app (APP_USER / APP_PASSWORD on the server). Field
  // names and autocomplete hints let a password manager fill it in.
  import { auth } from './auth.svelte';
  import Logo from './Logo.svelte';

  let username = $state('');
  let password = $state('');
  let error = $state(auth.error);
  let busy = $state(false);
  let passwordInput: HTMLInputElement;

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = await auth.login(username.trim(), password);
    busy = false;
    if (error) {
      password = '';
      passwordInput.focus();
    }
  }
</script>

<main class="grid min-h-dvh place-items-center bg-base-100 px-4 py-10">
  <div class="flex w-full max-w-sm flex-col gap-8">
    <div class="flex items-center gap-2.5 font-semibold tracking-tight">
      <Logo class="size-8" />
      <span class="text-lg">TradingAgents</span>
    </div>

    <div class="flex flex-col gap-1.5">
      <h1 class="text-2xl font-semibold tracking-tight">Masuk</h1>
      <p class="text-sm text-base-content/70">Analisa multi-agent, backtest, dan agent chart untuk saham, kripto, dan forex.</p>
    </div>

    <form class="flex flex-col gap-4" onsubmit={submit} aria-describedby={error ? 'login-error' : undefined}>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Nama pengguna</legend>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="input w-full"
          name="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          autofocus
          bind:value={username}
        />
      </fieldset>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Kata sandi</legend>
        <input
          class="input w-full"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          bind:value={password}
          bind:this={passwordInput}
        />
      </fieldset>

      {#if error}
        <p id="login-error" role="alert" class="text-sm text-error">{error}</p>
      {/if}

      <button class="btn btn-primary w-full" type="submit" disabled={busy}>
        {#if busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Memeriksa…{:else}Masuk{/if}
      </button>
    </form>

    <p class="text-xs text-base-content/70">Sesi tersimpan 30 hari di browser ini. Tombol Keluar ada di pojok kanan atas.</p>
  </div>
</main>
