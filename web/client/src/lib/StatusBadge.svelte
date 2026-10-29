<script lang="ts">
  // A job's status as neutral text with a small dot: colour is kept for
  // price direction, so status does not compete with the ratings.
  import type { AnalysisStatus } from './api';
  import { STATUS_LABELS } from './format';

  let { status, detail = '' }: { status: AnalysisStatus; detail?: string } = $props();

  const DOT: Record<AnalysisStatus, string> = {
    queued: 'status-neutral',
    running: 'status-info motion-safe:animate-pulse',
    completed: 'status-success',
    failed: 'status-error',
    cancelled: 'status-neutral',
  };
</script>

<span class="badge badge-sm badge-ghost gap-1.5 whitespace-nowrap">
  <span class="status status-xs {DOT[status]}" aria-hidden="true"></span>
  {STATUS_LABELS[status]}{#if detail}<span class="tabular-nums text-base-content/70">{detail}</span>{/if}
</span>
