// How a signal call reads on Beranda and in Riwayat call (ADR 0021): its indicator by name and timeframe, where it
// stands as a chip says it (with an icon, so the colour is never alone), its R signed with the decimal comma, and
// its prices at one precision per asset so the levels line up in a column.
import { INDICATOR_NAMES, TIMEFRAME_LABELS } from '../../alertLabels';
import type { CallOutcome, SignalCall } from '../../api';
import type { IconName } from '../icons';

/** An indicator by name: a built-in engine, a script or a published one the server named, or one since deleted. */
export const indicatorName = (key: string, names: Record<string, string>) =>
  INDICATOR_NAMES[key] ?? names[key] ?? (key.startsWith('catalog:') ? 'Indikator yang sudah dihapus' : 'Skrip yang sudah dihapus');

/** An indicator with its timeframe, as the notifications name it: Scalper Pro+ 15 menit. */
export const indicatorText = (key: string, timeframe: string, names: Record<string, string>) =>
  `${indicatorName(key, names)} ${TIMEFRAME_LABELS[timeframe as keyof typeof TIMEFRAME_LABELS] ?? timeframe}`;

/** Where a call stands for the member, as the server groups it (alerts.ts OUTCOME). */
export const outcomeOf = (c: Pick<SignalCall, 'status' | 'tracked'>): CallOutcome =>
  c.status === 'open' ? (c.tracked ? 'open' : 'other') : c.status === 'win' || c.status === 'loss' ? c.status : 'other';

/** A call's result as its chip says it: the words (and a short form for tight rows), the chip's tone and its icon. */
export function resultOf(c: Pick<SignalCall, 'status' | 'tracked'>): { label: string; short: string; dir: 'up' | 'down' | 'run' | 'flat'; icon: IconName } {
  if (c.status === 'open')
    return c.tracked ? { label: 'Berjalan', short: 'Berjalan', dir: 'run', icon: 'clock' } : { label: 'Tidak dipantau lagi', short: 'Tak dipantau', dir: 'flat', icon: 'minus' };
  if (c.status === 'win') return { label: 'Kena TP', short: 'Kena TP', dir: 'up', icon: 'check' };
  if (c.status === 'loss') return { label: 'Kena SL', short: 'Kena SL', dir: 'down', icon: 'x' };
  if (c.status === 'partial') return { label: 'Kena TP1, sisanya impas atau SL', short: 'Kena TP1', dir: 'flat', icon: 'check' };
  if (c.status === 'unfilled') return { label: 'Order tidak terisi', short: 'Tak terisi', dir: 'flat', icon: 'minus' };
  if (c.status === 'exit') return { label: 'Keluar karena kondisi', short: 'Keluar', dir: 'flat', icon: 'minus' };
  if (c.status === 'expired') return { label: 'Kedaluwarsa', short: 'Kedaluwarsa', dir: 'flat', icon: 'minus' };
  return { label: 'Diganti sinyal baru', short: 'Diganti', dir: 'flat', icon: 'minus' };
}

/** R with its sign and one decimal: +2,0R, −1,0R; a dash for a call not scored. */
export const rText = (r: number | null | undefined) =>
  r == null ? '–' : `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}R`;

/** The tone of an R: up, down, or neither. */
export const rTone = (r: number | null | undefined) => (r == null || r === 0 ? '' : r > 0 ? 'ta-up' : 'ta-down');

/** A price with the decimal comma, whole for a whole number (IDX) and with fixed decimals otherwise, so levels line up. */
export function priceText(v: number): string {
  const digits = Number.isInteger(v) ? 0 : Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 4 : 8;
  return v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Beli or Jual, for a call's side as the engines write it. */
export const sideName = (side: string) => (side === 'SELL' ? 'Jual' : 'Beli');

const relative = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
/** The WIB calendar day of a moment, as a count of days, so "kemarin" means yesterday's date however many hours ago. */
const wibDayCount = (t: number) => Math.floor((t + 7 * 3_600_000) / 86_400_000);
/** How long ago a moment was: 5 menit lalu, 3 jam lalu, kemarin, 2 hari lalu. */
export function agoText(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  const days = wibDayCount(now) - wibDayCount(at);
  if (days > 0) return relative.format(-days, 'day');
  const minutes = Math.round((now - at) / 60_000);
  return minutes < 60 ? relative.format(-minutes, 'minute') : relative.format(-Math.round(minutes / 60), 'hour');
}
