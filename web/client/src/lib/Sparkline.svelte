<script lang="ts">
  // A run of closes as one line, for lists and tiles (the Pasar board, Beranda's market strip).
  // It takes its colour from the text colour, so a caller tints it by the change it shows.
  let { values, class: className = '' }: { values: number[]; class?: string } = $props();

  const points = $derived.by(() => {
    if (values.length < 2) return '';
    const low = Math.min(...values);
    const span = Math.max(...values) - low || 1;
    return values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(22 - ((v - low) / span) * 20).toFixed(1)}`).join(' ');
  });
</script>

<svg viewBox="0 0 100 24" class={className} preserveAspectRatio="none" aria-hidden="true">
  <polyline {points} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
</svg>
