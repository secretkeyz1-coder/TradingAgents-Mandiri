<script lang="ts">
  // The one symbol box, in the nav: type a Yahoo or TradingView symbol and the
  // chart opens. Ctrl/⌘+K focuses it from anywhere.
  import { onMount } from 'svelte';
  import { ws } from './stores/workspace.svelte';
  import { resolveSymbol } from './tv';

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

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const resolved = resolveSymbol(value);
    error = !resolved;
    if (!resolved) return;
    value = '';
    input.blur();
    ws.setSymbol(resolved.tv);
    if (ws.mobileTab !== 'ai') ws.mobileTab = 'chart';
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
      oninput={() => (error = false)}
      onkeydown={(e) => e.key === 'Escape' && input.blur()}
      class="grow uppercase placeholder:normal-case"
      placeholder="Simbol: BBCA.JK, BTC-USD, IDX:BMRI"
      aria-label="Buka chart simbol"
      aria-invalid={error}
      autocomplete="off"
      spellcheck="false"
    />
    <kbd class="kbd kbd-xs hidden sm:inline-flex">{isMac ? '⌘' : 'Ctrl'} K</kbd>
  </label>
  {#if error}
    <p class="mt-1 text-xs text-error" role="alert">Simbol tidak dikenali. Contoh: BBCA.JK, EURUSD=X, IDX:BMRI</p>
  {/if}
</form>
