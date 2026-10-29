// daisyUI follows the OS colour scheme (light "cobalt" by default, "cobalt-dark"
// when preferred); the TradingView widgets and the canvas chart take the same choice.
const media = window.matchMedia('(prefers-color-scheme: dark)');

export const theme = $state({ dark: media.matches });

media.addEventListener('change', (e) => (theme.dark = e.matches));

let probe: CanvasRenderingContext2D | null = null;

/**
 * A theme token (e.g. "--color-success") as an rgba() string, for canvas code
 * that cannot read CSS variables or parse oklch(). Read it again after a theme change.
 */
export function tokenColor(token: string, alpha = 1): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe || !value) return `rgba(128, 128, 128, ${alpha})`;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
