<script lang="ts">
  // Sign in, sign up, forgotten and new password, and the code step of two-step
  // sign-in, on one card. Field names and autocomplete hints let a password
  // manager fill them in. Sign-up and Google show only when the server offers
  // them (SIGNUP=open, GOOGLE_CLIENT_ID).
  import { BRAND } from '../../../shared/brand';
  import { auth } from './auth.svelte';
  import Logo from './Logo.svelte';

  type Mode = 'login' | 'signup' | 'forgot' | 'reset' | '2fa';
  let { mode: initial = 'login', token = '' }: { mode?: Mode; token?: string } = $props();

  // svelte-ignore state_referenced_locally
  let mode = $state<Mode>(initial);
  let login = $state('');
  let email = $state('');
  let phone = $state('');
  let password = $state('');
  let repeat = $state('');
  let code = $state('');
  /** Typing a recovery code (letters and digits) instead of the app's six digits. */
  let recovery = $state(false);
  let accept = $state(false);
  let error = $state(auth.error);
  let sent = $state(false);
  let busy = $state(false);

  const TITLE: Record<Mode, string> = { login: 'Masuk', signup: 'Daftar gratis', forgot: 'Lupa kata sandi', reset: 'Buat kata sandi baru', '2fa': 'Kode verifikasi' };

  function go(next: Mode) {
    mode = next;
    error = '';
    sent = false;
    password = repeat = code = '';
    if (next !== '2fa') auth.challenge = null;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    error = '';
    if (mode === 'reset' && password !== repeat) {
      error = 'Kata sandi dan ulangannya tidak sama.';
      return;
    }
    busy = true;
    if (mode === 'login') {
      error = await auth.login(login.trim(), password);
      if (!error && auth.challenge) go('2fa');
    } else if (mode === 'signup') error = await auth.signup({ email: email.trim(), password, phone: phone.trim(), acceptTerms: accept });
    else if (mode === 'forgot') {
      error = await auth.forgot(email.trim());
      sent = !error;
    } else if (mode === 'reset') {
      error = await auth.reset(token, password);
      // Signed in by the reset, or one code away from it.
      if (!error && auth.challenge) go('2fa');
      else if (!error) location.href = '/app';
    } else {
      error = await auth.verify(code.trim());
      // Signed in: open the app from a clean address. An expired ticket starts over at the password.
      if (!error) location.href = '/app';
      else if (!auth.challenge) mode = 'login';
    }
    busy = false;
    if (error && mode !== 'forgot') password = repeat = code = '';
  }
</script>

