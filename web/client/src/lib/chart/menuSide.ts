// The chart toolbar's menus hang from their button's right edge, but the chart
// pane clips whatever sticks out of it. When the toolbar wraps and leaves a
// button near the pane's left edge, its menu opens rightwards instead, and a
// long menu scrolls within the room below its button.

/** Where a menu `widthRem` wide opens: rightwards when the left has less room than it needs and than the right; its height cap in px. */
export function placeMenu(anchor: HTMLElement, widthRem: number): { rightward: boolean; maxHeight: number } {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  let frame = anchor.parentElement;
  while (frame && getComputedStyle(frame).overflow === 'visible') frame = frame.parentElement;
  const bounds = frame?.getBoundingClientRect() ?? { left: 0, right: innerWidth, bottom: innerHeight };
  const box = anchor.getBoundingClientRect();
  const leftward = box.right - bounds.left;
  const rightward = bounds.right - box.left;
  return {
    rightward: leftward < widthRem * rem && rightward > leftward,
    // Less the menu's offset from its button and a little air.
    maxHeight: Math.max(160, Math.min(bounds.bottom, innerHeight) - box.bottom - 12),
  };
}
