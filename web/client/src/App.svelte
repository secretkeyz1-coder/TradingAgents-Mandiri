<script lang="ts">
  // One workspace screen. Routing lives in the workspace store (URL hash), and
  // old page links are translated there, so App only draws the frame.
  import SymbolSearch from './lib/SymbolSearch.svelte';
  import WorkspaceShell from './lib/workspace/WorkspaceShell.svelte';
</script>

<div class="flex h-dvh flex-col bg-base-100">
  <header class="flex shrink-0 items-center gap-3 border-b border-base-300 px-3 py-2 sm:px-4">
    <a href="#/" class="flex shrink-0 items-center gap-2 font-semibold tracking-tight" aria-label="TradingAgents">
      <svg class="size-7 shrink-0" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--color-base-content)" />
        <rect x="6.5" y="12" width="5" height="9" rx="1" fill="var(--color-base-100)" />
        <path d="M9 7v18M16 5v20" stroke="var(--color-base-100)" stroke-width="1.5" stroke-linecap="round" />
        <rect x="13.5" y="9" width="5" height="10" rx="1" fill="var(--color-base-100)" />
        <path d="M23 4v15" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round" />
        <rect x="20.5" y="6" width="5" height="8" rx="1" fill="var(--color-accent)" />
      </svg>
      <span class="hidden sm:inline">TradingAgents</span>
    </a>
    <div class="ml-auto w-full max-w-80 min-w-0">
      <SymbolSearch />
    </div>
  </header>

  <WorkspaceShell />
</div>