<main class="grid min-h-dvh place-items-center bg-base-100 px-4 py-10">
  <div class="flex w-full max-w-sm flex-col gap-7">
    <a href="/" class="flex items-center gap-2.5 font-semibold tracking-tight">
      <Logo class="size-8" />
      <span class="text-lg">{BRAND.name}</span>
    </a>

    <div class="flex flex-col gap-1.5">
      <h1 class="text-2xl font-semibold tracking-tight">{TITLE[mode]}</h1>
      {#if mode === 'login'}
        <p class="text-sm text-base-content/70">Uji indikatormu dengan jujur, catat sinyalnya, dan lihat hasil nyatanya setelah biaya.</p>
      {:else if mode === 'signup'}
        <p class="text-sm text-base-content/70">Gratis selamanya untuk dicoba. Paket Pro aktif {auth.config.trialDays} hari setelah emailmu terverifikasi.</p>
      {:else if mode === 'forgot'}
        <p class="text-sm text-base-content/70">Masukkan email akunmu. Kami kirim tautan untuk membuat kata sandi baru.</p>
      {:else if mode === '2fa'}
        <p class="text-sm text-base-content/70">
          {recovery
            ? 'Ketik salah satu kode pemulihan yang kamu simpan saat mengaktifkan verifikasi dua langkah. Tiap kode hanya berlaku sekali.'
            : `Buka aplikasi authenticator di ponselmu dan ketik kode 6 digit untuk ${BRAND.name}.`}
        </p>
      {:else}
        <p class="text-sm text-base-content/70">Semua browser lain yang masuk dengan akun ini akan dikeluarkan.</p>
      {/if}
    </div>

    {#if auth.notice}
      <p role="status" class="text-sm {auth.notice.tone === 'error' ? 'text-error' : 'text-base-content/80'}">{auth.notice.text}</p>
    {/if}

    {#if auth.config.google && (mode === 'login' || mode === 'signup')}
      <div class="flex flex-col gap-2">
        <a class="btn w-full gap-2" href="/api/auth/google">
          <svg viewBox="0 0 48 48" class="size-4" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {mode === 'signup' ? 'Daftar dengan Google' : 'Masuk dengan Google'}
        </a>
        <p class="text-xs text-base-content/70">
          Dengan melanjutkan, kamu menyetujui <a class="link" href="/syarat" target="_blank" rel="noopener">Syarat & Ketentuan</a> dan
          <a class="link" href="/privasi" target="_blank" rel="noopener">Kebijakan Privasi</a>.
        </p>
      </div>
      <div class="divider my-0 text-xs text-base-content/60">atau dengan email</div>
    {/if}

    {#if mode === 'signup' && !auth.config.signup}
      <div class="flex flex-col gap-3 text-sm">
        <p>Pendaftaran belum dibuka untuk umum. Kalau kamu sudah punya akun, silakan masuk.</p>
        <button class="btn btn-sm self-start" onclick={() => go('login')}>Masuk</button>
      </div>
    {:else if mode === 'forgot' && sent}
      <div role="status" class="flex flex-col gap-3 text-sm">
        <p>Kalau <strong>{email.trim()}</strong> terdaftar, tautan untuk membuat kata sandi baru sudah dikirim. Cek juga folder spam; tautannya berlaku 1 jam.</p>
        {#if !auth.config.mail}<p class="text-warning">Pengiriman email belum diatur di server ini. Minta admin mengatur ulang kata sandimu.</p>{/if}
        <button class="btn btn-ghost btn-sm self-start" onclick={() => go('login')}>Kembali ke Masuk</button>
      </div>
    {:else}
      <form class="flex flex-col gap-4" onsubmit={submit} aria-describedby={error ? 'auth-error' : undefined}>
        {#if mode === 'login'}
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend pt-0">Email atau nama pengguna</legend>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="input w-full" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus bind:value={login} />
          </fieldset>
        {:else if mode === 'signup' || mode === 'forgot'}
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend pt-0">Email</legend>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="input w-full" type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" required autofocus bind:value={email} />
          </fieldset>
        {:else if mode === '2fa'}
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend pt-0">{recovery ? 'Kode pemulihan' : 'Kode dari aplikasi'}</legend>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="input w-full font-mono tracking-widest"
              name="code"
              autocomplete="one-time-code"
              inputmode={recovery ? 'text' : 'numeric'}
              autocapitalize="none"
              spellcheck="false"
              placeholder={recovery ? 'xxxx-xxxx' : '123456'}
              minlength="6"
              maxlength="20"
              required
              autofocus
              bind:value={code}
            />
          </fieldset>
        {/if}

        {#if mode !== 'forgot' && mode !== '2fa'}
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend pt-0">{mode === 'reset' ? 'Kata sandi baru' : 'Kata sandi'}</legend>
            <input
              class="input w-full"
              type="password"
              name="password"
              autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
              minlength={mode === 'login' ? undefined : 8}
              required
              bind:value={password}
            />
            {#if mode !== 'login'}<p class="label">Minimal 8 karakter.</p>{/if}
          </fieldset>
        {/if}

        {#if mode === 'reset'}
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend pt-0">Ulangi kata sandi baru</legend>
            <input class="input w-full" type="password" name="repeat" autocomplete="new-password" minlength="8" required bind:value={repeat} />
          </fieldset>
        {/if}

        {#if mode === 'signup'}
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend pt-0">Nomor WhatsApp <span class="font-normal text-base-content/60">(opsional)</span></legend>
            <input class="input w-full" type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="0812 3456 7890" bind:value={phone} />
            <p class="label whitespace-normal">Untuk bantuan dan notifikasi WhatsApp nanti. Tidak dipakai untuk promosi tanpa izinmu.</p>
          </fieldset>
          <label class="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" class="checkbox checkbox-sm mt-0.5" required bind:checked={accept} />
            <span>
              Saya menyetujui <a class="link" href="/syarat" target="_blank" rel="noopener">Syarat & Ketentuan</a> dan
              <a class="link" href="/privasi" target="_blank" rel="noopener">Kebijakan Privasi</a>, dan paham bahwa isi layanan ini adalah riset, bukan nasihat keuangan.
            </span>
          </label>
        {/if}

        {#if error}
          <p id="auth-error" role="alert" class="text-sm text-error">{error}</p>
        {/if}

        <button class="btn btn-primary w-full" type="submit" disabled={busy}>
          {#if busy}<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>Memproses…{:else}{mode === 'login'
              ? 'Masuk'
              : mode === 'signup'
                ? 'Daftar'
                : mode === 'forgot'
                  ? 'Kirim tautan'
                  : mode === '2fa'
                    ? 'Verifikasi'
                    : 'Simpan kata sandi'}{/if}
        </button>
      </form>

      <div class="flex flex-col gap-1.5 text-sm">
        {#if mode === 'login'}
          <button class="link link-hover self-start" onclick={() => go('forgot')}>Lupa kata sandi?</button>
          {#if auth.config.signup}<p>Belum punya akun? <button class="link" onclick={() => go('signup')}>Daftar gratis</button></p>{/if}
        {:else if mode === 'signup' || mode === 'forgot'}
          <p>Sudah punya akun? <button class="link" onclick={() => go('login')}>Masuk</button></p>
        {:else if mode === '2fa'}
          <button class="link link-hover self-start" onclick={() => ((recovery = !recovery), (code = ''), (error = ''))}>
            {recovery ? 'Pakai kode dari aplikasi' : 'Kehilangan ponsel? Pakai kode pemulihan'}
          </button>
          <button class="link link-hover self-start" onclick={() => go('login')}>Kembali ke Masuk</button>
        {:else}
          <a class="link link-hover self-start" href="/app">Batal</a>
        {/if}
      </div>
    {/if}
  </div>
</main>
