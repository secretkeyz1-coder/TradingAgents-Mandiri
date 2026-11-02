<script lang="ts">
  // The journal's mood chips (journalLabels): how the trader felt taking a trade, one or none.
  // Pressing the chosen chip again clears it, since a mood is optional.
  import type { JournalMood } from './api';
  import { MOODS } from './journalLabels';

  let { value = $bindable(null), size = 'xs' }: { value?: JournalMood | null; size?: 'xs' | 'sm' } = $props();
</script>

<div class="flex flex-wrap gap-1" role="group" aria-label="Perasaan saat masuk">
  {#each MOODS as m (m.key)}
    <button
      type="button"
      class="btn {size === 'sm' ? 'btn-sm' : 'btn-xs'}"
      class:btn-active={value === m.key}
      aria-pressed={value === m.key}
      onclick={() => (value = value === m.key ? null : m.key)}>{m.label}</button
    >
  {/each}
</div>
