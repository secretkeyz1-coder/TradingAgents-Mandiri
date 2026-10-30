<script lang="ts">
  // Scalper Pro+ inputs, grouped as the Pine script groups them. Every change
  // redraws the chart at once and is remembered; "Jadikan skill AI" adds the
  // matching agent skill as a draft for the user to approve.
  import { api } from '../api';
  import { indicators } from '../stores/indicators.svelte';

  let { onclose }: { onclose: () => void } = $props();

  type Group = 'ut' | 'filter' | 'risk' | 'view';
  let group = $state<Group>('ut');
  const GROUPS: { key: Group; label: string }[] = [
    { key: 'ut', label: 'UT Bot' },
    { key: 'filter', label: 'Filter' },
    { key: 'risk', label: 'Risiko' },
    { key: 'view', label: 'Tampilan' },
  ];

  let skillNote = $state('');
  let installing = $state(false);
  async function makeSkill() {
    installing = true;
    try {
      const { version } = await api.installSkill('scalper-pro-plus');
      skillNote = `Draf skill scalper-pro-plus v${version} dibuat. Setujui di panel Skill (AI → Tanya) agar agent bisa memakainya.`;
    } catch (e) {
      skillNote = (e as Error).message;
    } finally {
      installing = false;
    }
  }
</script>

<section
  class="ta-pop flex w-80 max-w-[calc(100%-1rem)] flex-col rounded-box border border-base-300 bg-base-100 shadow-xl"
  style="transform-origin: top left"
  aria-label="Pengaturan Scalper Pro+"
>
  <header class="flex h-9 items-center gap-2 border-b border-base-300 pr-1 pl-3">
    <h3 class="flex-1 text-xs font-semibold">Pengaturan Scalper Pro+</h3>
    <button class="btn btn-ghost btn-xs btn-square" aria-label="Tutup pengaturan" onclick={onclose}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  </header>
  <div class="px-3 pt-2">
    <div class="join w-full" role="group" aria-label="Kelompok pengaturan">
      {#each GROUPS as g (g.key)}
        <button class="btn btn-xs join-item flex-1" class:btn-active={group === g.key} aria-pressed={group === g.key} onclick={() => (group = g.key)}>{g.label}</button>
      {/each}
    </div>
  </div>

  <form class="grid grid-cols-2 gap-x-3 gap-y-2 p-3" onchange={() => indicators.save()} onsubmit={(e) => e.preventDefault()}>
    {#if group === 'ut'}
      <label class="flex flex-col gap-1 text-xs text-base-content/80">Sensitivity
        <input class="input input-sm font-mono" type="number" min="0.1" step="0.1" bind:value={indicators.scalper.sensitivity} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">ATR period
        <input class="input input-sm font-mono" type="number" min="1" step="1" bind:value={indicators.scalper.atrPeriod} />
      </label>
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.useHeikinAshi} /> Gunakan Heikin Ashi</label>
    {:else if group === 'filter'}
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.useTrendFilter} /> Filter EMA (trend)</label>
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.useRsiFilter} /> Filter RSI</label>
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.useSweep} /> Wajib liquidity sweep</label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">EMA cepat
        <input class="input input-sm font-mono" type="number" min="1" step="1" bind:value={indicators.scalper.emaFast} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">EMA lambat
        <input class="input input-sm font-mono" type="number" min="2" step="1" bind:value={indicators.scalper.emaSlow} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">RSI period
        <input class="input input-sm font-mono" type="number" min="2" step="1" bind:value={indicators.scalper.rsiPeriod} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">Pivot length
        <input class="input input-sm font-mono" type="number" min="2" step="1" bind:value={indicators.scalper.pivotLen} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">RSI min BUY
        <input class="input input-sm font-mono" type="number" min="1" max="99" step="1" bind:value={indicators.scalper.rsiBuyMin} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">RSI maks SELL
        <input class="input input-sm font-mono" type="number" min="1" max="99" step="1" bind:value={indicators.scalper.rsiSellMax} />
      </label>
    {:else if group === 'risk'}
      <label class="flex flex-col gap-1 text-xs text-base-content/80">ATR risk
        <input class="input input-sm font-mono" type="number" min="1" step="1" bind:value={indicators.scalper.atrRisk} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">SL × ATR
        <input class="input input-sm font-mono" type="number" min="0.1" step="0.1" bind:value={indicators.scalper.slAtr} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">Risk reward
        <input class="input input-sm font-mono" type="number" min="0.5" step="0.5" bind:value={indicators.scalper.riskReward} />
      </label>
      <label class="flex flex-col gap-1 text-xs text-base-content/80">Panjang zona (bar)
        <input class="input input-sm font-mono" type="number" min="5" max="100" step="1" bind:value={indicators.scalper.extendBars} />
      </label>
      <label class="col-span-2 flex flex-col gap-1 text-xs text-base-content/80">Lebar entry zone × ATR
        <input class="input input-sm font-mono" type="number" min="0.05" max="2" step="0.05" bind:value={indicators.scalper.entryZoneAtr} />
      </label>
    {:else}
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.showTrail} /> UT trail</label>
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.showEmas} /> EMA cepat &amp; lambat</label>
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.showZone} /> Zona entry + Entry/SL/TP</label>
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.showTrendlines} /> Auto trendline</label>
      <label class="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-xs" bind:checked={indicators.scalper.showDashboard} /> Dashboard</label>
    {/if}
  </form>

  <div class="flex flex-col gap-2 border-t border-base-300 p-3">
    <div class="flex gap-2">
      <button class="btn btn-ghost btn-sm" onclick={() => indicators.resetScalper()}>Default</button>
      <button class="btn btn-sm flex-1" disabled={installing} onclick={makeSkill}>Jadikan skill AI</button>
    </div>
    {#if skillNote}<p class="text-xs text-base-content/80" role="status">{skillNote}</p>{/if}
    <p class="text-xs text-base-content/70">Sinyal hanya dari candle yang sudah tutup. Untuk riset, bukan saran investasi.</p>
  </div>
</section>
