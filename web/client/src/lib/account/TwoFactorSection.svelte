<script lang="ts">
  // Two-step sign-in for the signed-in account (server/src/totp.ts): turn it on
  // with an authenticator app (scan the QR code, type one code), keep the
  // recovery codes it shows once, make new ones, or turn it off with a code.
  import { renderSVG } from 'uqr';
  import { BRAND } from '../../../../shared/brand';
  import { api } from '../api';
  import { auth } from '../auth.svelte';

  let setup = $state<{ secret: string; uri: string } | null>(null);
  let codes = $state<string[] | null>(null);
  /** Which action is waiting for a code from the app. */
  let confirming = $state<'disable' | 'recovery' | null>(null);
  let code = $state('');
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  // The QR code stays dark on white in both themes, so every camera reads it.
  const qr = $derived(setup ? renderSVG(setup.uri, { border: 2 }) : '');
  const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

  async function act(fn: () => Promise<void>) {
    busy = true;
    error = notice = '';
    try {
      await fn();
      code = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const start = () =>
    act(async () => {
      setup = await api.twoFactorSetup();
    });

  const enable = (event: SubmitEvent) => {
    event.preventDefault();
    return act(async () => {
      const r = await api.twoFactorEnable(code.trim());
      auth.user = r.user;
      codes = r.recoveryCodes;
      setup = null;
    });
  };

  const confirm = (event: SubmitEvent) => {
    event.preventDefault();
    return act(async () => {
      if (confirming === 'disable') {
        auth.user = (await api.twoFactorDisable(code.trim())).user;
        notice = 'Verifikasi dua langkah dimatikan.';
      } else {
        codes = (await api.twoFactorRecovery(code.trim())).recoveryCodes;
      }
      confirming = null;
    });
  };

  async function copy() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      notice = 'Kode pemulihan disalin.';
    } catch {
      error = 'Browser menolak menyalin; pilih dan salin kodenya sendiri.';
    }
  }

  function download() {
    if (!codes) return;
    const text = [`Kode pemulihan ${BRAND.name} untuk ${auth.user?.email ?? auth.user?.username}`, 'Tiap kode hanya berlaku sekali.', '', ...codes, ''].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = `kode-pemulihan-${BRAND.name.toLowerCase()}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
</script>

<section class="flex flex-col gap-3" aria-labelledby="two-factor-title">
  <div class="flex flex-wrap items-center gap-2">
    <h3 id="two-factor-title" class="text-sm font-semibold">Verifikasi dua langkah</h3>
    {#if auth.user?.twoFactor}<span class="badge badge-xs badge-success badge-soft">aktif</span>{/if}
  </div>

  {#if codes}
    <div class="flex flex-col gap-3 rounded-box border border-warning/50 p-4">
      <p class="text-sm">
        Simpan kode pemulihan ini di tempat aman, mis. pengelola kata sandi. Kalau ponselmu hilang, satu kode bisa dipakai sekali untuk masuk. Kode ini hanya
        ditampilkan sekarang.
      </p>
      <ul class="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm" aria-label="Kode pemulihan">
        {#each codes as c (c)}<li>{c}</li>{/each}
      </ul>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-sm" type="button" onclick={copy}>Salin semua</button>
        <button class="btn btn-sm" type="button" onclick={download}>Unduh .txt</button>
        <button class="btn btn-primary btn-sm" type="button" onclick={() => ((codes = null), (notice = ''))}>Sudah saya simpan</button>
      </div>
    </div>
  {:else if setup}
    <form class="flex flex-col gap-3" onsubmit={enable}>
      <p class="text-sm">1. Pindai kode ini dengan aplikasi authenticator, mis. Google Authenticator, Microsoft Authenticator, atau 1Password.</p>
      <div class="flex flex-wrap items-center gap-4">
        <!-- Built here from this account's own setup link; no outside markup. -->
        <div class="size-40 shrink-0 rounded-box bg-white p-1 [&>svg]:size-full" role="img" aria-label="Kode QR untuk aplikasi authenticator">{@html qr}</div>
        <p class="min-w-48 flex-1 text-xs text-base-content/70">
          Tidak bisa memindai? Tambahkan akun secara manual dengan kunci ini:
          <span class="mt-1 block font-mono text-sm break-all text-base-content select-all">{grouped(setup.secret)}</span>
        </p>
      </div>
      <label class="flex flex-col gap-1 text-sm">
        2. Ketik kode 6 digit yang muncul di aplikasi
        <input class="input input-sm w-40 font-mono tracking-widest" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" minlength="6" maxlength="6" required bind:value={code} />
      </label>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-primary btn-sm" type="submit" disabled={busy}>Aktifkan</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick={() => ((setup = null), (error = ''))}>Batal</button>
      </div>
    </form>
  {:else if auth.user?.twoFactor}
    <p class="text-xs text-base-content/70">Setiap kali masuk, setelah kata sandi atau Google, kamu diminta kode dari aplikasi authenticator.</p>
    {#if confirming}
      <form class="flex flex-wrap items-end gap-2" onsubmit={confirm}>
        <label class="flex flex-col gap-1 text-sm">
          {confirming === 'disable' ? 'Kode untuk mematikan' : 'Kode untuk membuat kode pemulihan baru'}
          <input class="input input-sm w-44 font-mono tracking-widest" autocomplete="one-time-code" placeholder="123456 atau xxxx-xxxx" minlength="6" maxlength="20" required bind:value={code} />
        </label>
        <button class="btn btn-sm {confirming === 'disable' ? 'btn-error' : 'btn-primary'}" type="submit" disabled={busy}>{confirming === 'disable' ? 'Matikan' : 'Buat baru'}</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick={() => ((confirming = null), (error = ''))}>Batal</button>
      </form>
    {:else}
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-sm" type="button" onclick={() => (confirming = 'recovery')}>Buat kode pemulihan baru</button>
        <button class="btn btn-ghost btn-sm" type="button" onclick={() => (confirming = 'disable')}>Matikan</button>
      </div>
    {/if}
  {:else}
    <p class="text-xs text-base-content/70">
      Lindungi akunmu dengan kode dari aplikasi authenticator di ponsel. Siapa pun yang tahu kata sandimu tetap tidak bisa masuk tanpa ponselmu.
    </p>
    <button class="btn btn-sm self-start" type="button" onclick={start} disabled={busy}>Aktifkan verifikasi dua langkah</button>
  {/if}

  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}
</section>
