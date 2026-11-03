<script lang="ts">
  // One bead per call, newest first (ta-bead in app.css): a target a dot, a stop a diamond, a running call a ring,
  // the rest a small dot, so the shape says the result as well as the colour. Decoration only: the counts beside
  // the beads say the same in words, so screen readers skip them.
  import type { CallOutcome } from '../../api';

  let { outcomes, max = 40 }: { outcomes: CallOutcome[]; max?: number } = $props();
</script>

<span class="ta-beads" aria-hidden="true">
  {#each outcomes.slice(0, max) as o, i (i)}<i class="ta-bead" data-o={o}></i>{/each}
</span>
