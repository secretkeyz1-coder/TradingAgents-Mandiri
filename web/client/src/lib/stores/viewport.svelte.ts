// Which workspace layout fits the window: three columns + dock (wide), chart +
// AI panel with the market list as a drawer (medium), or one panel at a time
// with a bottom tab bar (narrow). Panels that are not shown are not mounted,
// so a hidden TradingView iframe never loads.
const wide = window.matchMedia('(min-width: 80rem)');
const medium = window.matchMedia('(min-width: 64rem)');

export const viewport = $state({ wide: wide.matches, medium: medium.matches });

function sync() {
  viewport.wide = wide.matches;
  viewport.medium = medium.matches;
}
wide.addEventListener('change', sync);
medium.addEventListener('change', sync);
// Some environments (device emulation, a few embedded browsers) resize without
// firing the media-query change event; a resize re-read costs nothing.
window.addEventListener('resize', sync);

export type Layout = 'wide' | 'medium' | 'narrow';

export function layoutOf(v: { wide: boolean; medium: boolean }): Layout {
  return v.wide ? 'wide' : v.medium ? 'medium' : 'narrow';
}
