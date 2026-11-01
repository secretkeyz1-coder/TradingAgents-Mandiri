<script lang="ts">
  // The × in a docked panel's header. It hides the panel; the rail or the Tata letak menu
  // brings it back, so the rail itself never has to.
  let { label, onclick }: { label: string; onclick: () => void } = $props();
</script>

<button class="btn btn-ghost btn-xs btn-square" aria-label={label} title={label} {onclick}>
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
</button>
