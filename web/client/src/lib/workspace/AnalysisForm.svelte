<script lang="ts">
  // Start an analysis or a backtest for the symbol in focus. Team and model
  // settings fold away and are remembered between visits. Provider, models and
  // backend URL are an admin's: members run on the server's own (server/src/models.ts).
  import { api, type Catalog, type Provider } from '../api';
  import { auth } from '../auth.svelte';
  import { gridDates, today } from '../format';
  import { catalog } from '../stores/catalog.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { usage } from '../stores/usage.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { hasNoFundamentals } from '../tv';

  let { mode }: { mode: 'analysis' | 'backtest' } = $props();

  // Must match MAX_BACKTEST_CELLS on the server (default 40).
  const MAX_CELLS = 40;
  const STORAGE_KEY = 'tradingagents.form';
  const CUSTOM = 'custom';

  let submitting = $state(false);
  let submitError = $state('');

  let date = $state(today());
  let analysts = $state<string[]>(['market', 'social', 'news', 'fundamentals']);
  let depth = $state(1);
  let language = $state('Indonesian');
  let providerKey = $state('');
  let quickChoice = $state('');
  let deepChoice = $state('');
  let quickCustom = $state('');
  let deepCustom = $state('');
  let backendUrl = $state('');

  let tickersText = $state('');
  let start = $state(new Date(Date.now() - 90 * 86_400_000).toLocaleDateString('en-CA'));
  let end = $state(today());
  let everyNDays = $state(14);

  const options = $derived(catalog.value);
  const provider = $derived<Provider | undefined>(options?.providers.find((p) => p.key === providerKey));
  const ticker = $derived(ws.yahoo ?? '');
  const tickers = $derived([...new Set(tickersText.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))]);
  const cellCount = $derived(tickers.length * gridDates(start, end, everyNDays).length);
  const noFundamentals = $derived(
    mode === 'analysis' ? hasNoFundamentals(ticker) : tickers.length > 0 && tickers.every(hasNoFundamentals),
  );
  const showUrl = $derived(
    !!provider && (provider.needsUrl || provider.key === 'ollama' || provider.key === 'openai_compatible'),
  );
  const depthLabel = $derived(options?.depths.find((d) => d.value === depth)?.label ?? '');
  const modelLabel = $derived(deepChoice === CUSTOM ? deepCustom || 'model kustom' : deepChoice);

  // Every backtest cell is a full analysis, so it counts against the daily cap one by one.
  usage.refresh();
  const quota = $derived(usage.value?.analyses);
  const need = $derived(mode === 'analysis' ? 1 : cellCount);
  const overQuota = $derived(need > usage.left('analyses'));

  // The backtest list follows the symbol in focus; more tickers can be added by hand.
  $effect(() => {
    tickersText = ws.yahoo ?? '';
  });

  function pickModel(list: { value: string }[], preferred?: string) {
    if (preferred && list.some((o) => o.value === preferred)) return preferred;
    return list[0]?.value ?? CUSTOM;
  }

  function selectProvider(key: string, quick?: string, deep?: string) {
    providerKey = key;
    const p = options?.providers.find((x) => x.key === key);
    if (!p) return;
    quickChoice = pickModel(p.models.quick, quick);
    deepChoice = pickModel(p.models.deep, deep);
    // A remembered model the list no longer offers is kept as a custom ID.
    quickCustom = quick && quickChoice === CUSTOM && quick !== CUSTOM ? quick : '';
    deepCustom = deep && deepChoice === CUSTOM && deep !== CUSTOM ? deep : '';
    backendUrl = '';
  }

  function restore(c: Catalog) {
    let saved: Record<string, any> = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      saved = {};
    }
    if (Array.isArray(saved.analysts) && saved.analysts.length) analysts = saved.analysts;
    if ([1, 3, 5].includes(saved.depth)) depth = saved.depth;
    if (c.languages.includes(saved.language)) language = saved.language;
    if (c.providers.some((p) => p.key === saved.provider)) {
      selectProvider(saved.provider, saved.quickModel, saved.deepModel);
      if (typeof saved.backendUrl === 'string') backendUrl = saved.backendUrl;
    } else {
      selectProvider(c.defaults.provider, c.defaults.quickModel, c.defaults.deepModel);
    }
  }

  let restored = false;
  $effect(() => {
    if (options && !restored) {
      restored = true;
      restore(options);
    }
  });

  /** The settings both forms share, and the chat agent reads (stores/agent.svelte.ts). */
  function settings() {
    return {
      analysts,
      depth,
      provider: providerKey,
      quickModel: quickChoice === CUSTOM ? quickCustom.trim() : quickChoice,
      deepModel: deepChoice === CUSTOM ? deepCustom.trim() : deepChoice,
      language,
      backendUrl: showUrl ? backendUrl.trim() : '',
    };
  }

  // Remembered as soon as anything changes (every field's change event reaches
  // the form), so the chat agent uses a new model without running an analysis first.
  function persist() {
    if (!restored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings()));
    } catch {
      /* remembering the form is a convenience */
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    submitError = '';
    const shared = settings();
    if (!shared.quickModel || !shared.deepModel) {
      submitError = 'Isi ID model untuk quick dan deep thinking di Pengaturan.';
      return;
    }
    if (mode === 'analysis' && !ticker) {
      submitError = 'Simbol ini belum bisa dianalisa engine.';
      return;
    }
    if (mode === 'backtest' && (tickers.length === 0 || cellCount === 0)) {
      submitError = 'Isi ticker dan rentang tanggal yang menghasilkan minimal satu sel.';
      return;
    }
    submitting = true;
    try {
      if (mode === 'analysis') {
        const { id } = await api.create({ ...shared, ticker, date });
        ws.openRun(id, { show: false });
        ws.setDock('log');
      } else {
        const { id } = await api.createBacktest({ ...shared, tickers, start, end, everyNDays });
        ws.openBacktest(id);
      }
      jobs.refresh();
      usage.refresh();
      persist();
    } catch (e) {
      submitError = (e as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<form class="flex flex-col gap-3" onsubmit={submit} onchange={persist}>
  {#if catalog.error}
    <p role="alert" class="text-sm text-error">Opsi model gagal dimuat: {catalog.error}</p>
  {/if}

  {#if mode === 'analysis'}
    <fieldset class="fieldset py-0">
      <legend class="fieldset-legend pt-0">Tanggal analisa</legend>
      <input class="input input-sm w-full" type="date" bind:value={date} max={today()} required />
    </fieldset>
  {:else}
    <fieldset class="fieldset py-0">
      <legend class="fieldset-legend pt-0">Ticker (maks 5, pisahkan koma)</legend>
      <input class="input input-sm w-full font-mono uppercase" bind:value={tickersText} placeholder="BBCA.JK, BMRI.JK" required autocomplete="off" />
    </fieldset>
    <div class="grid grid-cols-2 gap-2">
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Dari</legend>
        <input class="input input-sm w-full" type="date" bind:value={start} max={end} required />
      </fieldset>
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend pt-0">Sampai</legend>
        <input class="input input-sm w-full" type="date" bind:value={end} min={start} max={today()} required />
      </fieldset>
    </div>
    <fieldset class="fieldset py-0">
      <legend class="fieldset-legend pt-0">Analisa setiap</legend>
      <select class="select select-sm w-full" bind:value={everyNDays}>
        {#each [1, 3, 7, 14, 30] as n (n)}<option value={n}>{n} hari</option>{/each}
      </select>
    </fieldset>
    <p class="text-xs tabular-nums" class:text-warning={cellCount > MAX_CELLS} class:text-base-content={cellCount <= MAX_CELLS}>
      <strong>{cellCount} sel</strong> = {tickers.length} ticker × {gridDates(start, end, everyNDays).length} tanggal.
      {#if cellCount > MAX_CELLS}Batas {MAX_CELLS}; persempit rentang atau perbesar jarak.{:else}Tiap sel = biaya satu analisa penuh.{/if}
    </p>
  {/if}

  <details class="collapse collapse-arrow rounded-field border border-base-300">
    <summary class="collapse-title min-h-0 px-3 py-2 text-sm">
      <span class="font-medium">Pengaturan</span>
      <span class="block truncate text-xs text-base-content/70">
        {#if auth.isAdmin}{providerKey || '…'} · {modelLabel || '…'} · {/if}{depthLabel} · {language} · {analysts.length} analis
      </span>
    </summary>
    <div class="collapse-content flex flex-col gap-2 px-3">
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend">Tim analis</legend>
        <div class="grid grid-cols-2 gap-1.5">
          {#each options?.analysts ?? [] as a (a.value)}
            {@const disabled = noFundamentals && a.value === 'fundamentals'}
            <label class="label cursor-pointer gap-2 text-xs text-base-content" class:opacity-50={disabled}>
              <input type="checkbox" class="checkbox checkbox-xs" value={a.value} bind:group={analysts} {disabled} />
              {a.label.replace(' Analyst', '')}
            </label>
          {/each}
        </div>
      </fieldset>
      <div class="grid grid-cols-2 gap-2">
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Kedalaman</legend>
          <select class="select select-sm w-full" bind:value={depth}>
            {#each options?.depths ?? [] as d (d.value)}<option value={d.value}>{d.label}</option>{/each}
          </select>
        </fieldset>
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Bahasa</legend>
          <select class="select select-sm w-full" bind:value={language}>
            {#each options?.languages ?? [] as l (l)}<option value={l}>{l}</option>{/each}
          </select>
        </fieldset>
      </div>
      {#if auth.isAdmin}
      <fieldset class="fieldset py-0">
        <legend class="fieldset-legend">Provider LLM</legend>
        <select class="select select-sm w-full" value={providerKey} onchange={(e) => selectProvider(e.currentTarget.value)}>
          {#each options?.providers ?? [] as p (p.key)}
            <option value={p.key}>{p.label}{p.hasKey ? '' : ' (key belum diset)'}</option>
          {/each}
        </select>
        {#if provider && !provider.hasKey}
          <p class="text-xs text-warning">Isi <code class="font-mono">{provider.apiKeyEnv}</code> di <code class="font-mono">.env</code>, lalu muat ulang.</p>
        {/if}
      </fieldset>
      {#if showUrl}
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Backend URL{provider?.needsUrl ? '' : ' (opsional)'}</legend>
          <input class="input input-sm w-full" type="url" bind:value={backendUrl} placeholder={provider?.defaultUrl ?? 'http://localhost:8000/v1'} required={provider?.needsUrl} />
        </fieldset>
      {/if}
      {#if provider}
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Model quick</legend>
          {#if provider.models.quick.length}
            <select class="select select-sm w-full" bind:value={quickChoice}>
              {#each provider.models.quick as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          {/if}
          {#if quickChoice === CUSTOM}<input class="input input-sm w-full" bind:value={quickCustom} placeholder="ID model" required />{/if}
        </fieldset>
        <fieldset class="fieldset py-0">
          <legend class="fieldset-legend">Model deep</legend>
          {#if provider.models.deep.length}
            <select class="select select-sm w-full" bind:value={deepChoice}>
              {#each provider.models.deep as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          {/if}
          {#if deepChoice === CUSTOM}<input class="input input-sm w-full" bind:value={deepCustom} placeholder="ID model" required />{/if}
        </fieldset>
      {/if}
      {/if}
    </div>
  </details>

  {#if submitError}
    <p role="alert" class="text-sm text-error">{submitError}</p>
  {/if}

  <button
    class="btn btn-primary btn-sm whitespace-nowrap"
    type="submit"
    disabled={!options ||
      submitting ||
      analysts.length === 0 ||
      (mode === 'analysis' && !ticker) ||
      (mode === 'backtest' && (cellCount === 0 || cellCount > MAX_CELLS || tickers.length > 5)) ||
      overQuota}
  >
    {#if submitting}<span class="loading loading-spinner loading-xs"></span>{/if}
    {#if mode === 'analysis'}Analisa {ticker || 'simbol ini'}{:else}Mulai backtest · {cellCount} sel{/if}
  </button>
  {#if quota?.limit}
    <p class="text-xs tabular-nums" class:text-warning={overQuota} class:text-base-content={!overQuota}>
      Kuota hari ini: {quota.used} / {quota.limit} analisa{#if overQuota}. Tidak cukup untuk {need}; reset pukul 00.00 WIB.{/if}
    </p>
  {/if}
</form>
