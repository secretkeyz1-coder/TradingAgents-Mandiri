<script lang="ts">
  // Write, test, translate and save an indicator script. A test runs it in the
  // same sandbox the chart, the alerts and the agent use, on the bars the AI
  // chart has loaded; "Bandingkan dengan server" runs it on the server too and
  // checks both give the same signals.
  import { api } from '../api';
  import { runInSandbox } from '../indicators/script-host';
  import { settings as modelSettings } from '../stores/agent.svelte';
  import { indicators } from '../stores/indicators.svelte';
  import { scripts } from '../stores/scripts.svelte';
  import { ws } from '../stores/workspace.svelte';
  import type { ScriptRun } from '../../../../shared/script';

  let id = $state<string | null>(null);
  let name = $state('');
  let code = $state('');
  let pine = $state<string | null>(null);
  let tab = $state<'code' | 'pine' | 'help'>('code');
  let pineText = $state('');
  let run = $state<ScriptRun | null>(null);
  let busy = $state<'' | 'test' | 'save' | 'compare' | 'translate' | 'delete'>('');
  let note = $state('');
  let error = $state('');
  let confirmDelete = $state(false);

  function pick(sid: string | null) {
    const s = sid ? scripts.items.find((x) => x.id === sid) : null;
    id = s?.id ?? null;
    name = s?.name ?? 'Skrip baru';
    code = s?.code ?? scripts.templates[0]?.code ?? '';
    pine = s?.pine ?? null;
    run = null;
    note = error = '';
    confirmDelete = false;
    tab = 'code';
  }
  scripts.load().then(() => pick(scripts.editing));

  function useTemplate(t: { name: string; code: string }) {
    code = t.code;
    if (!id) name = t.name;
    run = null;
  }

  async function test() {
    error = note = '';
    if (!scripts.bars.length) {
      error = 'Buka chart Keputusan AI (15m, 1j, 4j atau 1H) dulu: skrip diuji pada candle yang sedang dimuat.';
      return;
    }
    busy = 'test';
    run = await runInSandbox(code, scripts.bars);
    busy = '';
  }

  async function compare() {
    error = note = '';
    if (!ws.yahoo || !['15m', '1h', '4h', '1d'].includes(ws.timeframe)) {
      error = 'Pilih simbol dan timeframe 15m, 1j, 4j atau 1H di chart Keputusan AI.';
      return;
    }
    busy = 'compare';
    try {
      const [server, local] = await Promise.all([
        api.runScriptOnServer({ code, symbol: ws.yahoo, timeframe: ws.timeframe }),
        scripts.bars.length ? runInSandbox(code, scripts.bars) : Promise.resolve(null),
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

  async function translate() {
    error = note = '';
    const model = modelSettings();
    if (!model) {
      error = 'Model AI belum diatur: buka panel AI → Analisa → Pengaturan.';
      return;
    }
    busy = 'translate';
    try {
      const out = await api.translateScript({ pine: pineText, ...model, backendUrl: model.backendUrl });
      code = out.code;
      pine = pineText;
      if (!id) name = (pineText.match(/indicator\(\s*["']([^"']+)/)?.[1] ?? 'Terjemahan Pine').slice(0, 40);
      tab = 'code';
      busy = '';
      await test();
      note = 'Terjemahan AI siap. Periksa kodenya dan hasil uji sebelum disimpan: terjemahan bisa keliru.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = '';
    }
  }

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
  const OUTCOME: Record<string, string> = { win: 'TP', loss: 'SL', exit: 'keluar (kondisi)', expired: 'kedaluwarsa', open: 'berjalan' };
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-3" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
  <div
    class="ta-window flex h-[min(820px,94vh)] w-[min(1120px,96vw)] overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-label="Editor skrip indikator"
  >
    <aside class="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-base-300 p-3 md:flex">
      <span class="text-xs font-semibold text-base-content/70">Skrip Anda ({scripts.items.length}/{scripts.max})</span>
      {#each scripts.items as s (s.id)}
        <button class="btn btn-ghost btn-sm justify-start truncate" class:btn-active={id === s.id} onclick={() => pick(s.id)}>{s.name}</button>
      {/each}
      <button class="btn btn-sm mt-1" onclick={() => pick(null)}>+ Skrip baru</button>
      <span class="mt-4 text-xs font-semibold text-base-content/70">Template</span>
      {#each scripts.templates as t (t.name)}
        <button class="btn btn-ghost btn-xs justify-start" onclick={() => useTemplate(t)}>{t.name}</button>
      {/each}
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-2 border-b border-base-300 p-3">
        <label class="sr-only" for="script-name">Nama skrip</label>
        <input id="script-name" class="input input-sm max-w-72 flex-1 font-medium" bind:value={name} maxlength="40" />
        <div class="join" role="group" aria-label="Bagian editor">
          <button class="btn btn-xs join-item" class:btn-active={tab === 'code'} onclick={() => (tab = 'code')}>Kode</button>
          <button class="btn btn-xs join-item" class:btn-active={tab === 'pine'} onclick={() => (tab = 'pine')}>Terjemahkan dari Pine</button>
          <button class="btn btn-xs join-item" class:btn-active={tab === 'help'} onclick={() => (tab = 'help')}>Referensi</button>
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
        {:else if tab === 'pine'}
          <p class="text-sm text-base-content/80">
            Tempel skrip Pine Script (TradingView). AI menerjemahkannya ke bahasa skrip aplikasi ini, lalu langsung diuji di chart. Tabel, label dan
            box tidak ikut; logika sinyal dan level SL/TP-nya yang dibawa. Memakai model AI di pengaturan analisa Anda.
          </p>
          <label class="sr-only" for="pine-code">Skrip Pine</label>
          <textarea id="pine-code" class="textarea min-h-0 w-full flex-1 resize-none font-mono text-xs leading-5" spellcheck="false" bind:value={pineText} placeholder="//@version=6&#10;indicator(&quot;...&quot;)"></textarea>
          <button class="btn btn-primary btn-sm self-start" disabled={busy !== '' || pineText.trim().length < 20} onclick={translate}>
            {#if busy === 'translate'}<span class="loading loading-spinner loading-xs"></span> Menerjemahkan…{:else}Terjemahkan dengan AI{/if}
          </button>
        {:else}
          <pre class="min-h-0 flex-1 overflow-auto rounded-box bg-base-200 p-3 text-xs leading-5 whitespace-pre-wrap">{scripts.reference}</pre>
        {/if}

        {#if run}
          <div class="max-h-44 shrink-0 overflow-auto rounded-box border border-base-300 p-2 text-xs" role="status">
            {#if run.ok}
              <p class="font-medium">
                {run.result.stats.count} sinyal · {run.result.stats.tp} TP · {run.result.stats.sl} SL{run.result.stats.exits ? ` · ${run.result.stats.exits} keluar` : ''} ·
                menang {run.result.stats.wins + run.result.stats.losses ? Math.round((run.result.stats.wins / (run.result.stats.wins + run.result.stats.losses)) * 100) : 0}% · rata-rata
                {run.result.stats.avgR == null ? '—' : `${run.result.stats.avgR.toFixed(2).replace('.', ',')}R`} · {run.ms} ms ·
                {scripts.bars.length} candle
              </p>
              {#if run.result.inputs.length}
                <p class="text-base-content/70">Input: {run.result.inputs.map((x) => `${x.name} = ${x.value}`).join(' · ')}</p>
              {/if}
              {#if run.result.plots.length}<p class="text-base-content/70">Plot: {run.result.plots.map((p) => p.title).join(', ')}</p>{/if}
              <ul class="mt-1 font-mono">
                {#each run.result.signals.slice(-5).reverse() as s (s.index)}
                  <li>{s.time} · {s.label} · E {s.entry.toFixed(2)} · SL {s.stopLoss.toFixed(2)} · TP {s.takeProfit.toFixed(2)} · {OUTCOME[s.outcome]}</li>
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
