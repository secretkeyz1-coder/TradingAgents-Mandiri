<script lang="ts">
  // "Mulai di sini" (ADR 0021), for an account that has not set up the loop yet: three steps in the order the app pays
  // off, each ticked once done. An asset in Pantauanku gets an AI analysis each trading day, a signal notification
  // fills Beranda with calls and their results, and Telegram brings both to the phone. Shown until the first two
  // are done; a member missing only Telegram gets the side column's note instead.
  import { STARTERS } from '../../beginner/plain';
  import { watch } from '../../stores/watch.svelte';
  import TelegramConnect from '../../TelegramConnect.svelte';
  import { toYahoo } from '../../tv';
  import Icon from '../Icon.svelte';

  let {
    hasWatch,
    hasAlerts,
    hasTelegram,
    onNotifications,
  }: { hasWatch: boolean; hasAlerts: boolean; hasTelegram: boolean; onNotifications: () => void } = $props();

  const done = $derived([hasWatch, hasAlerts, hasTelegram].filter(Boolean).length);
</script>

{#snippet mark(n: number, ok: boolean)}
  <span class="ta-step-n" class:bg-success={ok}>{#if ok}<Icon name="check" size={16} stroke={2.6} />{:else}{n}{/if}</span>
{/snippet}

<section class="ta-card ta-pane" aria-labelledby="start-title">
  <div class="ta-pane-head">
    <h2 id="start-title" class="font-semibold">Mulai di sini</h2>
    <span class="ta-chip">{done} dari 3 selesai</span>
  </div>
  <ol class="ta-steps">
    <li class="ta-step">
      {@render mark(1, hasWatch)}
      <span class="ta-step-t">Tambah aset ke Pantauanku</span>
      <div class="ta-step-b">
        <p class="text-sm ta-muted">Harganya tampil di Beranda tiap kamu buka, dan AI menganalisanya tiap hari bursa.</p>
        {#if !hasWatch}
          <div class="flex flex-wrap gap-2">
            {#each STARTERS as [tv, name] (tv)}
              {@const yahoo = toYahoo(tv)}
              {#if yahoo}<button type="button" class="btn btn-sm" onclick={() => watch.toggle(yahoo, tv)}>+ {name}</button>{/if}
            {/each}
          </div>
        {/if}
      </div>
    </li>
    <li class="ta-step">
      {@render mark(2, hasAlerts)}
      <span class="ta-step-t">Pasang notifikasi sinyal</span>
      <div class="ta-step-b">
        <p class="text-sm ta-muted">Pilih indikator di chart Sinyal. Tiap sinyal baru dan hasilnya (TP atau SL) tercatat di Beranda.</p>
        {#if !hasAlerts}<button type="button" class="btn btn-sm btn-primary w-fit" onclick={onNotifications}>Buka chart Sinyal</button>{/if}
      </div>
    </li>
    <li class="ta-step">
      {@render mark(3, hasTelegram)}
      <span class="ta-step-t">Sambungkan Telegram</span>
      <div class="ta-step-b">
        <p class="text-sm ta-muted">Sinyal dan alert harga sampai ke HP-mu.</p>
        {#if !hasTelegram}
          {#if watch.value?.telegram.bot}<TelegramConnect compact />{:else}<p class="text-sm ta-muted">Notifikasi Telegram belum tersedia di server ini.</p>{/if}
        {/if}
      </div>
    </li>
  </ol>
</section>
