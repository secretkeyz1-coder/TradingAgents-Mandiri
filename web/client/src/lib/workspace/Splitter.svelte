<script lang="ts">
  // A draggable line between two panes. It only reports the size it wants; the
  // shell owns the size and clamps it. Pointer capture keeps the drag going over
  // the TradingView iframes, which would otherwise swallow the pointer events.
  // Arrow keys move it, Shift moves further, double-click or Home resets it.
  let {
    axis,
    value,
    min,
    max,
    invert = false,
    label,
    onchange,
    onend,
    onreset,
  }: {
    /** 'x' sits between columns and moves sideways; 'y' sits between rows. */
    axis: 'x' | 'y';
    /** Current size of the pane this splitter resizes, in pixels. */
    value: number;
    min: number;
    max: number;
    /** True when that pane is on the right (or below): dragging towards it shrinks it. */
    invert?: boolean;
    label: string;
    onchange: (px: number) => void;
    onend: () => void;
    onreset: () => void;
  } = $props();

  let dragging = $state(false);
  let start = { pointer: 0, value: 0 };

  const clamp = (px: number) => Math.min(max, Math.max(min, px));
  const along = (e: PointerEvent) => (axis === 'x' ? e.clientX : e.clientY);

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start = { pointer: along(e), value };
    dragging = true;
    document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    const delta = along(e) - start.pointer;
    onchange(clamp(start.value + (invert ? -delta : delta)));
  }

  function up() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing-x', 'resizing-y');
    onend();
  }

  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16;
    const grow = axis === 'x' ? (invert ? 'ArrowLeft' : 'ArrowRight') : invert ? 'ArrowUp' : 'ArrowDown';
    const shrink = axis === 'x' ? (invert ? 'ArrowRight' : 'ArrowLeft') : invert ? 'ArrowDown' : 'ArrowUp';
    if (e.key === grow) onchange(clamp(value + step));
    else if (e.key === shrink) onchange(clamp(value - step));
    else if (e.key === 'Home') onreset();
    else return;
    e.preventDefault();
    onend();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter group relative z-10 flex touch-none select-none items-center justify-center bg-base-100 outline-none"
  class:cursor-col-resize={axis === 'x'}
  class:cursor-row-resize={axis === 'y'}
  class:flex-col={axis === 'x'}
  role="separator"
  aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
  aria-label={label}
  aria-valuenow={Math.round(value)}
  aria-valuemin={Math.round(min)}
  aria-valuemax={Math.round(max)}
  tabindex="0"
  title="{label} · geser, atau dobel-klik untuk ukuran awal"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={onreset}
  onkeydown={key}
>
  <span
    class="pointer-events-none bg-base-300 transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
    class:bg-accent={dragging}
    class:h-full={axis === 'x'}
    class:w-px={axis === 'x' && !dragging}
    class:w-0.5={axis === 'x' && dragging}
    class:w-full={axis === 'y'}
    class:h-px={axis === 'y' && !dragging}
    class:h-0.5={axis === 'y' && dragging}
  ></span>
</div>

<style>
  /* Wider hit area than the 6px track, without taking more layout space. */
  .splitter::before {
    content: '';
    position: absolute;
    inset: -3px;
  }
  .splitter:focus-visible {
    box-shadow: inset 0 0 0 2px var(--color-accent);
  }
  /* While dragging: no text selection anywhere, the resize cursor everywhere,
     and iframes (TradingView) cannot catch the pointer. */
  :global(body.resizing-x),
  :global(body.resizing-y) {
    user-select: none;
  }
  :global(body.resizing-x) {
    cursor: col-resize;
  }
  :global(body.resizing-y) {
    cursor: row-resize;
  }
  :global(body.resizing-x iframe),
  :global(body.resizing-y iframe) {
    pointer-events: none;
  }
</style>
