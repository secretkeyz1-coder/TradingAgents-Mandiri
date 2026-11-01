<script lang="ts">
  // What the user is told about the asset in focus: the daily AI summary (the asset on
  // Pantauanku, analysed each trading day, the result sent to Telegram), and whether
  // Telegram is connected. `onprofile` opens the profile, where Telegram is linked.
  import { watch } from '../stores/watch.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { friendlyName } from './plain';

  let { onprofile }: { onprofile: () => void } = $props();

  const w = $derived(watch.value);
  const name = $derived(friendlyName(ws.symbol));
  const on = $derived(watch.has(ws.yahoo));
  const full = $derived(!!w && !on && w.items.length >= w.max);
  let saving = $state(false);

  const DAY = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const days = $derived.by(() => {
    const d = [...(w?.schedule.days ?? [])].sort();
    if (!d.length || d.join() === '1,2,3,4,5') return 'tiap hari bursa (Senin–Jumat)';
    const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    return run ? `tiap ${DAY[d[0]]}–${DAY[d[d.length - 1]]}` : `tiap ${d.map((x) => DAY[x]).join(', ')}`;
  });

  /** The box shows the list as it is after the change, also when the change was refused. */
  async function flip(e: Event & { currentTarget: HTMLInputElement }) {
    const box = e.currentTarget;
    saving = true;
    await watch.toggle(ws.yahoo!, ws.symbol);
    saving = false;
    box.checked = watch.has(ws.yahoo);
  }
</script>

<section class="flex flex-col gap-3 rounded-box border border-base-300 p-4" aria-labelledby="notify-title">
  <h2 id="notify-title" class="text-base font-semibold">Kabari saya</h2>

  {#if !w}
    <div class="flex flex-col gap-2" aria-busy="true">
      <div class="skeleton h-5 w-40"></div>
      <div class="skeleton h-4 w-full"></div>
    </div>
  {:else}
    <label class="flex cursor-pointer items-start justify-between gap-4" class:cursor-not-allowed={!ws.yahoo || full}>
      <span class="flex flex-col gap-0.5">
        <span class="font-medium">Ringkasan AI harian</span>
        <span class="text-sm text-base-content/70">
          {#if ws.yahoo}
            {name} dianalisa AI {days} pukul {w.schedule.time.replace(':', '.')} WIB{w.telegram.configured ? ', lalu hasilnya dikirim ke Telegram-mu' : ''}.
            {on ? 'Aset ini ada di Pantauanku.' : 'Menyalakannya juga menyimpan aset ini di Pantauanku.'}
          {:else}
            Aset ini belum bisa dianalisa AI.
          {/if}
        </span>
      </span>
      <input type="checkbox" class="toggle toggle-primary mt-0.5 shrink-0" checked={on} disabled={!ws.yahoo || full || saving} onchange={flip} />
    </label>
    {#if full}<p class="text-xs text-warning">Pantauanku penuh: paketmu memuat {w.max} aset. Hapus satu dulu, lewat tombol Dipantau di aset itu.</p>{/if}

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-base-300 pt-3 text-sm">
      {#if w.telegram.configured}
        <span class="flex items-center gap-2"><span class="status status-success" aria-hidden="true"></span>Telegram terhubung</span>
      {:else if !w.telegram.bot}
        <span class="text-base-content/70">Notifikasi Telegram belum tersedia di server ini. Hasil analisa tetap tampil di kartu Saran AI.</span>
      {:else}
        <span class="flex items-center gap-2"><span class="status status-warning" aria-hidden="true"></span>Telegram belum terhubung</span>
        <button class="btn btn-sm" onclick={onprofile}>Hubungkan di Profil</button>
      {/if}
    </div>
  {/if}
  {#if watch.error}<p role="alert" class="text-sm text-error">{watch.error}</p>{/if}
</section>
