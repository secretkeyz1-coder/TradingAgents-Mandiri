<script lang="ts">
  // The last step of signing up with Google: the e-mail sign-up form asks for a WhatsApp
  // number, Google's sign-in does not, so the account gives one here before the app opens.
  // The server keeps the rule (needsPhone in server/src/plans.ts): AI features wait for the
  // number, and a Google account cannot remove it later from its profile.
  import { BRAND } from '../../../shared/brand';
  import { api } from './api';
  import { auth } from './auth.svelte';
  import Logo from './Logo.svelte';

  let phone = $state('');
  let busy = $state(false);
  let error = $state('');

  async function save(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      auth.user = await api.updateMe({ phone: phone.trim() });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<main class="grid min-h-dvh place-items-center bg-base-100 px-4 py-10">
  <div class="flex w-full max-w-sm flex-col gap-7">
    <span class="flex items-center gap-2.5 font-semibold tracking-tight">
      <Logo class="size-8" />
      <span class="text-lg">{BRAND.name}</span>
    </span>

    <div class="flex flex-col gap-1.5">
      <h1 class="text-2xl font-semibold tracking-tight">Satu langkah lagi</h1>
      <p class="text-sm text-base-content/70">
        Isi nomor WhatsApp-mu untuk menyelesaikan pendaftaran dengan Google. Kami memakainya untuk bantuan akun dan notifikasi WhatsApp nanti, bukan
        untuk promosi tanpa izinmu.
      </p>
    </div>

    <form class="flex flex-col gap-4" onsubmit={save}>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Nomor WhatsApp</legend>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="input w-full"
          type="tel"
          name="phone"
          autocomplete="tel"
          inputmode="tel"
          placeholder="0812 3456 7890"
          required
          autofocus
          aria-describedby={error ? 'phone-error' : undefined}
          bind:value={phone}
        />
        <p class="label whitespace-normal">Nomor Indonesia boleh diawali 0 atau +62.</p>
      </fieldset>

      {#if error}
        <p id="phone-error" role="alert" class="text-sm text-error">{error}</p>
      {/if}

      <button class="btn btn-primary w-full" type="submit" disabled={busy}>
        {#if busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Menyimpan…{:else}Simpan dan lanjut{/if}
      </button>
    </form>

    <p class="text-sm text-base-content/70">
      Masuk dengan Google sebagai {auth.user?.email}.
      <button class="link" onclick={() => auth.logout()}>Bukan kamu? Keluar</button>
    </p>
  </div>
</main>
