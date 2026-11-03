<script lang="ts">
  // The TraderMedan mark (ADR 0022): an orange diamond with an ink M, the same two colours on bone and on
  // ink, so it reads as one sign everywhere. Its paths live in shared/brand.ts with the public pages' copy.
  import { MARK } from '../../../shared/brand';

  let { class: className = 'size-7' }: { class?: string } = $props();
</script>

<svg class="{className} shrink-0" viewBox={MARK.viewBox} aria-hidden="true">
  <path d={MARK.diamond} fill="var(--color-primary)" />
  <path d={MARK.m} fill="none" stroke="var(--color-primary-content)" stroke-width={MARK.stroke} stroke-linecap="round" stroke-linejoin="round" />
</svg>
