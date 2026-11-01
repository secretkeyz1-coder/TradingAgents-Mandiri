<script lang="ts">
  // The public track record at /c/<username> (server/src/creators.ts): turn it
  // on or off and set the name and bio above the record. Which alerts feed it
  // is chosen per alert, with the Publik switch in the chart's notification menu.
  import { api } from '../api';
  import { auth } from '../auth.svelte';

  let name = $state(auth.user?.displayName ?? '');
  let bio = $state(auth.user?.bio ?? '');
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  const creator = $derived(auth.user?.plan === 'creator');

  async function save(patch: Parameters<typeof api.updateProfile>[0], message: string): Promise<boolean> {
    busy = true;
    error = notice = '';
    try {
      auth.user = await api.updateProfile(patch);
      notice = message;
      return true;
    } catch (e) {
      error = (e as Error).message;
      return false;
    } finally {
      busy = false;
    }
  }

  async function toggle(event: Event) {
    const box = event.currentTarget as HTMLInputElement;
    const on = box.checked;
    if (!(await save({ publicProfile: on }, on ? 'Halaman publikmu sudah tampil.' : 'Halaman publikmu disembunyikan.'))) box.checked = !on;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    save({ displayName: name.trim() || null, bio: bio.trim() || null }, 'Tersimpan.');
  }
</script>

<section class="flex flex-col gap-3" aria-labelledby="public-profile-title">
  <div class="flex flex-wrap items-center gap-2">
    <h3 id="public-profile-title" class="text-sm font-semibold">Halaman rekam jejak publik</h3>
    {#if creator && auth.user?.publicProfile}<span class="badge badge-xs badge-success badge-soft">tampil</span>{/if}
  </div>

  {#if creator}
    <p class="text-xs text-base-content/70">
      Setiap sinyal dari alert yang kamu publikkan dicatat saat muncul, lalu dinilai setelah biaya simulasi. Catatannya tidak bisa diubah atau dihapus, jadi pengunjung
      melihat hasil apa adanya, termasuk yang rugi.
    </p>
    <label class="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" class="toggle toggle-sm toggle-primary" checked={auth.user?.publicProfile} disabled={busy} onchange={toggle} />
      Tampilkan halamanku
    </label>
    <form class="flex flex-col gap-2" onsubmit={submit}>
      <input class="input input-sm w-full" maxlength="60" aria-label="Nama tampilan" placeholder="Nama tampilan (kosong = {auth.user?.username})" bind:value={name} />
      <textarea class="textarea textarea-sm w-full" rows="3" maxlength="400" aria-label="Bio" placeholder="Bio singkat, mis. gaya trading dan pasar yang kamu ikuti" bind:value={bio}
      ></textarea>
      <button class="btn btn-sm self-start" type="submit" disabled={busy}>Simpan nama dan bio</button>
    </form>
    <p class="text-xs text-base-content/70">
      Pilih alert yang masuk lewat sakelar Publik di menu notifikasi chart.
      {#if auth.user?.publicProfile}<a class="link" href="/c/{auth.user.username}" target="_blank" rel="noopener">Buka halamanku</a>{/if}
    </p>
  {:else}
    <p class="text-xs text-base-content/70">
      Khusus paket Creator: halaman publik yang mencatat setiap sinyal dari alert pilihanmu, dinilai setelah biaya, untuk dibagikan ke pengikutmu. Naikkan paket di menu
      akun → Paket & tagihan.
    </p>
    {#if auth.user?.publicProfile}<p class="text-xs text-warning">Halamanmu sedang tidak tampil karena paketmu bukan Creator lagi.</p>{/if}
  {/if}

  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}
</section>
