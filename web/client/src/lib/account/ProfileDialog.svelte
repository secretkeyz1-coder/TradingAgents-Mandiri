<script lang="ts">
  // The signed-in user's own settings: today's quota, the Telegram chat that
  // gets their watchlist summary, and their password.
  import { api } from '../api';
  import { auth } from '../auth.svelte';
  import { usage } from '../stores/usage.svelte';
  import { watch } from '../stores/watch.svelte';

  let { onclose }: { onclose: () => void } = $props();

  usage.refresh();
  watch.load();

  let chatId = $state(auth.user?.telegramChatId ?? '');
  let chatSaved = $state('');
  let chatError = $state('');
  let current = $state('');
  let next = $state('');
  let repeat = $state('');
  let pwMessage = $state('');
  let pwError = $state('');
  let busy = $state(false);

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

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    pwMessage = pwError = '';
    if (next !== repeat) {
      pwError = 'Kata sandi baru dan ulangannya tidak sama.';
      return;
    }
    busy = true;
    try {
      await api.changePassword(current, next);
      pwMessage = 'Kata sandi diganti. Browser lain yang masuk dengan akun ini sudah dikeluarkan.';
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

    {#if usage.value}
      <section class="flex flex-col gap-1">
        <h3 class="text-sm font-semibold">Kuota hari ini</h3>
        <p class="text-sm tabular-nums">Analisa: {quota(usage.value.analyses.used, usage.value.analyses.limit)} · Chat: {quota(usage.value.chat.used, usage.value.chat.limit)}</p>
        <p class="text-xs text-base-content/70">Reset pukul 00.00 WIB. Admin bisa mengubah batas akunmu.</p>
      </section>
    {/if}

    <form class="flex flex-col gap-2" onsubmit={saveChat}>
      <h3 class="text-sm font-semibold">Telegram</h3>
      {#if watch.value && !watch.value.telegram.bot}
        <p class="text-xs text-warning">Bot Telegram belum diatur di server (TELEGRAM_BOT_TOKEN), jadi pesan belum bisa dikirim.</p>
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

    <form class="flex flex-col gap-2" onsubmit={changePassword}>
      <h3 class="text-sm font-semibold">Ganti kata sandi</h3>
      <input class="input input-sm w-full" type="password" autocomplete="current-password" placeholder="Kata sandi sekarang" required bind:value={current} />
      <input class="input input-sm w-full" type="password" autocomplete="new-password" placeholder="Kata sandi baru (min. 8 karakter)" minlength="8" required bind:value={next} />
      <input class="input input-sm w-full" type="password" autocomplete="new-password" placeholder="Ulangi kata sandi baru" minlength="8" required bind:value={repeat} />
      {#if pwError}<p role="alert" class="text-sm text-error">{pwError}</p>{/if}
      {#if pwMessage}<p role="status" class="text-sm text-success">{pwMessage}</p>{/if}
      <button class="btn btn-primary btn-sm self-start" type="submit" disabled={busy}>Ganti kata sandi</button>
    </form>
  </div>
  <button class="modal-backdrop" aria-label="Tutup" onclick={onclose}></button>
</div>
