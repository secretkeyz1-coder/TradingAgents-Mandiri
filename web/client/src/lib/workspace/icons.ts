// Icons for the app's screens, drawn on a 24px grid with a 1.8 stroke, for the phone's tab bar.
import type { Screen } from '../stores/workspace.svelte';

export const SCREEN_ICONS: Record<Screen, string> = {
  beranda: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  pasar: 'M9 4v4M9 16v4M17 3v3M17 15v5M7 8h4v8H7zM15 6h4v9h-4z',
  riset: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  pantau: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  uji: 'M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3M7.5 15h9',
};

/** Stroke icons for the Uji strategi screens and their controls, on the same grid. */
export const ICONS = {
  library: 'm12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5',
  lab: 'M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3M7.5 15h9',
  signals: 'M3 12h4l3-8 4 16 3-8h4',
  backtest: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  check: 'M5 12.5 10 17.5 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  minus: 'M6 12h12',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 4 2.8 19.5h18.4L12 4ZM12 10v4.5M12 17.6v.1',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18ZM12 11v5.5M12 7.6v.1',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18ZM12 7v5l3 2',
  trash: 'M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9ZM10 20a2.2 2.2 0 0 0 4 0',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4ZM5 17a3 3 0 0 1 3-3h11',
  lock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM8 11V8a4 4 0 0 1 8 0v3',
  code: 'm8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16',
  template: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 8h8M8 12h8M8 16h5',
  clipboard: 'M8 4h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 4V3h6v1M9 11h6M9 15h4',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  right: 'm9 6 6 6-6 6',
  left: 'm15 18-6-6 6-6',
  lossTrend: 'm3 7 7 7 4-4 7 7M15 17h6v-6',
  gainTrend: 'm3 17 7-7 4 4 7-7M15 7h6v6',
  dot: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8Z',
} as const;
export type IconName = keyof typeof ICONS;
