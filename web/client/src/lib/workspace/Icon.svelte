<script lang="ts">
  // One stroke icon from icons.ts, on the 24px grid in the text colour. Icons here always sit beside a
  // word that says the same, so screen readers skip them.
  import { ICONS, type IconName } from './icons';

  let { name, size = 18, stroke = 1.8, class: cls = '' }: { name: IconName; size?: number; stroke?: number; class?: string } = $props();
</script>

<svg class="shrink-0 {cls}" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>
