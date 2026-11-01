// The chart toolbar's menus hang below their button, but the chart pane clips
// whatever sticks out of it, and on a phone a menu is wider than the room on
// either side of most buttons. So a menu is placed rather than pointed: it hangs
// from its button's right edge when the left has room, else from its left edge,
// then shifts to stay inside the pane and the window, half a rem from each edge,
// and is never wider than they allow. A long menu scrolls within the room below
// its button. An open menu is placed again when its button moves: a badge that
// appears once the menu's data has loaded can re-wrap the toolbar.

/** Where a menu `widthRem` wide opens under `anchor`, its positioned container: its left edge (relative to the anchor) and width in px, and its height cap in px. */
export function placeMenu(anchor: HTMLElement, widthRem: number): { left: number; width: number; maxHeight: number } {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  let frame = anchor.parentElement;
  while (frame && getComputedStyle(frame).overflow === 'visible') frame = frame.parentElement;
  const bounds = frame?.getBoundingClientRect() ?? { left: 0, right: innerWidth, bottom: innerHeight };
  const lo = Math.max(bounds.left, 0) + rem / 2;
  const hi = Math.min(bounds.right, innerWidth) - rem / 2;
  const box = anchor.getBoundingClientRect();
  const width = Math.min(widthRem * rem, hi - lo);
  const hung = box.right - width >= lo ? box.right - width : box.left;
  return {
    left: Math.min(Math.max(hung, lo), hi - width) - box.left,
    width,
    // Less the menu's offset from its button and a little air.
    maxHeight: Math.max(160, Math.min(bounds.bottom, innerHeight) - box.bottom - 12),
  };
}

/**
 * Keeps an open menu placed: again whenever the toolbar around its button changes, in
 * content (a badge appearing) or in size, or the window resizes. Returns the cleanup.
 */
export function keepPlaced(anchor: HTMLElement, widthRem: number, set: (place: ReturnType<typeof placeMenu>) => void): () => void {
  let last = '';
  const update = () => {
    const place = placeMenu(anchor, widthRem);
    const key = `${place.left}|${place.width}|${place.maxHeight}`;
    if (key === last) return;
    last = key;
    set(place);
  };
  const toolbar = anchor.parentElement ?? anchor;
  const resized = new ResizeObserver(update);
  resized.observe(anchor);
  resized.observe(toolbar);
  // Content changes are seen at once, also where no frame is being drawn (a background tab).
  const changed = new MutationObserver(update);
  changed.observe(toolbar, { childList: true, subtree: true, characterData: true });
  addEventListener('resize', update);
  return () => {
    resized.disconnect();
    changed.disconnect();
    removeEventListener('resize', update);
  };
}
