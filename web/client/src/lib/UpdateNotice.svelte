<script lang="ts">
  // A page open across a deploy keeps running the old code (an AI drawing it
  // does not know is not drawn). Every few minutes, and when the tab comes back
  // into view, compare the entry script the server now serves with the one this
  // page loaded, and offer a reload when they differ.
  const CHECK_MS = 5 * 60_000;
  const ENTRY = /assets\/app-[\w-]+\.js/;

  const loaded = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => s.src.match(ENTRY)?.[0]).find(Boolean);
  let stale = $state(false);

  async function check() {
    if (!loaded || stale || document.hidden) return;
    try {
      const html = await fetch(location.pathname, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''));
      const served = html.match(ENTRY)?.[0];
      if (served && served !== loaded) stale = true;
    } catch {
      /* offline: try again later */
    }
  }

  $effect(() => {
    const timer = setInterval(check, CHECK_MS);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

{#if stale}
  <div class="toast toast-center toast-bottom z-50" role="status">
    <div class="alert alert-info alert-soft shadow-lg">
      <span>Versi baru aplikasi tersedia. Muat ulang agar fitur terbaru (mis. gambar AI) tampil.</span>
      <button class="btn btn-sm btn-info" onclick={() => location.reload()}>Muat ulang</button>
      <button class="btn btn-sm btn-ghost" aria-label="Nanti saja" onclick={() => (stale = false)}>Nanti</button>
    </div>
  </div>
{/if}
