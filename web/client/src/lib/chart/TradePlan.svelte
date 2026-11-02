<script module lang="ts">
  /** An open setup from an indicator on the chart, as the plan card shows it. */
  export type Plan = { key: string; source: string; side: 'BUY' | 'SELL'; entry: number; stopLoss: number; takeProfit: number; time: string };
</script>

<script lang="ts">
  // The chart's trading plan (DecisionChart, workspace chart only): the newest open setup from
  // the indicators on the chart as one line a trader can act on (direction, entry, stop,
  // target, reward to risk) and, opened, how big a position that stop allows for their capital
  // and risk per trade, one tap to put price alerts on the three levels (POST /api/price-alerts,
  // within the plan's notification allowance), and the plan as text to copy into a broker app
  // or a group. Capital and risk are remembered in this browser. Research, not advice.
  // IDX levels are put on the exchange's price grid (idx.ts) so a broker app takes them; an IDX
  // sell signal, which an ordinary retail account cannot short, reads as "avoid buying, or sell
  // what you hold", with alerts but no position size and no journal entry.
  // Under the plan, the engine's live record on this timeframe (RecordLine): how often its
  // signals have paid after costs, so the plan is weighed before it is taken. "Saya ambil" puts
  // the plan in the journal (POST /api/journal) with the trader's own entry, mood and note, and
  // the money at risk when the sizing is open; the server then settles it at TP or SL.
  import { TIMEFRAME_LABELS } from '../alertLabels';
  import { api, type JournalMood } from '../api';
  import { friendlyName } from '../beginner/plain';
  import { onIdxTick } from '../idx';
  import MoodPicker from '../MoodPicker.svelte';
  import { ws } from '../stores/workspace.svelte';
  import RecordLine from './RecordLine.svelte';

  let {
    plans,
    symbol,
    timeframe,
    currency,
    last,
    decision,
  }: {
    plans: Plan[];
    /** Engine spelling (BBCA.JK, BTC-USD, GC=F). */
    symbol: string;
    /** The chart's timeframe, which the setups come from. */
    timeframe: string;
    currency: string | null;
    last: number | null;
    /** The latest AI decision on this symbol, for context. */
    decision: { rating: string; date: string } | null;
  } = $props();

  const STORE = 'tradingagents.risk';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? 'null') as { capital?: number; riskPct?: number; open?: boolean } | null;
    } catch {
      return null;
    }
  })();
  let capital = $state(saved?.capital ?? 10_000_000);
  let riskPct = $state(saved?.riskPct ?? 1);
  let open = $state(saved?.open ?? false);
  let picked = $state<string | null>(null);
  let rate = $state<number | null>(null);
  let busy = $state(false);
  let note = $state('');
  let copied = $state(false);

  $effect(() => {
    const value = { capital, riskPct, open };
    try {
      localStorage.setItem(STORE, JSON.stringify(value));
    } catch {
      /* a convenience */
    }
  });
  // A price in another currency needs the rupiah rate to size from capital in rupiah.
  $effect(() => {
    if (!currency || currency === 'IDR' || rate) return;
    api
      .quotes(['IDR=X'])
      .then((r) => (rate = r.quotes['IDR=X']?.price ?? null))
      .catch(() => {});
  });

  const plan = $derived(plans.find((p) => p.key === picked) ?? plans[0]);
  const kind = $derived(symbol.endsWith('.JK') ? 'idx' : symbol === 'GC=F' || symbol.startsWith('XAU') ? 'gold' : symbol.endsWith('-USD') ? 'crypto' : 'units');
  /**
   * The levels a broker app accepts. IDX prices move in steps (fraksi harga), so there the stop goes
   * to the step beyond the indicator's level, the target to the step before it, and the entry to the
   * nearest; other markets keep the indicator's levels.
   */
  const levels = $derived.by(() => {
    if (!plan) return null;
    if (kind !== 'idx') return { entry: plan.entry, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit };
    const buy = plan.side === 'BUY';
    return { entry: onIdxTick(plan.entry, 'nearest'), stopLoss: onIdxTick(plan.stopLoss, buy ? 'down' : 'up'), takeProfit: onIdxTick(plan.takeProfit, buy ? 'down' : 'up') };
  });
  /** An IDX share cannot be sold short from an ordinary retail account: its sell signal is a warning to act on, not a position to size. */
  const idxSell = $derived(kind === 'idx' && plan?.side === 'SELL');
  const risk = $derived(levels ? Math.abs(levels.entry - levels.stopLoss) : 0);
  const rr = $derived(levels && risk ? Math.abs(levels.takeProfit - levels.entry) / risk : null);
  const toIdr = $derived(currency === 'IDR' ? 1 : rate);
  /** The position the stop allows: the most loss is capital × risk; IDX shares go in lots of 100. */
  const size = $derived.by(() => {
    if (!levels || idxSell || !risk || !toIdr || !(capital > 0) || !(riskPct > 0)) return null;
    let units = (capital * riskPct) / 100 / toIdr / risk;
    if (kind === 'idx') units = Math.floor(units / 100) * 100;
    else if (kind === 'units') units = Math.floor(units);
    return { units, loss: units * risk * toIdr, value: units * levels.entry * toIdr };
  });

  const price = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : 5 });
  const rupiah = (v: number) => `Rp ${Math.round(v).toLocaleString('id-ID')}`;
  const percent = (from: number, to: number) => {
    const x = (to - from) / from;
    return `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(1).replace('.', ',')}%`;
  };
  const when = (t: string) =>
    `${new Date(`${t.slice(0, 10)}T00:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })}${t.length > 10 ? ` ${t.slice(11, 16)}` : ''}`;
  const sizeText = $derived.by(() => {
    if (!size) return toIdr ? 'Isi modal dan risiko per trade.' : 'Memuat kurs rupiah…';
    if (size.units <= 0) return 'Stop loss terlalu jauh untuk modal dan risiko ini: tidak ada ukuran yang muat.';
    const amount =
      kind === 'idx'
        ? `${(size.units / 100).toLocaleString('id-ID')} lot (${size.units.toLocaleString('id-ID')} lembar)`
        : kind === 'gold'
          ? `${size.units.toLocaleString('id-ID', { maximumFractionDigits: 2 })} oz (${(size.units / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })} lot)`
          : kind === 'crypto'
            ? `${size.units.toLocaleString('id-ID', { maximumFractionDigits: 6 })} ${symbol.split('-')[0]}`
            : `${size.units.toLocaleString('id-ID')} unit`;
    return `${amount} · nilai posisi ${rupiah(size.value)} · rugi maksimal ${rupiah(size.loss)}`;
  });

  async function alertLevels() {
    if (!plan || !levels) return;
    busy = true;
    note = '';
    const done: string[] = [];
    const failed: string[] = [];
    for (const [name, level] of [
      ['entry', levels.entry],
      ['SL', levels.stopLoss],
      ['TP', levels.takeProfit],
    ] as const) {
      try {
        await api.priceLevelAdd({ symbol, tvSymbol: ws.symbol, price: level, label: `${name} · ${plan.source}`.slice(0, 40) });
        done.push(name);
      } catch (e) {
        failed.push(`${name}: ${(e as Error).message}`);
      }
    }
    note = [done.length ? `Alert dipasang di ${done.join(', ')}.` : '', ...failed].filter(Boolean).join(' ');
    busy = false;
  }

  // --- "Saya ambil": the plan into the journal.
  let taking = $state(false);
  let takenEntry = $state<number | null>(null);
  let mood = $state<JournalMood | null>(null);
  let memo = $state('');
  let saving = $state(false);
  let takeError = $state('');
  /** The plan just recorded, so the card says where it went. */
  let taken = $state<string | null>(null);

  function startTaking() {
    taking = !taking;
    takenEntry = levels?.entry ?? null;
    takeError = '';
  }

  async function take(e: SubmitEvent) {
    e.preventDefault();
    if (!plan || !levels || takenEntry == null) return;
    saving = true;
    takeError = '';
    try {
      await api.journalAdd({
        symbol,
        tvSymbol: ws.symbol,
        side: plan.side,
        entry: takenEntry,
        stopLoss: levels.stopLoss,
        takeProfit: levels.takeProfit,
        source: plan.key,
        label: `${plan.source.split(' · ')[0]} ${TIMEFRAME_LABELS[timeframe as keyof typeof TIMEFRAME_LABELS] ?? timeframe}`.slice(0, 80),
        mood: mood ?? undefined,
        note: memo.trim() || undefined,
        // What the stop would cost at the size shown, from the entry the trader got.
        riskIdr: open && size && size.units > 0 && toIdr ? Math.round(size.units * Math.abs(takenEntry - levels.stopLoss) * toIdr) : undefined,
      });
      taking = false;
      mood = null;
      memo = '';
      taken = plan.key;
    } catch (err) {
      takeError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function copy() {
    if (!plan || !levels) return;
    const side = idxSell ? 'Jual (hindari beli, atau jual kalau sudah punya)' : plan.side === 'BUY' ? 'Beli' : 'Jual';
    const text = `${friendlyName(ws.symbol)} · ${side} · Entry ${price(levels.entry)} · SL ${price(levels.stopLoss)} · TP ${price(levels.takeProfit)}${rr ? ` · R:R 1:${rr.toFixed(1).replace('.', ',')}` : ''} (${plan.source}). Riset, bukan saran investasi.`;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      note = 'Gagal menyalin; salin manual dari baris di atas.';
    }
  }
</script>

{#if plan && levels}
  <section class="flex flex-col gap-1.5 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-sm" aria-label="Rencana trading">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="font-semibold">Rencana</span>
      <span class="badge badge-sm badge-soft {plan.side === 'BUY' ? 'badge-success' : 'badge-error'}">{plan.side === 'BUY' ? 'Beli' : 'Jual'}</span>
      <span class="tabular-nums">Entry <strong>{price(levels.entry)}</strong></span>
      <span class="tabular-nums">SL <strong class="text-error">{price(levels.stopLoss)}</strong> <span class="text-xs text-base-content/70">{percent(levels.entry, levels.stopLoss)}</span></span>
      <span class="tabular-nums">TP <strong class="text-success">{price(levels.takeProfit)}</strong> <span class="text-xs text-base-content/70">{percent(levels.entry, levels.takeProfit)}</span></span>
      {#if rr}<span class="tabular-nums">R:R 1:{rr.toFixed(1).replace('.', ',')}</span>{/if}
      <span class="ml-auto flex items-center gap-1">
        <button class="btn btn-ghost btn-xs" onclick={copy}>{copied ? 'Tersalin' : 'Salin'}</button>
        {#if !idxSell}
          <button class="btn btn-xs" aria-expanded={taking} title="Catat rencana ini di jurnal sebagai trade yang kamu ambil" onclick={startTaking}>Saya ambil</button>
        {/if}
        <button class="btn btn-xs" aria-expanded={open} onclick={() => (open = !open)}>{open ? 'Tutup' : idxSell ? 'Pasang alert' : 'Ukuran posisi & alert'}</button>
      </span>
    </div>
    {#if idxSell}
      <p class="text-xs">
        Saham di BEI tidak bisa dijual kosong (short) dari akun ritel biasa, jadi sinyal ini berarti <strong>hindari beli dulu, atau jual kalau sudah punya</strong>.
        Pandangan turun ini batal bila harga naik ke SL.
      </p>
    {/if}
    <div class="flex flex-wrap items-center gap-x-2 text-xs text-base-content/70">
      {#if plans.length > 1}
        <select class="select select-xs w-auto" aria-label="Sumber rencana" value={plan.key} onchange={(e) => (picked = e.currentTarget.value)}>
          {#each plans as p (p.key)}<option value={p.key}>{p.source}</option>{/each}
        </select>
      {:else}
        <span>dari {plan.source}</span>
      {/if}
      <span>· {when(plan.time)}</span>
      {#if kind === 'idx'}<span title="Harga order di BEI harus kelipatan fraksi harga: SL ke langkah di luar level indikator, TP ke langkah sebelum level">· dibulatkan ke fraksi harga BEI</span>{/if}
      {#if last != null}<span>· harga sekarang {price(last)} ({percent(levels.entry, last)} dari entry)</span>{/if}
      {#if decision}<span>· keputusan AI terakhir {decision.rating} ({decision.date})</span>{/if}
    </div>
    <RecordLine source={plan.key} {timeframe} {symbol} lead="Rekam jejak" exact showScope />
    {#if taking}
      <form class="flex flex-col gap-2 border-t border-base-300 pt-2" onsubmit={take} aria-label="Catat ke jurnal">
        <p class="text-xs text-base-content/70">
          Catat ke jurnal: {plan.side === 'BUY' ? 'Beli' : 'Jual'}, SL {price(levels.stopLoss)}, TP {price(levels.takeProfit)}. Jurnal menutupnya otomatis saat harga menyentuh TP atau SL.
        </p>
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-0.5 text-xs">
            Harga masukmu
            <input class="input input-xs w-32 tabular-nums" type="number" step="any" min="0" required bind:value={takenEntry} />
          </label>
          <input class="input input-xs min-w-0 grow basis-56" maxlength="500" placeholder="Catatan singkat, misalnya alasan masuk" aria-label="Catatan" bind:value={memo} />
        </div>
        <div class="flex flex-col gap-1 text-xs">
          <span>Perasaan saat masuk (boleh dikosongkan)</span>
          <MoodPicker bind:value={mood} />
        </div>
        {#if takeError}<p class="text-xs text-error" role="alert">{takeError}</p>{/if}
        <div><button class="btn btn-xs btn-primary" disabled={saving}>Simpan ke jurnal</button></div>
      </form>
    {:else if taken === plan.key}
      <p class="text-xs" role="status">Tercatat di jurnal. <button class="link" onclick={() => ws.setDock('journal')}>Buka Jurnal</button></p>
    {/if}
    {#if open}
      <div class="flex flex-col gap-2 border-t border-base-300 pt-2">
        {#if !idxSell}
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-0.5 text-xs">
            Modal (Rp)
            <input class="input input-xs w-36 tabular-nums" type="number" min="0" step="100000" bind:value={capital} />
          </label>
          <label class="flex flex-col gap-0.5 text-xs">
            Risiko per trade (%)
            <input class="input input-xs w-20 tabular-nums" type="number" min="0.1" max="10" step="0.1" bind:value={riskPct} />
          </label>
          <p class="min-w-0 grow basis-56 text-sm" aria-live="polite"><span class="text-base-content/70">Ukuran posisi:</span> <strong class="tabular-nums">{sizeText}</strong></p>
        </div>
        {#if size && size.value > capital}
          <p class="text-xs text-warning">Nilai posisi melebihi modal: hanya bisa dengan margin atau leverage, dan risikonya ikut membesar.</p>
        {/if}
        {/if}
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-xs" disabled={busy} onclick={alertLevels}>
            {#if busy}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>{/if}
            Pasang alert di entry, SL, dan TP
          </button>
          {#if note}<span class="text-xs" role="status">{note}</span>{/if}
        </div>
        <p class="text-xs text-base-content/60">Riset dari indikator, bukan saran investasi. Rencana batal bila harga menembus SL. Alert memakai jatah notifikasi paketmu.</p>
      </div>
    {/if}
  </section>
{/if}
