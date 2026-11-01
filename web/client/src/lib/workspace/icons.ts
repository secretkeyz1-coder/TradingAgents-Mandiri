// Icons for the workspace's destinations, drawn on a 24px grid with a 1.8 stroke, shared by
// the desktop rail and the phone's tab bar so a place looks the same on both.
import type { MobileTab } from '../stores/workspace.svelte';

export const DESTINATION_ICONS: Record<MobileTab, string> = {
  chart: 'M9 4v4M9 16v4M17 3v3M17 15v5M7 8h4v8H7zM15 6h4v9h-4z',
  pasar: 'M4 6h16M4 12h16M4 18h10',
  riset: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  pantau: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  uji: 'M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.3h12.4a1.5 1.5 0 0 0 1.3-2.3L14 9.5V3M7.5 15h9',
};
