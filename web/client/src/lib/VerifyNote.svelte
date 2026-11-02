<script lang="ts">
  // Beside an AI button an unverified account cannot use yet (auth.unverified): why it is
  // locked and what opens it, so the button never just fails. Without mail on the server the
  // admin verifies new accounts by hand (Konsol admin → Pengguna); the support contact shows
  // when the brand has one.
  import { supportContact } from '../../../shared/brand';
  import { auth } from './auth.svelte';

  const contact = supportContact();
</script>

<p class="text-xs text-base-content/70">
  {#if auth.config.mail}
    Terbuka setelah emailmu diverifikasi. Cek kotak masuk atau folder spam untuk tautannya.
  {:else}
    Terbuka setelah admin memverifikasi akunmu, biasanya di hari yang sama{#if contact}. Perlu cepat? Hubungi
      <a class="link" href={contact.href} target="_blank" rel="noopener">{contact.label}</a>{/if}.
  {/if}
</p>
