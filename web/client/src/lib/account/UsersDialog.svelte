<script lang="ts">
  // Admin only: the accounts. People also sign up themselves when SIGNUP=open;
  // here the admin makes accounts, sets a plan by hand (recorded as a free
  // grant in the payments), verifies an e-mail when mail cannot be sent, and
  // changes the rest. Each change is saved as soon as it is made.
  import { PLANS, PLAN_IDS, type PlanId } from '../../../../shared/plans';
  import { api, type Account } from '../api';
  import { auth } from '../auth.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let accounts = $state<Account[]>([]);
  let error = $state('');
  let notice = $state('');
  let username = $state('');
  let password = $state('');
  let role = $state<Account['role']>('member');
  let resetting = $state<string | null>(null);
  let resetPassword = $state('');
  let planning = $state<string | null>(null);
  let planChoice = $state<PlanId>('pro');
  let planEnd = $state('');

  /** Today plus `days`, as YYYY-MM-DD in WIB. */
  const dayFromNow = (days: number) => new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
  const shortDay = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

  function startPlan(a: Account) {
    planning = a.id;
    planChoice = a.plan === 'free' ? 'pro' : a.plan;
    planEnd = a.planUntil ? new Date(new Date(a.planUntil).getTime() + 7 * 3_600_000).toISOString().slice(0, 10) : dayFromNow(30);
  }

  function savePlan(event: SubmitEvent, a: Account) {
    event.preventDefault();
    act(async () => {
      await api.updateUser(a.id, { plan: planChoice, planUntil: planChoice === 'free' ? null : planEnd || null });
      planning = null;
    }, `Paket ${a.username} diatur.`);
  }

  async function load() {
    try {
      accounts = await api.users();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  load();

  async function act(fn: () => Promise<unknown>, done: string) {
    error = notice = '';
    try {
      await fn();
      notice = done;
    } catch (e) {
      error = (e as Error).message;
    }
    await load();
  }

  function create(event: SubmitEvent) {
    event.preventDefault();
    const name = username.trim().toLowerCase();
    act(async () => {
      await api.createUser({ username: name, password, role });
      username = password = '';
      role = 'member';
    }, `Akun ${name} dibuat.`);
  }

  /** Empty field = the server default (null). */
  function limit(a: Account, key: 'dailyAnalysisLimit' | 'dailyChatLimit', raw: string) {
    const value = raw.trim() === '' ? null : Math.max(0, Math.round(Number(raw)));
    if (value !== null && Number.isNaN(value)) return;
    act(() => api.updateUser(a.id, { [key]: value }), `Kuota ${a.username} disimpan.`);
  }

  function reset(event: SubmitEvent, a: Account) {
    event.preventDefault();
    act(async () => {
      await api.updateUser(a.id, { password: resetPassword });
      resetting = null;
      resetPassword = '';
    }, `Kata sandi ${a.username} diganti; sesi lamanya dikeluarkan.`);
  }
</script>

<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="users-title">
  <div class="modal-box flex max-w-4xl flex-col gap-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 id="users-title" class="text-lg font-semibold">Pengguna</h2>
        <p class="text-sm text-base-content/70">
          Tiap akun punya riwayat, chat agent, skill, dan watchlist sendiri. Kuota kosong = kuota paketnya (admin: default server).
        </p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick={onclose}>Tutup</button>
    </div>

    {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
    {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}

    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead>
          <tr>
            <th>Nama</th>
            <th>Paket</th>
            <th>Peran</th>
            <th>Status</th>
            <th class="text-right">Analisa/hari</th>
            <th class="text-right">Chat/hari</th>
            <th><span class="sr-only">Aksi</span></th>
          </tr>
        </thead>
        <tbody>
          {#each accounts as a (a.id)}
            {@const self = a.id === auth.user?.id}
            <tr class:opacity-60={a.disabled}>
              <td>
                <span class="font-mono">{a.username}</span>{#if self}<span class="ml-1 text-xs text-base-content/70">(kamu)</span>{/if}
                {#if a.email}
                  <span class="block text-xs text-base-content/70">
                    {a.email}{a.phone ? ` · ${a.phone}` : ''}
                    {#if !a.emailVerified}
                      · <button class="link" onclick={() => act(() => api.updateUser(a.id, { emailVerified: true }), `Email ${a.username} ditandai terverifikasi.`)}>verifikasi manual</button>
                    {/if}
                  </span>
                {/if}
                {#if a.twoFactor}
                  <span class="block text-xs text-base-content/70">
                    verifikasi dua langkah aktif
                    {#if !self}
                      · <button
                        class="link"
                        onclick={() =>
                          confirm(`Matikan verifikasi dua langkah ${a.username}? Lakukan hanya bila pemiliknya kehilangan ponsel dan kode pemulihannya, setelah kamu memastikan identitasnya.`) &&
                          act(() => api.updateUser(a.id, { twoFactor: false }), `Verifikasi dua langkah ${a.username} dimatikan.`)}>matikan</button
                      >
                    {/if}
                  </span>
                {/if}
              </td>
              <td>
                {#if a.role === 'admin'}
                  <span class="text-xs text-base-content/70">admin (Creator)</span>
                {:else if planning === a.id}
                  <form class="join" onsubmit={(e) => savePlan(e, a)}>
                    <select class="select join-item select-xs" bind:value={planChoice} aria-label="Paket {a.username}">
                      {#each PLAN_IDS as id (id)}<option value={id}>{PLANS[id].name}</option>{/each}
                    </select>
                    {#if planChoice !== 'free'}
                      <input class="input join-item input-xs w-32" type="date" bind:value={planEnd} aria-label="Berlaku sampai" title="Kosongkan untuk tanpa batas waktu" />
                    {/if}
                    <button class="btn btn-xs join-item" type="submit">Simpan</button>
                    <button class="btn btn-ghost btn-xs join-item" type="button" onclick={() => (planning = null)}>Batal</button>
                  </form>
                {:else}
                  <button class="btn btn-ghost btn-xs" onclick={() => startPlan(a)} title="Ubah paket">
                    {PLANS[a.plan].name}{a.onTrial ? ' · trial' : ''}{a.planUntil ? ` s.d. ${shortDay(a.planUntil)}` : ''}
                  </button>
                {/if}
              </td>
              <td>
                <select
                  class="select select-xs"
                  value={a.role}
                  disabled={self}
                  aria-label="Peran {a.username}"
                  onchange={(e) => act(() => api.updateUser(a.id, { role: e.currentTarget.value as Account['role'] }), `Peran ${a.username} diubah.`)}
                >
                  <option value="member">anggota</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td>
                <button
                  class="btn btn-xs"
                  class:btn-ghost={!a.disabled}
                  disabled={self}
                  onclick={() => act(() => api.updateUser(a.id, { disabled: !a.disabled }), a.disabled ? `${a.username} diaktifkan.` : `${a.username} dinonaktifkan dan dikeluarkan.`)}
                >
                  {a.disabled ? 'Nonaktif · aktifkan' : 'Aktif · nonaktifkan'}
                </button>
              </td>
              <td class="text-right">
                <input
                  class="input input-xs w-20 text-right tabular-nums"
                  type="number"
                  min="0"
                  placeholder="default"
                  aria-label="Analisa per hari untuk {a.username}"
                  value={a.dailyAnalysisLimit ?? ''}
                  onchange={(e) => limit(a, 'dailyAnalysisLimit', e.currentTarget.value)}
                />
              </td>
              <td class="text-right">
                <input
                  class="input input-xs w-20 text-right tabular-nums"
                  type="number"
                  min="0"
                  placeholder="default"
                  aria-label="Chat per hari untuk {a.username}"
                  value={a.dailyChatLimit ?? ''}
                  onchange={(e) => limit(a, 'dailyChatLimit', e.currentTarget.value)}
                />
              </td>
              <td class="text-right">
                {#if resetting === a.id}
                  <form class="join" onsubmit={(e) => reset(e, a)}>
                    <input class="input join-item input-xs w-36" type="password" autocomplete="new-password" minlength="8" required placeholder="Kata sandi baru" bind:value={resetPassword} />
                    <button class="btn btn-xs join-item" type="submit">Simpan</button>
                    <button class="btn btn-ghost btn-xs join-item" type="button" onclick={() => (resetting = null)}>Batal</button>
                  </form>
                {:else}
                  <button class="btn btn-ghost btn-xs" onclick={() => ((resetting = a.id), (resetPassword = ''))}>Reset kata sandi</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <form class="flex flex-wrap items-end gap-2 border-t border-base-300 pt-4" onsubmit={create}>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Nama pengguna</legend>
        <input
          class="input input-sm w-44"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          required
          minlength="3"
          maxlength="32"
          title="3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung"
          bind:value={username}
        />
      </fieldset>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Kata sandi awal</legend>
        <input class="input input-sm w-44" type="password" autocomplete="new-password" required minlength="8" bind:value={password} />
      </fieldset>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Peran</legend>
        <select class="select select-sm" bind:value={role}>
          <option value="member">anggota</option>
          <option value="admin">admin</option>
        </select>
      </fieldset>
      <button class="btn btn-primary btn-sm" type="submit">Buat akun</button>
    </form>
  </div>
  <button class="modal-backdrop" aria-label="Tutup" onclick={onclose}></button>
</div>
