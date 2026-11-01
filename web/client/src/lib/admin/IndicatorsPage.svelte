<script lang="ts">
  // Admin only: the chart indicators and who may use them (server/src/indicators.ts). Each
  // one names the plans that see it, and named accounts can be let in whatever their plan; a
  // member gets only what this allows, in the chart's Indikator menu, signal notifications
  // and the Lab. The built-in engines can be narrowed, described and switched off here; a
  // script published here is copied in, so editing its author's own script later leaves it.
  import { PLAN_IDS, PLANS, type PlanId } from '../../../../shared/plans';
  import { api, type Account, type AdminIndicator } from '../api';

  type Draft = { name: string; description: string; code: string; plans: PlanId[]; defaultOn: boolean; sortOrder: number };
  // A new one opens to no plan, so the admin tries it on their own chart before members see it.
  const blank = (): Draft => ({ name: '', description: '', code: '', plans: [], defaultOn: false, sortOrder: 100 });

  let rows = $state<AdminIndicator[] | null>(null);
  let accounts = $state<Account[]>([]);
  /** The admin's own scripts and the templates, to start a new indicator from. */
  let sources = $state<{ name: string; code: string }[]>([]);
  let creating = $state(false);
  let form = $state<Draft>(blank());
  let editing = $state<string | null>(null);
  let edit = $state<Draft>(blank());
  /** What the admin typed in each indicator's "give access" field. */
  let who = $state<Record<string, string>>({});
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  const toggled = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const reach = (r: AdminIndicator) =>
    r.plans.length ? `Paket ${r.plans.map((p) => PLANS[p].name).join(', ')}` : r.grants.length ? 'Hanya akses khusus' : 'Hanya admin';

  async function load() {
    try {
      rows = await api.adminIndicators();
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  load();
  api
    .users()
    .then((list) => (accounts = list.filter((a) => a.role !== 'admin')))
    .catch(() => {});
  api
    .scripts()
    .then((s) => (sources = [...s.items.map((x) => ({ name: x.name, code: x.code })), ...s.templates.map((t) => ({ name: `Template: ${t.name}`, code: t.code }))]))
    .catch(() => {});

  async function act(fn: () => Promise<unknown>, done: string) {
    busy = true;
    error = notice = '';
    try {
      await fn();
      notice = done;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
    await load();
  }

  function pick(target: Draft, index: string) {
    const source = sources[Number(index)];
    if (!index || !source) return;
    target.code = source.code;
    if (!target.name.trim()) target.name = source.name.replace(/^Template: /, '').slice(0, 60);
  }

  function create(e: SubmitEvent) {
    e.preventDefault();
    const body = { ...form, name: form.name.trim(), description: form.description.trim(), active: true };
    act(async () => {
      await api.createIndicator(body);
      form = blank();
      creating = false;
    }, `${body.name} dibuat. Coba dulu di chart-mu, lalu centang paket untuk membukanya ke member.`);
  }

  function open(r: AdminIndicator) {
    editing = r.id;
    edit = { name: r.name, description: r.description, code: r.code ?? '', plans: r.plans, defaultOn: r.defaultOn, sortOrder: r.sortOrder };
  }

  function save(e: SubmitEvent, r: AdminIndicator) {
    e.preventDefault();
    const shared = { description: edit.description.trim(), sortOrder: edit.sortOrder };
    act(async () => {
      await api.updateIndicator(r.id, r.builtin ? shared : { ...shared, name: edit.name.trim(), code: edit.code });
      editing = null;
    }, `${r.name} disimpan.`);
  }

  function grant(r: AdminIndicator) {
    const typed = (who[r.id] ?? '').trim().toLowerCase();
    if (!typed) return;
    const account = accounts.find((a) => a.username.toLowerCase() === typed || a.email?.toLowerCase() === typed);
    if (!account) {
      error = `Pengguna "${who[r.id]}" tidak ditemukan. Ketik nama pengguna atau email persis.`;
      notice = '';
      return;
    }
    who[r.id] = '';
    act(() => api.setIndicatorGrants(r.id, [...r.grants.map((g) => g.id), account.id]), `${account.username} sekarang bisa memakai ${r.name}.`);
  }

  function remove(r: AdminIndicator) {
    const alerts = r.alerts ? ` ${r.alerts} notifikasi sinyal yang memakainya ikut terhapus; riwayat sinyalnya tetap ada.` : '';
    if (!confirm(`Hapus ${r.name}?${alerts}`)) return;
    act(() => api.deleteIndicator(r.id), `${r.name} dihapus.`);
  }
</script>

{#snippet codeField(target: Draft, id: string)}
  <div class="flex flex-col gap-1 text-sm sm:col-span-2">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <label for={id}>Kode skrip</label>
      {#if sources.length}
        <select
          class="select select-sm w-auto max-w-full"
          aria-label="Ambil kode dari skrip saya atau template"
          onchange={(e) => {
            pick(target, e.currentTarget.value);
            e.currentTarget.value = '';
          }}
        >
          <option value="">Ambil dari skrip saya atau template…</option>
          {#each sources as s, i (i)}<option value={String(i)}>{s.name}</option>{/each}
        </select>
      {/if}
    </div>
    <textarea
      {id}
      class="textarea textarea-sm h-56 w-full font-mono"
      required
      spellcheck="false"
      bind:value={target.code}
      placeholder={'for (let i = 1; i < n; i++) {\n  if (close[i] > high[i - 1]) signal(i, "BUY", { sl: low[i], tp: close[i] + 2 * (close[i] - low[i]) });\n}'}
    ></textarea>
    <span class="text-xs text-base-content/70">Bahasa yang sama dengan Skrip saya di chart. Kodenya disalin ke sini: mengubah skrip asalnya nanti tidak mengubah indikator ini.</span>
  </div>
{/snippet}

<!-- A grid, not a flex column: a column would squeeze the wide parts to nothing. -->
<section class="grid grid-cols-[minmax(0,1fr)] gap-5" aria-labelledby="indicators-title">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="max-w-[70ch]">
      <h1 id="indicators-title" class="text-2xl font-semibold">Indikator</h1>
      <p class="text-sm text-base-content/70">
        Atur indikator chart yang bisa dipakai tiap paket. Member hanya melihat yang dibuka untuknya: di menu Indikator, notifikasi sinyal, dan Lab.
        Akses khusus menambah orang di luar paket; admin selalu melihat semuanya untuk mencoba.
      </p>
    </div>
    {#if !creating}
      <button class="btn btn-primary btn-sm" onclick={() => (creating = true)}>Indikator baru</button>
    {/if}
  </div>

  {#if error}<p role="alert" class="text-sm text-error">{error}</p>{/if}
  {#if notice}<p role="status" class="text-sm text-success">{notice}</p>{/if}

  {#if creating}
    <form class="grid gap-3 rounded-box border border-base-300 p-4 sm:grid-cols-2" onsubmit={create}>
      <h2 class="font-semibold sm:col-span-2">Indikator baru dari skrip</h2>
      <label class="flex flex-col gap-1 text-sm">
        Nama
        <input class="input input-sm w-full" required minlength="2" maxlength="60" placeholder="mis. Breakout Donchian" bind:value={form.name} />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        Penjelasan satu baris
        <input class="input input-sm w-full" maxlength="200" placeholder="Tampil di menu Indikator dan halaman harga" bind:value={form.description} />
      </label>
      {@render codeField(form, 'code-new')}
      <fieldset class="flex flex-col gap-1.5 text-sm">
        <legend class="mb-1">Paket yang bisa memakai <span class="text-base-content/60">(kosongkan dulu untuk mencoba sendiri)</span></legend>
        <div class="flex flex-wrap gap-4">
          {#each PLAN_IDS as p (p)}
            <label class="flex items-center gap-2">
              <input type="checkbox" class="checkbox checkbox-sm" checked={form.plans.includes(p)} onchange={() => (form.plans = toggled(form.plans, p))} />
              {PLANS[p].name}
            </label>
          {/each}
        </div>
      </fieldset>
      <label class="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" class="toggle toggle-sm" bind:checked={form.defaultOn} />
        Langsung nyala di chart member yang belum memilih indikator
      </label>
      <div class="flex gap-2 sm:col-span-2">
        <button class="btn btn-primary btn-sm" type="submit" disabled={busy}>Buat indikator</button>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          onclick={() => {
            creating = false;
            form = blank();
          }}>Batal</button
        >
      </div>
    </form>
  {/if}

  <datalist id="indicator-accounts">
    {#each accounts as a (a.id)}<option value={a.username}>{a.email ?? ''}</option>{/each}
  </datalist>

  {#if rows === null}
    <span class="loading loading-spinner loading-sm" aria-label="Memuat"></span>
  {:else}
    <ul class="grid gap-3">
      {#each rows as r (r.id)}
        <li class="flex flex-col gap-3 rounded-box border border-base-300 p-4" class:bg-base-200={!r.active}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex max-w-[70ch] min-w-0 flex-col gap-0.5">
              <h2 class="flex flex-wrap items-center gap-2 font-semibold">
                {r.name}
                <span class="badge badge-sm {r.builtin ? 'badge-ghost' : 'badge-soft badge-info'}">{r.builtin ? 'Bawaan' : 'Skrip'}</span>
              </h2>
              {#if r.description}<p class="text-sm text-base-content/80">{r.description}</p>{/if}
              <p class="text-xs text-base-content/70">
                {r.active ? reach(r) : 'Nonaktif: tersembunyi dari semua member, notifikasinya dijeda'}
                · dipakai {r.alerts} notifikasi sinyal · urutan {r.sortOrder}
              </p>
            </div>
            <label class="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
              Aktif
              <input
                type="checkbox"
                class="toggle toggle-sm toggle-success"
                checked={r.active}
                disabled={busy}
                onchange={() => act(() => api.updateIndicator(r.id, { active: !r.active }), `${r.name} ${r.active ? 'dimatikan' : 'diaktifkan'}.`)}
              />
            </label>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <fieldset class="flex flex-col gap-1.5 text-sm">
              <legend class="mb-1">Paket yang bisa memakai</legend>
              <div class="flex flex-wrap gap-4">
                {#each PLAN_IDS as p (p)}
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={r.plans.includes(p)}
                      disabled={busy}
                      onchange={() => act(() => api.updateIndicator(r.id, { plans: toggled(r.plans, p) }), `Paket untuk ${r.name} disimpan.`)}
                    />
                    {PLANS[p].name}
                  </label>
                {/each}
              </div>
            </fieldset>
            <label class="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                checked={r.defaultOn}
                disabled={busy}
                onchange={() =>
                  act(() => api.updateIndicator(r.id, { defaultOn: !r.defaultOn }), `${r.name} ${r.defaultOn ? 'tidak lagi' : 'sekarang'} langsung nyala untuk member yang belum memilih.`)}
              />
              Langsung nyala di chart member yang belum memilih indikator
            </label>
          </div>

          <div class="flex flex-col gap-1.5 text-sm">
            <span>Akses khusus <span class="text-base-content/60">(bisa memakai apa pun paketnya)</span></span>
            <div class="flex flex-wrap items-center gap-2">
              {#each r.grants as g (g.id)}
                <span class="badge gap-1" title={g.email ?? ''}>
                  {g.username}
                  <button
                    type="button"
                    class="cursor-pointer text-base-content/70 hover:text-error"
                    aria-label="Cabut akses {g.username} ke {r.name}"
                    disabled={busy}
                    onclick={() =>
                      act(() => api.setIndicatorGrants(r.id, r.grants.filter((x) => x.id !== g.id).map((x) => x.id)), `Akses ${g.username} ke ${r.name} dicabut.`)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </span>
              {/each}
              <form
                class="join"
                onsubmit={(e) => {
                  e.preventDefault();
                  grant(r);
                }}
              >
                <input
                  class="input input-sm join-item w-52"
                  list="indicator-accounts"
                  placeholder="nama pengguna atau email"
                  aria-label="Beri akses {r.name} ke pengguna"
                  bind:value={who[r.id]}
                />
                <button class="btn btn-sm join-item" type="submit" disabled={busy || !(who[r.id] ?? '').trim()}>Beri akses</button>
              </form>
            </div>
          </div>

          {#if editing === r.id}
            <form class="grid gap-3 border-t border-base-300 pt-3 sm:grid-cols-2" onsubmit={(e) => save(e, r)}>
              <label class="flex flex-col gap-1 text-sm">
                Nama
                <input class="input input-sm w-full" required minlength="2" maxlength="60" disabled={Boolean(r.builtin)} bind:value={edit.name} />
                {#if r.builtin}<span class="text-xs text-base-content/70">Nama bawaan dipakai di pesan sinyal dan halaman publik.</span>{/if}
              </label>
              <label class="flex flex-col gap-1 text-sm">
                Urutan di menu
                <input class="input input-sm w-full" type="number" min="0" max="999" required bind:value={edit.sortOrder} />
              </label>
              <label class="flex flex-col gap-1 text-sm sm:col-span-2">
                Penjelasan satu baris
                <input class="input input-sm w-full" maxlength="200" bind:value={edit.description} />
              </label>
              {#if !r.builtin}{@render codeField(edit, `code-${r.id}`)}{/if}
              <div class="flex gap-2 sm:col-span-2">
                <button class="btn btn-primary btn-sm" type="submit" disabled={busy}>Simpan</button>
                <button class="btn btn-ghost btn-sm" type="button" onclick={() => (editing = null)}>Batal</button>
              </div>
            </form>
          {:else}
            <div class="flex gap-2">
              <button class="btn btn-sm" onclick={() => open(r)}>{r.builtin ? 'Ubah penjelasan' : 'Ubah'}</button>
              {#if !r.builtin}<button class="btn btn-ghost btn-sm text-error" disabled={busy} onclick={() => remove(r)}>Hapus</button>{/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
