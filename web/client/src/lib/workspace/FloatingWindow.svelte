<script lang="ts">
  // A panel floating over the chart: dragged by its title bar, resized from its
  // bottom-right corner, kept inside the workspace. Dropping it on its home edge
  // docks it again. Dragging follows the pointer 1:1 with pointer capture; the
  // TradingView iframes are made click-through meanwhile, or they would swallow
  // the pointer as it passes over them.
  import type { Snippet } from 'svelte';
  import { MIN_SIZE, type Rect } from '../stores/layout.svelte';

  let {
    title,
    rect,
    bounds,
    z,
    edge,
    onmove,
    oncommit,
    ondock,
    onminimize,
    onfront,
    children,
  }: {
    title: string;
    rect: Rect;
    bounds: { w: number; h: number };
    z: number;
    /** The workspace edge this panel docks to. */
    edge: 'left' | 'right' | 'bottom';
    onmove: (rect: Rect) => void;
    oncommit: () => void;
    ondock: () => void;
    onminimize: () => void;
    onfront: () => void;
    children: Snippet;
  } = $props();

  const SNAP = 40;
  /** Where the pointer would dock the window if released now. */
  let snapping = $state(false);

  // The whole window stays inside the workspace (a shrunken browser window
  // shrinks it too), so no part of a panel is ever out of reach.
  const clampRect = (r: Rect): Rect => {
    const w = Math.min(Math.max(r.w, MIN_SIZE.w), Math.max(MIN_SIZE.w, bounds.w));
    const h = Math.min(Math.max(r.h, MIN_SIZE.h), Math.max(MIN_SIZE.h, bounds.h));
    return {
      w,
      h,
      x: Math.min(Math.max(r.x, 0), Math.max(0, bounds.w - w)),
      y: Math.min(Math.max(r.y, 0), Math.max(0, bounds.h - h)),
    };
  };
  const shown = $derived(clampRect(rect));

  function drag(event: PointerEvent, kind: 'move' | 'resize') {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    // A click on a title-bar button is a click, not a drag.
    if (kind === 'move' && (event.target as HTMLElement).closest('button:not([data-grip])')) return;
    event.preventDefault();
    onfront();
    target.setPointerCapture(event.pointerId);
    document.body.classList.add('ta-dragging');
    const start = { px: event.clientX, py: event.clientY, ...shown };
    const host = target.closest('[data-workspace]')?.getBoundingClientRect();

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (kind === 'move') {
        onmove(clampRect({ ...start, x: start.x + dx, y: start.y + dy }));
        if (host) {
          const px = e.clientX - host.left;
          const py = e.clientY - host.top;
          snapping = edge === 'left' ? px < SNAP : edge === 'right' ? px > host.width - SNAP : py > host.height - SNAP;
        }
      } else {
        onmove(clampRect({ ...start, w: start.w + dx, h: start.h + dy }));
      }
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('ta-dragging');
      if (snapping) {
        snapping = false;
        ondock();
      } else {
        oncommit();
      }
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  // The grip is a real button, so the window can be moved from the keyboard too.
  function nudge(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!d) return;
    event.preventDefault();
    onmove(clampRect({ ...shown, x: shown.x + d[0], y: shown.y + d[1] }));
    oncommit();
  }
</script>

{#if snapping}
  <div
    class="pointer-events-none absolute z-40 rounded-box border-2 border-dashed border-accent bg-accent/10"
    class:inset-y-2={edge !== 'bottom'}
    class:left-2={edge !== 'right'}
    class:right-2={edge !== 'left'}
    class:w-72={edge !== 'bottom'}
    class:bottom-2={edge === 'bottom'}
    class:h-48={edge === 'bottom'}
    aria-hidden="true"
  ></div>
{/if}

<section
  class="ta-window absolute flex flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl"
  style="left: {shown.x}px; top: {shown.y}px; width: {shown.w}px; height: {shown.h}px; z-index: {20 + z}"
  aria-label="Jendela {title}"
  onpointerdowncapture={onfront}
>
  <div
    class="flex h-9 shrink-0 cursor-grab items-center gap-1 border-b border-base-300 bg-base-200 pl-1 pr-1 active:cursor-grabbing"
    onpointerdown={(e) => drag(e, 'move')}
    role="presentation"
  >
    <button class="btn btn-ghost btn-xs btn-square" data-grip aria-label="Pindahkan jendela {title} (panah)" onkeydown={nudge}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="opacity-60">
        <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
      </svg>
    </button>
    <h2 class="min-w-0 flex-1 truncate text-xs font-semibold select-none">{title}</h2>
    <button class="btn btn-ghost btn-xs btn-square" aria-label="Tempelkan {title}" title="Tempel ke tepi" onclick={ondock}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        {#if edge === 'bottom'}<path d="M3 14h18" />{:else if edge === 'left'}<path d="M9 4v16" />{:else}<path d="M15 4v16" />{/if}
      </svg>
    </button>
    <button class="btn btn-ghost btn-xs btn-square" aria-label="Kecilkan {title}" title="Kecilkan ke baki" onclick={onminimize}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 18h14" /></svg>
    </button>
  </div>
  <div class="min-h-0 flex-1 overflow-hidden">
    {@render children()}
  </div>
  <div
    class="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize"
    role="presentation"
    onpointerdown={(e) => drag(e, 'resize')}
  >
    <svg width="10" height="10" viewBox="0 0 10 10" class="absolute right-1 bottom-1 opacity-50" aria-hidden="true">
      <path d="M9 1v8H1" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  </div>
</section>
