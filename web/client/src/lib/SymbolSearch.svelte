<script lang="ts">
  // The one symbol box, in the nav: type a Yahoo or TradingView symbol, or the
  // name of an asset the market lists know ("emas", "Bank Central Asia"), and the
  // chart opens. Names are suggested as you type. Ctrl/⌘+K focuses it from anywhere.
  import { onMount } from 'svelte';
  import { ws } from './stores/workspace.svelte';
  import { MARKET_TABS, resolveSymbol } from './tv';

  /** Every listed asset once, [TradingView symbol, name]: the suggestions, and what a typed name or code is matched against. */
  const LISTED = (() => {
    const seen = new Map<string, string>();
    for (const tab of MARKET_TABS) for (const group of tab.groups) for (const [symbol, name] of group.symbols) if (!seen.has(symbol)) seen.set(symbol, name);
    return [...seen.entries()];
  })();

  /**
   * What the typed text opens: an explicit symbol as typed (BBCA.JK, IDX:BBCA, BTC-USD), else the
   * listed asset it names or whose code it is ("emas", "BBCA"), else whatever the engine makes of it.
   * A name shared by several assets ("bank") opens nothing: the suggestions show the choice.
   */
  function find(text: string): string | null {
    const t = text.trim();
    if (/[:.=^-]/.test(t)) return resolveSymbol(t)?.tv ?? null;
    const lower = t.toLowerCase();
    const named = LISTED.filter(([, name]) => name.toLowerCase().includes(lower));
    const exact = named.find(([, name]) => name.toLowerCase() === lower) ?? (named.length === 1 ? named[0] : null);
    const code = LISTED.find(([symbol]) => symbol.split(':')[1] === t.toUpperCase());
    if (exact || code) return (exact ?? code)![0];
    return named.length > 1 ? null : (resolveSymbol(t)?.tv ?? null);
  }

  let value = $state('');
  let error = $state(false);
  let input: HTMLInputElement;
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function submit(event?: SubmitEvent) {
    event?.preventDefault();
    const tv = find(value);
    error = !tv;
    if (!tv) return;
    value = '';
    input.blur();
    ws.setSymbol(tv);
  }

  /** A pick from the suggestions (no keystroke behind it) opens at once. */
  function onInput(e: Event) {
    error = false;
    const kind = (e as InputEvent).inputType;
    if ((!kind || kind === 'insertReplacementText') && LISTED.some(([symbol]) => symbol === value.trim().toUpperCase())) submit();
  }
</script>

<form class="w-full" role="search" onsubmit={submit}>
  <label class="input input-sm w-full" class:input-error={error}>
    <svg class="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" stroke-linecap="round" />
    </svg>
    <input
      bind:this={input}
      bind:value
      oninput={onInput}
      onkeydown={(e) => e.key === 'Escape' && input.blur()}
      class="grow"
      list="listed-assets"
      placeholder="Cari aset: Emas, BBCA, Bitcoin…"
      aria-label="Cari aset atau simbol"
      data-symbol-search
      aria-invalid={error}
      autocomplete="off"
      spellcheck="false"
    />
    <kbd class="kbd kbd-xs hidden sm:inline-flex">{isMac ? '⌘' : 'Ctrl'} K</kbd>
  </label>
  {#if error}
    <p class="mt-1 text-xs text-error" role="alert">Aset tidak ditemukan. Ketik nama (Emas, Bitcoin) atau kode (BBCA, BTC-USD), lalu pilih dari daftar.</p>
  {/if}
  <datalist id="listed-assets">
    {#each LISTED as [symbol, name] (symbol)}<option value={symbol}>{name}</option>{/each}
  </datalist>
</form>
