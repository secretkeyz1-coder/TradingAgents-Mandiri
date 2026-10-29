// Navigation state lives in the workspace store (lib/stores/workspace.svelte.ts).
// This only builds the app's own URL for TradingView widgets, whose clicks come
// back as #/?tvwidgetsymbol=… and change the symbol in focus.
export function appUrl(path: string) {
  return `${location.origin}${location.pathname}#${path}`;
}
