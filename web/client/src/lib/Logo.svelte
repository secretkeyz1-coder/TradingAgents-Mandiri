<script lang="ts">
  // The app's mark: three candles, the last one in the accent colour.
  let { class: className = 'size-7' }: { class?: string } = $props();
</script>

<svg class="{className} shrink-0" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="7" fill="var(--color-base-content)" />
  <rect x="6.5" y="12" width="5" height="9" rx="1" fill="var(--color-base-100)" />
  <path d="M9 7v18M16 5v20" stroke="var(--color-base-100)" stroke-width="1.5" stroke-linecap="round" />
  <rect x="13.5" y="9" width="5" height="10" rx="1" fill="var(--color-base-100)" />
  <path d="M23 4v15" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round" />
  <rect x="20.5" y="6" width="5" height="8" rx="1" fill="var(--color-accent)" />
</svg>
