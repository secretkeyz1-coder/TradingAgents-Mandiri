<script lang="ts">
  // One TradingView embed widget (https://www.tradingview.com/widget-docs/).
  // The embed script reads its JSON config from its own text and replaces
  // itself with an iframe, so a config change means rebuilding the markup.
  import { theme } from './theme.svelte';

  let {
    widget,
    config,
    class: className = '',
  }: {
    /** Script name after "embed-widget-", e.g. "advanced-chart". */
    widget: string;
    config: Record<string, unknown>;
    class?: string;
  } = $props();

  let container: HTMLDivElement;

  const fullConfig = $derived(
    JSON.stringify({
      locale: 'id',
      // Most widgets read colorTheme; the advanced chart reads theme.
      colorTheme: theme.dark ? 'dark' : 'light',
      theme: theme.dark ? 'dark' : 'light',
      isTransparent: true,
      ...config,
    }),
  );

  $effect(() => {
    const json = fullConfig;
    container.innerHTML = '';
    const target = document.createElement('div');
    target.className = 'tradingview-widget-container__widget h-full w-full';
    const script = document.createElement('script');
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${widget}.js`;
    script.async = true;
    script.type = 'text/javascript';
    script.textContent = json;
    container.append(target, script);
    return () => {
      container.innerHTML = '';
    };
  });
</script>

<!-- The embed script sets the container's own height, so the size lives on a wrapper. -->
<div class={className}>
  <div bind:this={container} class="tradingview-widget-container h-full w-full"></div>
</div>
