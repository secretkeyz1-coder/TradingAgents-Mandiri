<script lang="ts">
  // Konsol admin → Pengaturan analisa: the team, depth, language, provider, models and backend URL
  // the admin's own analyses, backtests and chat run with (stores/analysisSettings), kept in this
  // browser and saved on every change. Members never use these: they run the standard analysis on
  // the server's models. The forms in the app only show a line of what is set here.
  import { analysisSettings as s, CUSTOM } from '../stores/analysisSettings.svelte';
  import { catalog } from '../stores/catalog.svelte';

  catalog.load();
  const options = $derived(catalog.value);
  $effect(() => {
    if (options) s.restore(options);
  });

  let saved = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function save() {
    s.save();
    saved = true;
    clearTimeout(timer);
    timer = setTimeout(() => (saved = false), 1500);
  }
</script>

<section class="flex flex-col gap-5" aria-labelledby="analysis-settings-title">
  <div>
    <h1 id="analysis-settings-title" class="text-2xl font-semibold">Pengaturan analisa</h1>
    <p class="max-w-[70ch] text-sm text-base-content/70">
      Dipakai analisa, uji saran AI, dan Tanya AI yang kamu jalankan dari browser ini. Member selalu memakai analisa standar dengan model bawaan server, apa pun yang diatur di sini.
    </p>
  </div>
  {#if catalog.error}<p role="alert" class="text-sm text-error">Opsi model gagal dimuat: {catalog.error}</p>{/if}
  {#if !options}
    {#if !catalog.error}<p class="text-sm text-base-content/70">Memuat…</p>{/if}
  {:else}
    <form class="grid max-w-2xl gap-4" onchange={save} onsubmit={(e) => e.preventDefault()}>
      <fieldset class="fieldset">
        <legend class="fieldset-legend">Tim analis</legend>
        <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {#each options.analysts as a (a.value)}
            <label class="label cursor-pointer gap-2 text-sm text-base-content">
              <input type="checkbox" class="checkbox checkbox-sm" value={a.value} bind:group={s.analysts} />
              {a.label.replace(' Analyst', '')}
            </label>
          {/each}
        </div>
        <p class="text-xs text-base-content/70">Analis fundamental dilewati untuk aset tanpa laporan keuangan (kripto, forex, komoditas).</p>
      </fieldset>
      <div class="grid gap-3 sm:grid-cols-2">
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Kedalaman</legend>
          <select class="select select-sm w-full" bind:value={s.depth}>
            {#each options.depths as d (d.value)}<option value={d.value}>{d.label}</option>{/each}
          </select>
        </fieldset>
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Bahasa laporan</legend>
          <select class="select select-sm w-full" bind:value={s.language}>
            {#each options.languages as l (l)}<option value={l}>{l}</option>{/each}
          </select>
        </fieldset>
      </div>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend">Provider LLM</legend>
        <select class="select select-sm w-full" value={s.providerKey} onchange={(e) => s.selectProvider(e.currentTarget.value)}>
          {#each options.providers as p (p.key)}
            <option value={p.key}>{p.label}{p.hasKey ? '' : ' (key belum diset)'}</option>
          {/each}
        </select>
        {#if s.provider && !s.provider.hasKey}
          <p class="text-xs text-warning">Isi <code class="font-mono">{s.provider.apiKeyEnv}</code> di <code class="font-mono">.env</code> server, lalu jalankan ulang.</p>
        {/if}
      </fieldset>
      {#if s.showUrl}
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Backend URL{s.provider?.needsUrl ? '' : ' (opsional)'}</legend>
          <input class="input input-sm w-full" type="url" bind:value={s.backendUrl} placeholder={s.provider?.defaultUrl ?? 'http://localhost:8000/v1'} required={s.provider?.needsUrl} />
        </fieldset>
      {/if}
      {#if s.provider}
        <div class="grid gap-3 sm:grid-cols-2">
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend">Model quick</legend>
            {#if s.provider.models.quick.length}
              <select class="select select-sm w-full" bind:value={s.quickChoice}>
                {#each s.provider.models.quick as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
              </select>
            {/if}
            {#if s.quickChoice === CUSTOM}<input class="input input-sm w-full" bind:value={s.quickCustom} placeholder="ID model" required />{/if}
          </fieldset>
          <fieldset class="fieldset py-0">
            <legend class="fieldset-legend">Model deep</legend>
            {#if s.provider.models.deep.length}
              <select class="select select-sm w-full" bind:value={s.deepChoice}>
                {#each s.provider.models.deep as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
              </select>
            {/if}
            {#if s.deepChoice === CUSTOM}<input class="input input-sm w-full" bind:value={s.deepCustom} placeholder="ID model" required />{/if}
          </fieldset>
        </div>
      {/if}
    </form>
    <p class="text-xs text-base-content/70" role="status">{saved ? 'Tersimpan.' : 'Tersimpan otomatis setiap ada perubahan.'}</p>
  {/if}
</section>
