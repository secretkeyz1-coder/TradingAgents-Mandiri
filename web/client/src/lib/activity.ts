// Tells the server every 30 seconds that this tab is being used (server/src/analytics.ts):
// only while it is in front and someone touched it in the last five minutes, with the
// screen, its tab and, on a chart, the symbol open. The server keeps one row per minute for
// the admin's activity pages for 90 days, as the privacy policy says. AppShell starts it for
// members; admin accounts send nothing.
import { api, type ActivityScreen } from './api';

const BEAT_MS = 30_000;
const IDLE_MS = 5 * 60_000;
const INPUT = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

export type Place = { screen: ActivityScreen; tab: string | null; symbol: string | null };

/** Starts the beat, reading the place at each one; returns the function that stops it. */
export function trackActivity(where: () => Place): () => void {
  let touched = Date.now();
  const touch = () => (touched = Date.now());
  const beat = () => {
    if (document.visibilityState !== 'visible' || Date.now() - touched > IDLE_MS) return;
    api.activity(where()).catch(() => {
      /* a missed minute is fine */
    });
  };
  // Coming back to the tab counts at once.
  const shown = () => {
    if (document.visibilityState !== 'visible') return;
    touch();
    beat();
  };
  for (const name of INPUT) window.addEventListener(name, touch, { passive: true, capture: true });
  document.addEventListener('visibilitychange', shown);
  beat();
  const timer = setInterval(beat, BEAT_MS);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', shown);
    for (const name of INPUT) window.removeEventListener(name, touch, { capture: true });
  };
}
