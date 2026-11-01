// Icons for the app's screens, drawn on a 24px grid with a 1.8 stroke, for the phone's tab bar.
import type { Screen } from '../stores/workspace.svelte';

export const SCREEN_ICONS: Record<Screen, string> = {
  beranda: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  pasar: 'M9 4v4M9 16v4M17 3v3M17 15v5M7 8h4v8H7zM15 6h4v9h-4z',
  riset: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  pantau: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  uji: 'M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3M7.5 15h9',
};
