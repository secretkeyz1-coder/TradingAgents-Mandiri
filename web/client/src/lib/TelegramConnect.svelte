<script lang="ts">
  // Connect Telegram in one tap (server/src/telegram.ts): ask for a one-time link to the bot,
  // open Telegram on it (the window opens inside the tap, so a popup blocker lets it), and watch
  // the account until the bot's Start has connected the chat. The link also shows, for a phone
  // or browser that did not open it. Used in Profil → Notifikasi and wherever Telegram is missing.
  import { api } from './api';
  import { auth } from './auth.svelte';

  let { compact = false }: { compact?: boolean } = $props();

  let url = $state('');
  let error = $state('');
  let waiting = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;

  $effect(() => () => clearInterval(timer));

  async function connect() {
    error = '';
    // Opened now, inside the tap; pointed at the link once it arrives.
    const tab = window.open('', '_blank');
    try {
      url = (await api.telegramLink()).url;
      if (tab) tab.location.href = url;
    } catch (e) {
      tab?.close();
      error = (e as Error).message;
      return;
    }
    waiting = true;
    const until = Date.now() + 3 * 60_000;
    clearInterval(timer);
    timer = setInterval(async () => {
      const me = await api.me().catch(() => null);
      if (me?.telegramChatId) {
        auth.user = me;
        waiting = false;
        clearInterval(timer);
      } else if (Date.now() > until) {
        waiting = false;
        clearInterval(timer);
      }
    }, 3000);
  }
</script>

{#if auth.user?.telegramChatId && !waiting && url}
  <p class="text-sm text-success" role="status">Telegram tersambung. Notifikasi akan dikirim ke chat itu.</p>
{:else}
  <div class="flex flex-col gap-1.5" class:items-start={!compact}>
    <div class="flex flex-wrap items-center gap-2">
      <button class="btn btn-sm btn-primary" disabled={waiting} onclick={connect}>
        {#if waiting}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
        {auth.user?.telegramChatId ? 'Sambungkan ulang Telegram' : 'Sambungkan Telegram'}
      </button>
      {#if waiting}<span class="text-xs text-base-content/70" role="status">Tekan <strong>Start</strong> di Telegram; halaman ini menunggu sampai tersambung.</span>{/if}
    </div>
    {#if url && waiting}
      <p class="text-xs text-base-content/70">Telegram tidak terbuka? <a class="link" href={url} target="_blank" rel="noopener">Buka tautan ini</a> (berlaku 15 menit).</p>
    {/if}
    {#if error}<p role="alert" class="text-xs text-error">{error}</p>{/if}
  </div>
{/if}
