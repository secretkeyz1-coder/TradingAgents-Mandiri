<script lang="ts">
  // The name as the brand sets it (ADR 0022): Bricolage Grotesque at its heaviest, tight, the second part in
  // the accent, which is Jingga tua on bone and the orange itself on ink. Size and visibility come from the caller.
  import { BRAND } from '../../../shared/brand';

  let { class: className = '' }: { class?: string } = $props();
</script>

<span class="font-display font-extrabold tracking-[-0.02em] {className}">{BRAND.wordmark[0]}<span class="text-accent">{BRAND.wordmark[1]}</span></span>
