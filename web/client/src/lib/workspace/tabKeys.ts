// Keyboard for a row of ARIA tabs (the WAI-ARIA tabs pattern, with automatic activation): the left and
// right arrows move to the neighbouring tab and show it, wrapping round; Home and End go to the ends.
// Each tab button carries data-tab with its key; only the shown one is in the Tab order (tabindex 0).

/** Handle a keydown on one of the tabs: show the tab the key moves to and focus it. */
export function tabKeys<K extends string>(e: KeyboardEvent, keys: readonly K[], current: K, show: (key: K) => void) {
  const at = keys.indexOf(current);
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : step ? (at + step + keys.length) % keys.length : -1;
  if (next < 0) return;
  e.preventDefault();
  show(keys[next]);
  (e.currentTarget as HTMLElement).closest('[role="tablist"]')?.querySelector<HTMLElement>(`[data-tab="${keys[next]}"]`)?.focus();
}
