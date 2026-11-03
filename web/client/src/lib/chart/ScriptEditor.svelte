<script lang="ts">
  // Write, test, translate and save an indicator script. A test runs it in the
  // same sandbox the chart, the alerts and the agent use, on the bars the AI
  // chart has loaded; "Bandingkan dengan server" runs it on the server too and
  // checks both give the same signals. The AI writes one from Pine Script, or
  // from a prompt in two steps: a plan of rules the user ticks (what a script can
  // compute, what was changed to be testable, what no script can do), then the
  // script from the rules kept. The server tests every AI draft on the open chart
  // and has the AI repair what failed; its steps show as they stream in, and the
  // result (the test, and for Pine what was kept, changed and dropped) sits under
  // the code. Panduan teaches the language, with Pine's words next to its own.
  import { api, type ScriptDraft, type ScriptPlan } from '../api';
  import { runInSandbox } from '../indicators/script-host';
  import { settings as modelSettings } from '../stores/agent.svelte';
  import { catalog } from '../stores/catalog.svelte';
  import { indicators } from '../stores/indicators.svelte';
  import { scripts } from '../stores/scripts.svelte';
  import { ws } from '../stores/workspace.svelte';
  import { venueOf } from '../tv';
  import Icon from '../workspace/Icon.svelte';
  import type { ScriptRun } from '../../../../shared/script';

  let id = $state<string | null>(null);
  let name = $state('');
  let code = $state('');
  let pine = $state<string | null>(null);
  let tab = $state<'code' | 'pine' | 'prompt' | 'help'>('code');
  let pineText = $state('');
  let promptText = $state('');
  let plan = $state<ScriptPlan | null>(null);
  /** Which of the plan's rules go into the script, by index. */
  let kept = $state<boolean[]>([]);
  const keptCount = $derived(kept.filter(Boolean).length);
  let run = $state<ScriptRun | null>(null);
  let busy = $state<'' | 'test' | 'save' | 'compare' | 'translate' | 'plan' | 'compose' | 'delete'>('');
  let note = $state('');
  let error = $state('');
  let confirmDelete = $state(false);
  /** The AI's last script for the one open: its report, its test on the chart and the repairs it took. */
  let draft = $state<ScriptDraft | null>(null);
  let draftOpen = $state(true);
  /** The AI's steps as they stream in. */
  let steps = $state<string[]>([]);
  let working: AbortController | null = null;

  function pick(sid: string | null) {
    const s = sid ? scripts.items.find((x) => x.id === sid) : null;
    id = s?.id ?? null;
    name = s?.name ?? 'Skrip baru';
    code = s?.code ?? scripts.templates[0]?.code ?? '';
    pine = s?.pine ?? null;
    run = null;
    note = error = '';
    confirmDelete = false;
    plan = null;
    draft = null;
    steps = [];
    tab = 'code';
  }
  scripts.load().then(() => {
    pick(scripts.editing);
    tab = scripts.startTab;
  });
  // The model the AI writes with comes from the form options, which only the AI panel loaded: opened from Uji strategi
  // → Indikator, the editor said no model was set.
  catalog.load();

  function useTemplate(t: { name: string; code: string }) {
    code = t.code;
    if (!id) name = t.name;
    run = null;
    draft = null;
  }

  async function test() {
    error = note = '';
    if (!scripts.bars.length) {
      error = 'Buka chart Sinyal (15 menit, 1 jam, 4 jam, atau harian) dulu: skrip diuji pada candle yang sedang dimuat.';
      return;
    }
    busy = 'test';
    run = await runInSandbox(code, scripts.bars, undefined, scripts.context);
    busy = '';
  }

  async function compare() {
    error = note = '';
    if (!ws.yahoo || !['15m', '1h', '4h', '1d'].includes(ws.timeframe)) {
      error = 'Pilih simbol dan timeframe 15 menit, 1 jam, 4 jam, atau harian di chart Sinyal.';
      return;
    }
    busy = 'compare';
    try {
      const [server, local] = await Promise.all([
        api.runScriptOnServer({ code, symbol: ws.yahoo, timeframe: ws.timeframe }),
        scripts.bars.length ? runInSandbox(code, scripts.bars, undefined, scripts.context) : Promise.resolve(null),
      ]);
      if (!server.ok) error = `Server: ${server.error}`;
      else if (!local || !local.ok) error = 'Uji di chart gagal; perbaiki dulu error-nya.';
      else {
        const key = (s: { time: string; entry: number }) => `${s.time}|${s.entry.toFixed(6)}`;
        const mine = local.result.signals.slice(-10).map(key);
        const theirs = (server.signals ?? []).map(key);
        const same = mine.length === theirs.length && mine.every((k, i) => k === theirs[i]);
        note = same
          ? `Identik: ${mine.length} sinyal terakhir sama persis di chart dan server (server ${server.stats?.count} sinyal pada ${server.bars} candle).`
          : `Berbeda di 10 sinyal terakhir (chart ${local.result.stats.count} sinyal pada ${scripts.bars.length} candle, server ${server.stats?.count} pada ${server.bars}). Biasanya karena data Yahoo baru saja bertambah satu candle di antara dua permintaan; coba lagi.`;
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = '';
    }
  }

  async function save() {
    error = note = '';
    busy = 'save';
    try {
      const saved = await scripts.save(id, { name: name.trim(), code, pine });
      id = saved.id;
      indicators.toggleScript(saved.id, true);
      note = 'Tersimpan dan ditampilkan di chart. Nyalakan di menu Notifikasi bila ingin pesan Telegram.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = '';
    }
  }

  async function remove() {
    if (!id) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    busy = 'delete';
    try {
      indicators.toggleScript(id, false);
      await scripts.remove(id);
      pick(null);
      note = 'Skrip dan notifikasinya dihapus.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = '';
    }
  }

  const NO_MODEL = 'Model AI belum diatur. Admin mengaturnya di Konsol admin → Pengaturan analisa.';
  const SCRIPT_TIMEFRAMES = ['15m', '1h', '4h', '1d'];
  /** The chart the AI's draft is tested on: the one open in the workspace. */
  const chart = () => ({
    symbol: ws.yahoo || undefined,
    timeframe: SCRIPT_TIMEFRAMES.includes(ws.timeframe) ? ws.timeframe : undefined,
    venue: venueOf(ws.symbol) ?? undefined,
  });

  type Model = NonNullable<ReturnType<typeof modelSettings>>;
  /** One piece of the AI's work, its steps shown as they come; null when it failed (the error shows) or was stopped. */
  async function aiStep<T>(kind: 'translate' | 'plan' | 'compose', work: (model: Model, onStep: (text: string) => void, signal: AbortSignal) => Promise<T>) {
    error = note = '';
    await catalog.load();
    const model = modelSettings();
    if (!model) {
      error = NO_MODEL;
      return null;
    }
    busy = kind;
    steps = [];
    working = new AbortController();
    try {
      return await work(model, (text) => (steps = [...steps, text]), working.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error = (e as Error).message;
      return null;
    } finally {
      busy = '';
      working = null;
    }
  }
  const stop = () => working?.abort();

  async function translate() {
    const out = await aiStep('translate', (model, onStep, signal) =>
      api.translateScript({ pine: pineText, ...model, backendUrl: model.backendUrl, ...chart() }, onStep, signal),
    );
    if (!out) return;
    code = out.code;
    pine = pineText;
    draft = out;
    draftOpen = true;
    if (!id) name = (pineText.match(/(?:indicator|strategy)\(\s*["']([^"']+)/)?.[1] ?? 'Terjemahan Pine').slice(0, 40);
    tab = 'code';
    await test();
    note = 'Terjemahan AI siap. Periksa kode, laporan dan hasil uji sebelum disimpan: terjemahan bisa keliru.';
  }

  /** A prompt, step one: the AI's plan, every rule ticked to start with. */
  async function makePlan() {
    const out = await aiStep('plan', (model, onStep, signal) => api.planScript({ prompt: promptText, ...model, backendUrl: model.backendUrl }, onStep, signal));
    if (!out) return;
    plan = out.plan;
    kept = out.plan.rules.map(() => true);
  }

  /** A name from the prompt's first line, without the symbols and emoji a prompt often opens with. */
  const nameFrom = (text: string) =>
    (text
      .split('\n')
      .map((l) => l.replace(/^[^\p{L}\p{N}]+/u, '').trim())
      .find(Boolean) ?? 'Dari prompt'
    ).slice(0, 40);

  /** Step two: the script from the rules kept, tested and repaired on the server, then on the chart's bars here. */
  async function compose() {
    if (!plan) return;
    const rules = plan.rules.filter((_, i) => kept[i]).map((r) => (r.param ? `${r.text} (${r.param})` : r.text));
    const out = await aiStep('compose', (model, onStep, signal) =>
      api.composeScript({ prompt: promptText, rules, ...model, backendUrl: model.backendUrl, ...chart() }, onStep, signal),
    );
    if (!out) return;
    code = out.code;
    pine = null;
    draft = out;
    draftOpen = true;
    if (!id) name = nameFrom(promptText);
    tab = 'code';
    await test();
    note = 'Skrip dari prompt siap. Periksa kode dan hasil uji sebelum disimpan: tulisan AI bisa keliru.';
  }

  /** Scrolls the guide to a section: buttons, not links, since the workspace keeps its state in the URL hash. */
  const goTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  // Tab indents instead of leaving the editor.
  function indent(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const t = e.currentTarget as HTMLTextAreaElement;
    const at = t.selectionStart;
    code = `${code.slice(0, at)}  ${code.slice(t.selectionEnd)}`;
    requestAnimationFrame(() => t.setSelectionRange(at + 2, at + 2));
  }

  const close = () => (scripts.editorOpen = false);
  const OUTCOME: Record<string, string> = {
    win: 'TP',
    loss: 'SL',
    partial: 'TP1 lalu SL/impas',
    exit: 'keluar (kondisi)',
    expired: 'kedaluwarsa',
    unfilled: 'tidak terisi',
    open: 'berjalan',
  };
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

{#snippet progress()}
  {#if steps.length}
    <ol class="flex flex-col gap-1 text-sm" aria-label="Langkah AI">
      {#each steps as text, i (i)}
        <li class="flex items-start gap-2">
          {#if i === steps.length - 1 && busy !== ''}
            <span class="loading loading-spinner loading-xs mt-1 shrink-0" aria-hidden="true"></span>
          {:else}
            <Icon name="check" size={16} class="mt-0.5 shrink-0 text-success" />
          {/if}
          <span class={i < steps.length - 1 ? 'text-base-content/70' : ''}>{text}</span>
        </li>
      {/each}
    </ol>
  {/if}
{/snippet}

{#snippet aiButton(kind: 'translate' | 'plan' | 'compose', label: string, busyLabel: string, disabled: boolean, onclick: () => void)}
  <div class="flex flex-wrap items-center gap-2">
    <button class="btn btn-primary btn-sm" disabled={busy !== '' || disabled} {onclick}>
      {#if busy === kind}<span class="loading loading-spinner loading-xs"></span> {busyLabel}{:else}{label}{/if}
    </button>
    {#if busy === kind}<button class="btn btn-ghost btn-sm" onclick={stop}>Hentikan</button>{/if}
  </div>
{/snippet}

<div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div
    class="ta-window flex h-[min(820px,94vh)] w-[min(1120px,96vw)] overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-label="Editor skrip indikator"
  >
    <!-- Menus, not buttons: a long name wraps left-aligned onto a second line instead of centring or spilling out of a fixed-height button. -->
    <aside class="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-base-300 p-3 md:flex">
      <span class="px-3 text-xs font-semibold text-base-content/70">Skrip Anda ({scripts.items.length}/{scripts.max})</span>
      <!-- The open script is tinted like the workspace's current tab, not daisyUI's solid neutral block. -->
      <ul class="menu w-full gap-0.5 p-0 [--menu-active-bg:color-mix(in_oklch,var(--color-accent)_16%,transparent)] [--menu-active-fg:var(--color-base-content)]">
        {#each scripts.items as s (s.id)}
          <li><button class:menu-active={id === s.id} aria-current={id === s.id ? 'true' : undefined} onclick={() => pick(s.id)}>{s.name}</button></li>
        {/each}
      </ul>
      <button class="btn btn-sm mt-1" onclick={() => pick(null)}>+ Skrip baru</button>
      <span class="mt-4 px-3 text-xs font-semibold text-base-content/70">Template</span>
      <ul class="menu w-full gap-0.5 p-0">
        {#each scripts.templates as t (t.name)}
          <li><button onclick={() => useTemplate(t)}>{t.name}</button></li>
        {/each}
      </ul>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-2 border-b border-base-300 p-3">
        <label class="sr-only" for="script-name">Nama skrip</label>
        <input id="script-name" class="input input-sm max-w-72 flex-1 font-medium" bind:value={name} maxlength="40" />
        <div class="join" role="group" aria-label="Bagian editor">
          <button class="btn btn-xs join-item" class:btn-active={tab === 'code'} onclick={() => (tab = 'code')}>Kode</button>
          <button class="btn btn-xs join-item" class:btn-active={tab === 'pine'} onclick={() => (tab = 'pine')}>Dari Pine</button>
          <button class="btn btn-xs join-item" class:btn-active={tab === 'prompt'} onclick={() => (tab = 'prompt')}>Dari prompt</button>
          <button class="btn btn-xs join-item" class:btn-active={tab === 'help'} onclick={() => (tab = 'help')}>Panduan</button>
        </div>
        <button class="btn btn-ghost btn-sm btn-square ml-auto" aria-label="Tutup editor" onclick={close}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {#if tab === 'code'}
          <label class="sr-only" for="script-code">Kode skrip</label>
          <textarea
            id="script-code"
            class="textarea min-h-0 w-full flex-1 resize-none font-mono text-xs leading-5"
            spellcheck="false"
            bind:value={code}
            onkeydown={indent}
          ></textarea>
          {#if draft}
            <details class="group max-h-64 shrink-0 overflow-y-auto overscroll-contain rounded-box border border-base-300 text-sm" bind:open={draftOpen}>
              <summary class="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                {#if !draft.check}
                  <span class="badge badge-sm badge-ghost">Belum diuji</span>
                {:else if draft.check.problems.length}
                  <span class="badge badge-sm badge-soft badge-warning">{draft.check.problems.length} masalah tersisa</span>
                {:else}
                  <span class="badge badge-sm badge-soft badge-success">Lolos uji</span>
                {/if}
                <span class="font-medium">Hasil AI</span>
                <span class="text-base-content/70">
                  {draft.check ? `diuji di ${draft.check.where}, ${draft.check.bars.toLocaleString('id-ID')} candle` : ''}{draft.repairs
                    ? ` · diperbaiki AI ${draft.repairs} kali`
                    : ''}
                </span>
                <span class="ml-auto text-xs text-base-content/70">{draftOpen ? 'Sembunyikan' : 'Lihat laporan'}</span>
              </summary>
              <div class="flex flex-col gap-3 border-t border-base-300 px-3 py-2">
                {#if draft.note}
                  <p class="flex items-start gap-2"><Icon name="alert" size={16} class="mt-0.5 shrink-0 text-warning" />{draft.note}</p>
                {/if}
                {#if draft.check?.problems.length}
                  <section class="flex flex-col gap-1" aria-labelledby="draft-problems">
                    <h3 id="draft-problems" class="font-semibold">Masalah yang tersisa</h3>
                    <ul class="flex flex-col gap-1">
                      {#each draft.check.problems as problem, i (i)}
                        <li class="flex items-start gap-2"><Icon name="alert" size={16} class="mt-0.5 shrink-0 text-warning" />{problem}</li>
                      {/each}
                    </ul>
                    <p class="text-base-content/70">Perbaiki di kode, atau terjemahkan lagi.</p>
                  </section>
                {:else if draft.check}
                  <p class="text-base-content/80">
                    Jalan tanpa error, tidak membaca candle sesudah sinyal, dan entry-nya terisi di harga yang terjadi. Apakah logikanya sama dengan aslinya, tetap
                    periksa sendiri.
                  </p>
                {/if}
                {#if draft.report}
                  {#if draft.report.kept.length}
                    <section class="flex flex-col gap-1" aria-labelledby="draft-kept">
                      <h3 id="draft-kept" class="font-semibold">Dibawa <span class="badge badge-sm tabular-nums">{draft.report.kept.length}</span></h3>
                      <ul class="flex flex-col gap-1">
                        {#each draft.report.kept as item, i (i)}
                          <li class="flex items-start gap-2"><Icon name="check" size={16} class="mt-0.5 shrink-0 text-success" />{item}</li>
                        {/each}
                      </ul>
                    </section>
                  {/if}
                  {#if draft.report.changed.length}
                    <section class="flex flex-col gap-1" aria-labelledby="draft-changed">
                      <h3 id="draft-changed" class="font-semibold">Diubah <span class="badge badge-sm tabular-nums">{draft.report.changed.length}</span></h3>
                      <ul class="flex flex-col gap-1">
                        {#each draft.report.changed as item, i (i)}
                          <li class="flex items-start gap-2">
                            <Icon name="alert" size={16} class="mt-0.5 shrink-0 text-warning" />
                            <span><span class="font-medium">{item.what}</span>{#if item.how}<span class="block text-base-content/70">{item.how}</span>{/if}</span>
                          </li>
                        {/each}
                      </ul>
                    </section>
                  {/if}
                  {#if draft.report.dropped.length}
                    <section class="flex flex-col gap-1" aria-labelledby="draft-dropped">
                      <h3 id="draft-dropped" class="font-semibold">Dibuang <span class="badge badge-sm tabular-nums">{draft.report.dropped.length}</span></h3>
                      <ul class="flex flex-col gap-1">
                        {#each draft.report.dropped as item, i (i)}
                          <li class="flex items-start gap-2">
                            <Icon name="minus" size={16} class="mt-0.5 shrink-0 text-base-content/60" />
                            <span><span class="font-medium">{item.what}</span>{#if item.why}<span class="block text-base-content/70">{item.why}</span>{/if}</span>
                          </li>
                        {/each}
                      </ul>
                    </section>
                  {/if}
                {/if}
              </div>
            </details>
          {/if}
        {:else if tab === 'pine'}
          <p class="text-sm text-base-content/80">
            Tempel skrip Pine Script (TradingView). AI menerjemahkannya, lalu server mengujinya di chart yang terbuka: harus jalan, tidak membaca candle
            sesudah sinyal, dan entry-nya terisi di harga yang terjadi. Yang gagal dikembalikan ke AI untuk diperbaiki, paling banyak 2 kali. Hasilnya
            datang dengan laporan apa yang dibawa, diubah dan dibuang. Bisa makan beberapa menit; padanan Pine ada di tab Panduan.
          </p>
          <label class="sr-only" for="pine-code">Skrip Pine</label>
          <textarea id="pine-code" class="textarea min-h-0 w-full flex-1 resize-none font-mono text-xs leading-5" spellcheck="false" bind:value={pineText} placeholder="//@version=6&#10;indicator(&quot;...&quot;)"></textarea>
          {@render aiButton('translate', 'Terjemahkan dengan AI', 'Menerjemahkan…', pineText.trim().length < 20, translate)}
          {#if busy === 'translate'}{@render progress()}{/if}
        {:else if tab === 'prompt'}
          <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" aria-label="Langkah">
            <li class="flex items-center gap-1.5" class:font-semibold={!plan} aria-current={!plan ? 'step' : undefined}>
              <span class="badge badge-sm {plan ? 'badge-soft badge-success' : 'badge-primary'}">1</span>Prompt
            </li>
            <li aria-hidden="true" class="text-base-content/50">›</li>
            <li class="flex items-center gap-1.5" class:font-semibold={!!plan} aria-current={plan ? 'step' : undefined}>
              <span class="badge badge-sm {plan ? 'badge-primary' : 'badge-ghost'}">2</span>Rencana skrip
            </li>
            <li aria-hidden="true" class="text-base-content/50">›</li>
            <li class="flex items-center gap-1.5"><span class="badge badge-sm badge-ghost">3</span>Kode dan uji di chart</li>
          </ol>
          {#if !plan}
            <p class="text-sm text-base-content/80">
              Tempel prompt analisa, atau tulis aturan strategimu dengan kata-kata. AI memisahkan dulu aturan yang bisa dihitung dari harga, yang diubah supaya bisa
              diuji, dan yang tidak bisa jadi skrip. Kamu memilih aturannya, lalu AI menulis skripnya. Memakai model AI di pengaturan analisa Anda, 2 pesan dari kuota
              chat harian.
            </p>
            <label class="sr-only" for="prompt-text">Prompt atau aturan strategi</label>
            <textarea
              id="prompt-text"
              class="textarea min-h-0 w-full flex-1 resize-none text-sm leading-6"
              bind:value={promptText}
              placeholder="Contoh: cari break of structure dari swing terakhir di 1 jam, lalu entry saat harga kembali ke level itu. SL di balik swing, TP minimal 2 kali risiko."
            ></textarea>
            {@render aiButton('plan', 'Buat rencana skrip', 'Membuat rencana…', promptText.trim().length < 20, makePlan)}
            {#if busy === 'plan'}{@render progress()}{/if}
          {:else}
            <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain rounded-box border border-base-300 bg-base-200 p-3 text-sm">
              {#if plan.summary}<p class="leading-relaxed">{plan.summary}</p>{/if}
              <section class="flex flex-col gap-1" aria-labelledby="plan-keep">
                <h3 id="plan-keep" class="flex items-center gap-2 font-semibold">Akan dikodekan <span class="badge badge-sm tabular-nums">{keptCount} dari {plan.rules.length}</span></h3>
                <ul class="flex flex-col">
                  {#each plan.rules as r, i (i)}
                    <li class="border-t border-base-300 first:border-t-0">
                      <label class="flex cursor-pointer items-start gap-2.5 py-1.5">
                        <input type="checkbox" class="checkbox checkbox-sm mt-0.5" bind:checked={kept[i]} />
                        <span class="min-w-0 flex-1">{r.text}</span>
                        {#if r.param}<span class="badge badge-sm badge-ghost h-auto min-h-5 shrink-0 py-0.5 text-right">{r.param}</span>{/if}
                      </label>
                    </li>
                  {/each}
                </ul>
              </section>
              {#if plan.adapted.length}
                <section class="flex flex-col gap-1.5" aria-labelledby="plan-adapted">
                  <h3 id="plan-adapted" class="font-semibold">Diubah supaya bisa diuji</h3>
                  <ul class="flex flex-col gap-1.5">
                    {#each plan.adapted as a, i (i)}
                      <li class="flex items-start gap-2"><Icon name="alert" size={16} class="mt-0.5 shrink-0 text-warning" />{a}</li>
                    {/each}
                  </ul>
                </section>
              {/if}
              {#if plan.dropped.length}
                <section class="flex flex-col gap-1.5" aria-labelledby="plan-dropped">
                  <h3 id="plan-dropped" class="font-semibold">Tidak bisa jadi skrip</h3>
                  <ul class="flex flex-col gap-1.5">
                    {#each plan.dropped as d, i (i)}
                      <li class="flex items-start gap-2">
                        <Icon name="minus" size={16} class="mt-0.5 shrink-0 text-base-content/60" />
                        <span><span class="font-medium">{d.text}</span>{#if d.why}<span class="block text-base-content/70">{d.why}</span>{/if}</span>
                      </li>
                    {/each}
                  </ul>
                </section>
              {/if}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {@render aiButton('compose', `Tulis skrip dari ${keptCount} aturan`, 'Menulis skrip…', !keptCount, compose)}
              {#if busy !== 'compose'}<button class="btn btn-ghost btn-sm" disabled={busy !== ''} onclick={() => (plan = null)}>Ubah prompt</button>{/if}
            </div>
            {#if busy === 'compose'}{@render progress()}{/if}
          {/if}
        {:else}
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <nav class="mb-4 flex flex-wrap gap-1" aria-label="Isi panduan">
              {#each scripts.guide as g (g.id)}<button class="btn btn-ghost btn-xs" onclick={() => goTo(`panduan-${g.id}`)}>{g.title}</button>{/each}
              <button class="btn btn-ghost btn-xs" onclick={() => goTo('panduan-kamus')}>Kamus Pine</button>
              <button class="btn btn-ghost btn-xs" onclick={() => goTo('panduan-referensi')}>Referensi bahasa</button>
            </nav>
            {#each scripts.guide as g (g.id)}
              <section id="panduan-{g.id}" class="mb-6 flex max-w-3xl scroll-mt-2 flex-col gap-2 text-sm leading-relaxed" aria-labelledby="panduan-{g.id}-h">
                <h3 id="panduan-{g.id}-h" class="text-base font-semibold">{g.title}</h3>
                {#each g.body as paragraph, i (i)}<p>{paragraph}</p>{/each}
                {#if g.steps}
                  <ol class="flex list-decimal flex-col gap-1 pl-5">{#each g.steps as item, i (i)}<li>{item}</li>{/each}</ol>
                {/if}
                {#if g.code}<pre class="overflow-x-auto rounded-box bg-base-200 p-3 font-mono text-xs leading-5">{g.code}</pre>{/if}
                {#if g.template}
                  {@const example = scripts.templates.find((t) => t.name === g.template)}
                  {#if example}
                    <button
                      class="btn btn-sm self-start"
                      onclick={() => {
                        useTemplate(example);
                        tab = 'code';
                      }}><Icon name="code" size={16} />Buka contoh ini di editor</button
                    >
                  {/if}
                {/if}
              </section>
            {/each}
            <section id="panduan-kamus" class="mb-6 flex scroll-mt-2 flex-col gap-2 text-sm" aria-labelledby="panduan-kamus-h">
              <h3 id="panduan-kamus-h" class="text-base font-semibold">Kamus Pine ke skrip</h3>
              <p class="max-w-3xl leading-relaxed">Padanan yang juga dibaca penerjemah AI. Yang tertulis (dibuang) atau (tidak ada) tidak bisa dibawa ke sini.</p>
              {#each scripts.dictionary as group (group.topic)}
                <h4 class="mt-2 font-semibold">{group.topic}</h4>
                <div class="overflow-x-auto rounded-box border border-base-300">
                  <table class="table table-sm">
                    <thead><tr><th>Pine</th><th>Di sini</th><th>Catatan</th></tr></thead>
                    <tbody>
                      {#each group.rows as row, i (i)}
                        <tr>
                          <td class="min-w-48 font-mono text-xs break-words">{row.pine}</td>
                          <td class="min-w-48 font-mono text-xs break-words">{row.script}</td>
                          <td class="min-w-48">{row.note ?? ''}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/each}
            </section>
            <section id="panduan-referensi" class="flex scroll-mt-2 flex-col gap-2 text-sm" aria-labelledby="panduan-referensi-h">
              <h3 id="panduan-referensi-h" class="text-base font-semibold">Referensi bahasa</h3>
              <pre class="overflow-x-auto rounded-box bg-base-200 p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{scripts.reference}</pre>
            </section>
          </div>
        {/if}

        {#if run}
          <div class="max-h-44 shrink-0 overflow-auto rounded-box border border-base-300 p-2 text-xs" role="status">
            {#if run.ok}
              <p class="font-medium">
                {run.result.stats.count} sinyal · {run.result.stats.tp} TP · {run.result.stats.sl} SL{run.result.stats.partial ? ` · ${run.result.stats.partial} TP1 saja` : ''}{run.result.stats.exits ? ` · ${run.result.stats.exits} keluar` : ''}{run.result.stats.unfilled ? ` · ${run.result.stats.unfilled} tidak terisi` : ''} ·
                menang {run.result.stats.wins + run.result.stats.losses ? Math.round((run.result.stats.wins / (run.result.stats.wins + run.result.stats.losses)) * 100) : 0}% · rata-rata
                {run.result.stats.avgR == null ? '—' : `${run.result.stats.avgR.toFixed(2).replace('.', ',')}R`} · {run.ms} ms ·
                {scripts.bars.length} candle
              </p>
              {#if run.result.inputs.length}
                <p class="text-base-content/70">Input: {run.result.inputs.map((x) => `${x.name} = ${x.value}`).join(' · ')}</p>
              {/if}
              {#if run.result.plots.length}<p class="text-base-content/70">Plot: {run.result.plots.map((p) => p.title).join(', ')}</p>{/if}
              {#if run.result.lines.length || run.result.labels.length}
                <p class="text-base-content/70">Gambar: {run.result.lines.length} garis · {run.result.labels.length} label</p>
              {/if}
              <ul class="mt-1 font-mono">
                {#each run.result.signals.slice(-5).reverse() as s (s.index)}
                  <li>{s.time} · {s.label} · E {s.entry.toLocaleString('id-ID', { maximumFractionDigits: 2 })} · SL {s.stopLoss.toLocaleString('id-ID', { maximumFractionDigits: 2 })} · {s.targets.length === 2 ? `TP1 ${s.targets[0].toLocaleString('id-ID', { maximumFractionDigits: 2 })} · TP2` : 'TP'} {s.takeProfit.toLocaleString('id-ID', { maximumFractionDigits: 2 })}{s.order === 'stop' || s.order === 'limit' ? ` · order ${s.order}` : ''} · {OUTCOME[s.outcome]}{s.r == null ? '' : ` ${s.r.toFixed(2).replace('.', ',')}R`}</li>
                {/each}
              </ul>
            {:else}
              <p class="font-mono text-error">{run.error}</p>
            {/if}
          </div>
        {/if}
        {#if error}<p class="text-sm text-error" role="alert">{error}</p>{/if}
        {#if note}<p class="text-sm text-base-content/80" role="status">{note}</p>{/if}
      </div>

      <footer class="flex flex-wrap items-center gap-2 border-t border-base-300 p-3">
        <button class="btn btn-sm" disabled={busy !== ''} onclick={test}>{busy === 'test' ? 'Menguji…' : 'Uji di chart'}</button>
        <button class="btn btn-ghost btn-sm" disabled={busy !== ''} onclick={compare}>{busy === 'compare' ? 'Membandingkan…' : 'Bandingkan dengan server'}</button>
        {#if id}
          <button class="btn btn-ghost btn-sm text-error" disabled={busy !== ''} onclick={remove}>{confirmDelete ? 'Yakin hapus?' : 'Hapus'}</button>
        {/if}
        <button class="btn btn-primary btn-sm ml-auto" disabled={busy !== '' || !name.trim() || !code.trim()} onclick={save}>
          {busy === 'save' ? 'Menyimpan…' : 'Simpan & tampilkan'}
        </button>
      </footer>
    </div>
  </div>
</div>
