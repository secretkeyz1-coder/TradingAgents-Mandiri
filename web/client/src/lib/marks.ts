// The small marks the Pro lists draw for an asset (Riset AI's start, Pantau): its monogram, the AI's call in the
// words Pemula uses (beginner/plain.ts ratingLean), a move's direction for the chip that shows it, and a month of
// closes as a sparkline. Colour always comes with an arrow, an icon or a sign, never alone.
import { marketOf, symbolsOf } from './assets';
import { ratingLean } from './beginner/plain';
import type { IconName } from './workspace/icons';

const MARKETS: Record<string, string> = { idx: 'IDX', us: 'Saham AS', crypto: 'Kripto', forex: 'Kurs', commodities: 'Komoditas' };
/** The market an asset is listed under, in a word (IDX, Kripto…), or null for one the lists do not have. Gold is
 *  listed as a pair too, but a trader calls it a commodity, not a currency. */
export const marketName = (tv: string): string | null =>
  MARKETS[(symbolsOf('commodities').includes(tv) ? 'commodities' : marketOf(tv)) ?? ''] ?? null;

export type Dir = 'up' | 'down' | 'flat';
/** The AI's call on an asset as a chip says it ("Jual"), with its arrow and tone; `when` names its day. */
export type Call = { label: string; dir: Dir; icon: IconName; when?: string };

/** Which way a number points, for the chips: a rise, a fall, or neither. */
export const dirOf = (x: number | null | undefined): Dir => (x == null || x === 0 || Number.isNaN(x) ? 'flat' : x > 0 ? 'up' : 'down');

/** An engine rating (Buy … Sell) as a call. */
export function callOf(rating: string | null, when?: string): Call {
  const lean = ratingLean(rating);
  return { label: lean.label, dir: dirOf(lean.direction), icon: lean.direction > 0 ? 'arrowUp' : lean.direction < 0 ? 'arrowDown' : 'minus', when };
}

const METALS: Record<string, string> = { XAUUSD: 'Au', XAGUSD: 'Ag' };

/** Up to four letters that stand for an asset: its ticker without the quote currency (BTC, EUR), a metal's symbol, IHSG. */
export function monogram(tv: string): string {
  const code = (tv.split(':').pop() ?? tv).toUpperCase();
  if (METALS[code]) return METALS[code];
  if (code === 'COMPOSITE') return 'IHSG';
  const base = code.replace(/(USDT|USDC|USD|IDR)$/, '');
  return (base.length >= 2 ? base : code).replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

/** A change as a signed percentage with the decimal comma: +0,42%, −2,44%. */
export const percentText = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(2).replace('.', ',')}%`;

/**
 * Where a running call or trade stands on its track: the stop on the left, the target on the right, the price now
 * between them. `sl` and `at` are percentages of the track; `share` is how far toward `toward` the price has gone.
 */
export function levelTrack(t: { side: string; entry: number; stopLoss: number; takeProfit: number }, now: number | null) {
  const risk = Math.abs(t.entry - t.stopLoss);
  const reward = Math.abs(t.takeProfit - t.entry);
  const sl = risk + reward ? (risk / (risk + reward)) * 100 : 50;
  if (now == null) return { sl, now: null, at: sl, share: 0, toward: 'TP' as const };
  const moved = t.side === 'BUY' ? now - t.entry : t.entry - now;
  const share = Math.min(1, moved >= 0 ? (reward ? moved / reward : 0) : risk ? -moved / risk : 0);
  return { sl, now, at: moved >= 0 ? sl + share * (100 - sl) : sl - share * sl, share, toward: moved >= 0 ? ('TP' as const) : ('SL' as const) };
}

const WIB = 'Asia/Jakarta';
/** The WIB calendar day of a moment, 2026-11-03: calls are grouped by the day a trader in Indonesia lived them. */
export const wibDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: WIB });
/** The WIB clock of a moment, 06.46. */
export const wibClock = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { timeZone: WIB, hour: '2-digit', minute: '2-digit' });
/** A WIB day as people say it: Hari ini, Kemarin, or the weekday and date (Minggu, 1 Nov). */
export function dayName(day: string, now = new Date()): string {
  const today = wibDate(now.toISOString());
  if (day === today) return 'Hari ini';
  if (day === wibDate(new Date(now.getTime() - 86_400_000).toISOString())) return 'Kemarin';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Closes as a line in a 100 × 32 box, drawn with preserveAspectRatio="none" and a stroke that does not scale. */
export function sparkPath(closes: number[]): string {
  if (closes.length < 2) return '';
  const lo = Math.min(...closes);
  const span = Math.max(...closes) - lo || 1;
  return closes.map((c, i) => `${i ? 'L' : 'M'}${((i / (closes.length - 1)) * 100).toFixed(1)} ${(30 - ((c - lo) / span) * 28).toFixed(1)}`).join(' ');
}
