<script lang="ts">
  // The whole loaded history in one strip under the chart. The bright window
  // is what the chart shows: drag it to move through time, drag its edges to
  // zoom. It follows the pointer 1:1 (no easing) and keeps it captured.
  let {
    closes,
    from,
    to,
    onchange,
  }: {
    closes: number[];
    /** Visible logical range of the chart, in bar indexes. */
    from: number;
    to: number;
    onchange: (from: number, to: number) => void;
  } = $props();

  const n = $derived(closes.length);
  const path = $derived.by(() => {
    if (n < 2) return '';
    const max = Math.max(...closes);
    const min = Math.min(...closes);
    const span = max - min || 1;
    const pts = closes.map((c, i) => `${((i / (n - 1)) * 1000).toFixed(1)},${(100 - ((c - min) / span) * 84 - 8).toFixed(1)}`);
    return `M0,100 L${pts.join(' L')} L1000,100 Z`;
  });
  const left = $derived(n ? Math.max(0, Math.min(100, (from / (n - 1)) * 100)) : 0);
  const right = $derived(n ? Math.max(0, Math.min(100, (to / (n - 1)) * 100)) : 100);

  let strip: HTMLDivElement;

  function drag(event: PointerEvent, part: 'move' | 'start' | 'end') {
    if (event.button !== 0 || n < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const width = strip.getBoundingClientRect().width;
    const startX = event.clientX;
    const [f0, t0] = [from, to];
    const bars = (px: number) => (px / width) * (n - 1);
    const onMove = (e: PointerEvent) => {
      const d = bars(e.clientX - startX);
      if (part === 'move') onchange(f0 + d, t0 + d);
      else if (part === 'start') onchange(Math.min(f0 + d, t0 - 5), t0);
      else onchange(f0, Math.max(t0 + d, f0 + 5));
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  // A click on the strip outside the window centres the window there.
  function jump(event: PointerEvent) {
    if (event.button !== 0 || n < 2) return;
    const box = strip.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * (n - 1);
    const half = (to - from) / 2;
    onchange(at - half, at + half);
  }

  function keys(event: KeyboardEvent) {
    const step = Math.max(1, Math.round((to - from) / (event.shiftKey ? 2 : 8)));
    if (event.key === 'ArrowLeft') onchange(from - step, to - step);
    else if (event.key === 'ArrowRight') onchange(from + step, to + step);
    else return;
    event.preventDefault();
  }
</script>

<div
  bind:this={strip}
  class="relative h-11 overflow-hidden rounded-field border border-base-300 bg-base-200"
  role="presentation"
  onpointerdown={jump}
>
  <svg viewBox="0 0 1000 100" preserveAspectRatio="none" class="absolute inset-0 h-full w-full text-base-content/25" aria-hidden="true">
    <path d={path} fill="currentColor" />
  </svg>
  <div
    class="absolute inset-y-0 cursor-grab rounded-field border border-accent bg-accent/15 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
    style="left: {left}%; width: {Math.max(1, right - left)}%"
    role="slider"
    tabindex="0"
    aria-label="Rentang yang tampil di chart (panah kiri/kanan untuk geser)"
    aria-valuemin={0}
    aria-valuemax={Math.max(0, n - 1)}
    aria-valuenow={Math.round(from)}
    onpointerdown={(e) => drag(e, 'move')}
    onkeydown={keys}
  >
    <span class="absolute inset-y-2 -left-1 w-2 cursor-ew-resize rounded-sm bg-accent" role="presentation" onpointerdown={(e) => drag(e, 'start')}></span>
    <span class="absolute inset-y-2 -right-1 w-2 cursor-ew-resize rounded-sm bg-accent" role="presentation" onpointerdown={(e) => drag(e, 'end')}></span>
  </div>
</div>
