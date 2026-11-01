<script lang="ts">
  // The signed-in user's own settings: plan and today's quota, e-mail and
  // WhatsApp, the Telegram chat that gets their messages, the public track
  // record (Creator), their password, and two-step sign-in.
  import { PLANS } from '../../../../shared/plans';
  import { api } from '../api';
  import { auth } from '../auth.svelte';
  import { usage } from '../stores/usage.svelte';
  import { watch } from '../stores/watch.svelte';
  import PublicProfileSection from './PublicProfileSection.svelte';
  import TwoFactorSection from './TwoFactorSection.svelte';

  let { onclose }: { onclose: () => void } = $props();

  usage.refresh();
  watch.load();

  let chatId = $state(auth.user?.telegramChatId ?? '');
  let chatSaved = $state('');
  let chatError = $state('');
  let newEmail = $state('');
  let emailMessage = $state('');
  let emailError = $state('');
  let phone = $state(auth.user?.phone ?? '');
  let phoneMessage = $state('');
  let phoneError = $state('');
  let current = $state('');
  let next = $state('');
  let repeat = $state('');
  let pwMessage = $state('');
  let pwError = $state('');
  let busy = $state(false);

  const day = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  async function saveChat(event: SubmitEvent) {
    event.preventDefault();
    chatSaved = chatError = '';
    try {
      auth.user = await api.updateMe({ telegramChatId: chatId.trim() || null });
      chatSaved = 'Tersimpan.';
      watch.load();
    } catch (e) {
      chatError = (e as Error).message;
    }
  }

  async function savePhone(event: SubmitEvent) {
    event.preventDefault();
    phoneMessage = phoneError = '';
    try {
      auth.user = await api.updateMe({ phone: phone.trim() || null });
      phone = auth.user.phone ?? '';
      phoneMessage = 'Tersimpan.';
    } catch (e) {
      phoneError = (e as Error).message;
    }
  }

  async function changeEmail(event: SubmitEvent) {
    event.preventDefault();
    emailMessage = emailError = '';
    try {
      const r = await api.setEmail(newEmail.trim());
      auth.user = r.user;
      emailMessage = r.mailed
        ? `Tautan verifikasi dikirim ke ${newEmail.trim()}. Alamat baru berlaku setelah tautannya dibuka.`
        : 'Pengiriman email belum diatur di server; minta admin memverifikasi alamatmu.';
      newEmail = '';
    } catch (e) {
      emailError = (e as Error).message;
    }
  }

  async function resend() {
    emailMessage = emailError = '';
    try {
      const r = await api.resendVerification();
      emailMessage = r.mailed ? 'Tautan verifikasi baru sudah dikirim.' : 'Pengiriman email belum diatur di server; minta admin memverifikasi alamatmu.';
    } catch (e) {
      emailError = (e as Error).message;
    }
  }

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    pwMessage = pwError = '';
    if (next !== repeat) {
      pwError = 'Kata sandi baru dan ulangannya tidak sama.';
      return;
    }
    busy = true;
    try {
      await api.changePassword(auth.user?.hasPassword ? current : undefined, next);
      pwMessage = auth.user?.hasPassword
        ? 'Kata sandi diganti. Browser lain yang masuk dengan akun ini sudah dikeluarkan.'
        : 'Kata sandi dibuat. Sekarang kamu juga bisa masuk dengan email dan kata sandi.';
      if (auth.user) auth.user = { ...auth.user, hasPassword: true };
      current = next = repeat = '';
    } catch (e) {
      pwError = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const quota = (used: number, limit: number) => (limit ? `${used} / ${limit}` : `${used} (tanpa batas)`);
</script>

<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="profile-title">
  <div class="modal-box flex max-w-lg flex-col gap-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 id="profile-title" class="text-lg font-semibold">Profil</h2>
        <p class="text-sm text-base-content/70">
          <span class="font-mono">{auth.user?.username}</span> · {auth.user?.role === 'admin' ? 'admin' : 'anggota'}
        </p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick={onclose}>Tutup</button>
    </div>

    {#if auth.user}
      <section class="flex flex-col gap-1">
        <h3 class="text-sm font-semibold">Paket</h3>
        <p class="text-sm">
          <strong>{PLANS[auth.user.plan].name}</strong>{auth.user.onTrial ? ' (trial)' : ''}{auth.user.planUntil ? `, berlaku sampai ${day(auth.user.planUntil)}` : ''}
        </p>
        {#if usage.value}
          <p class="text-sm tabular-nums">
            Hari ini: analisa {quota(usage.value.analyses.used, usage.value.analyses.limit)} · chat {quota(usage.value.chat.used, usage.value.chat.limit)}
          </p>
        {/if}
        <p class="text-xs text-base-content/70">
          Uji Lab {auth.user.limits.labRuns}/hari · notifikasi {auth.user.limits.alerts} · watchlist {auth.user.limits.watchlist} simbol · skrip {auth.user.limits.scripts}. Kuota harian
          reset pukul 00.00 WIB.
        </p>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold">Email</h3>
        {#if auth.user.email}
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-mono">{auth.user.email}</span>
            {#if auth.user.emailVerified}<span class="badge badge-xs badge-success badge-soft">terverifikasi</span>
            {:else}<span class="badge badge-xs badge-warning badge-soft">belum terverifikasi</span>
              <button class="btn btn-ghost btn-xs" type="button" onclick={resend}>Kirim ulang tautan</button>{/if}
            {#if auth.user.google}<span class="badge badge-xs badge-ghost">Google</span>{/if}
          </p>
        {:else}
          <p class="text-xs text-base-content/70">Tambahkan email supaya bisa masuk dengan email dan mengatur ulang kata sandi sendiri.</p>
        {/if}
        <form class="join w-full" onsubmit={changeEmail}>
          <input class="input join-item input-sm w-full" type="email" autocomplete="email" placeholder={auth.user.email ? 'Email baru' : 'nama@email.com'} required bind:value={newEmail} />
          <button class="btn btn-sm join-item" type="submit">{auth.user.email ? 'Ganti' : 'Tambah'}</button>
        </form>
        {#if emailMessage}<p role="status" class="text-xs text-base-content/80">{emailMessage}</p>{/if}
        {#if emailError}<p role="alert" class="text-xs text-error">{emailError}</p>{/if}
      </section>

      <form class="flex flex-col gap-2" onsubmit={savePhone}>
        <h3 class="text-sm font-semibold">WhatsApp</h3>
        <div class="join w-full">
          <input class="input join-item input-sm w-full" type="tel" inputmode="tel" autocomplete="tel" placeholder="0812 3456 7890" bind:value={phone} />
          <button class="btn btn-sm join-item" type="submit">Simpan</button>
        </div>
        <p class="text-xs text-base-content/70">Untuk bantuan dan notifikasi WhatsApp nanti; tidak dipakai untuk promosi tanpa izinmu.</p>
        {#if phoneMessage}<span class="text-xs text-success">{phoneMessage}</span>{/if}
        {#if phoneError}<span role="alert" class="text-xs text-error">{phoneError}</span>{/if}
      </form>
    {/if}

    <form class="flex flex-col gap-2" onsubmit={saveChat}>
      <h3 class="text-sm font-semibold">Telegram</h3>
      {#if watch.value && !watch.value.telegram.bot}
        <p class="text-xs text-warning">
          {auth.isAdmin ? 'Bot Telegram belum diatur di server (TELEGRAM_BOT_TOKEN), jadi pesan belum bisa dikirim.' : 'Notifikasi Telegram belum tersedia di server ini. Hubungi admin.'}
        </p>
      {/if}
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Chat ID</legend>
        <div class="join w-full">
          <input class="input join-item input-sm w-full" inputmode="numeric" placeholder="mis. 123456789" bind:value={chatId} />
          <button class="btn btn-sm join-item" type="submit">Simpan</button>
        </div>
        <p class="label whitespace-normal">
          Kirim satu pesan ke bot app ini di Telegram, lalu cari ID-mu dengan @userinfobot (atau minta admin melihatnya).
        </p>
      </fieldset>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn btn-ghost btn-sm" type="button" onclick={() => watch.test()} disabled={!watch.value?.telegram.configured || watch.busy}>Kirim tes</button>
        {#if chatSaved}<span class="text-xs text-success">{chatSaved}</span>{/if}
        {#if chatError}<span role="alert" class="text-xs text-error">{chatError}</span>{/if}
        {#if watch.notice}<span class="text-xs text-success">{watch.notice}</span>{/if}
        {#if watch.error}<span role="alert" class="text-xs text-error">{watch.error}</span>{/if}
      </div>
    </form>

    {#if auth.user}<PublicProfileSection />{/if}

    <form class="flex flex-col gap-2" onsubmit={changePassword}>
      <h3 class="text-sm font-semibold">{auth.user?.hasPassword ? 'Ganti kata sandi' : 'Buat kata sandi'}</h3>
      {#if auth.user?.hasPassword}
        <input class="input input-sm w-full" type="password" autocomplete="current-password" placeholder="Kata sandi sekarang" required bind:value={current} />
      {:else}
        <p class="text-xs text-base-content/70">Akunmu masuk dengan Google. Buat kata sandi kalau ingin bisa masuk dengan email juga.</p>
      {/if}
      <input class="input input-sm w-full" type="password" autocomplete="new-password" placeholder="Kata sandi baru (min. 8 karakter)" minlength="8" required bind:value={next} />
      <input class="input input-sm w-full" type="password" autocomplete="new-password" placeholder="Ulangi kata sandi baru" minlength="8" required bind:value={repeat} />
      {#if pwError}<p role="alert" class="text-sm text-error">{pwError}</p>{/if}
      {#if pwMessage}<p role="status" class="text-sm text-success">{pwMessage}</p>{/if}
      <button class="btn btn-primary btn-sm self-start" type="submit" disabled={busy}>{auth.user?.hasPassword ? 'Ganti kata sandi' : 'Buat kata sandi'}</button>
    </form>

    {#if auth.enabled}<TwoFactorSection />{/if}
  </div>
  <button class="modal-backdrop" aria-label="Tutup" onclick={onclose}></button>
</div>
