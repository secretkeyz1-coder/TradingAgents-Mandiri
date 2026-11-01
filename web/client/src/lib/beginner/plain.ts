// Plain words for the Pemula screen: what an AI rating means, which way the daily
// brief leans, friendly asset names, and prices written the way people read them.
import { RATING_DIRECTION } from '../format';
import { nameOf } from '../tv';

/** Which way the AI leans, in words a beginner can act on. */
export type Lean = { label: string; hint: string; direction: 1 | 0 | -1 };

const RATINGS: Record<string, Omit<Lean, 'direction'>> = {
  Buy: { label: 'Beli', hint: 'AI melihat peluang naik yang kuat.' },
  Overweight: { label: 'Cenderung beli', hint: 'Peluang naiknya lebih besar daripada risikonya.' },
  Hold: { label: 'Tunggu dulu', hint: 'Arahnya belum jelas. Tahan dulu, jangan terburu-buru.' },
  Underweight: { label: 'Cenderung jual', hint: 'Risiko turunnya lebih besar daripada peluangnya.' },
  Sell: { label: 'Jual', hint: 'AI melihat risiko turun yang kuat.' },
};

/** The engine's five ratings (Buy … Sell); anything else (REVIEW) asks for a read of the report. */
export function ratingLean(rating: string | null): Lean {
  const words = RATINGS[rating ?? ''] ?? { label: 'Perlu ditinjau', hint: 'AI belum menarik kesimpulan yang jelas. Baca laporannya dulu.' };
  return { ...words, direction: Math.sign(RATING_DIRECTION[rating ?? ''] ?? 0) as Lean['direction'] };
}

const BIAS: Record<'naik' | 'turun' | 'netral', Lean> = {
  naik: { label: 'Cenderung naik', hint: 'Ringkasan pasar AI terbaru melihat lebih banyak alasan untuk naik.', direction: 1 },
  turun: { label: 'Cenderung turun', hint: 'Ringkasan pasar AI terbaru melihat lebih banyak alasan untuk turun.', direction: -1 },
  netral: { label: 'Belum ada arah', hint: 'Ringkasan pasar AI terbaru belum melihat arah yang jelas.', direction: 0 },
};

export const biasLean = (bias: keyof typeof BIAS): Lean => BIAS[bias];

/** The text colour for a direction: up green, down red, none neutral. */
export const toneOf = (direction: number) => (direction > 0 ? 'text-success' : direction < 0 ? 'text-error' : 'text-base-content/70');

/** Where a beginner can start: well-known assets, one of each kind. */
export const STARTERS: [tv: string, name: string][] = [
  ['OANDA:XAUUSD', 'Emas'],
  ['BINANCE:BTCUSDT', 'Bitcoin'],
  ['IDX:BBCA', 'Bank Central Asia'],
  ['IDX:COMPOSITE', 'IHSG'],
  ['FX_IDC:USDIDR', 'Dolar AS ke Rupiah'],
];

/** The shortest name people know an asset by: the starters' own, else the market list's, else its ticker. */
export function friendlyName(tv: string): string {
  return STARTERS.find(([s]) => s === tv)?.[1] ?? nameOf(tv) ?? tv.split(':').pop() ?? tv;
}

/**
 * A price as people read it: rupiah without decimals, dollars with cents, an index or an
 * exchange rate as a plain number, and tiny prices to four significant digits.
 */
export function priceText(value: number, currency: string | null, yahoo: string): string {
  const plain = yahoo.startsWith('^') || yahoo.endsWith('=X') || !currency;
  const digits: Intl.NumberFormatOptions =
    value < 1
      ? { maximumSignificantDigits: 4 }
      : currency === 'IDR' && !yahoo.startsWith('^')
        ? { maximumFractionDigits: 0 }
        : plain && value < 100
          ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
          : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return value.toLocaleString('id-ID', plain ? digits : { style: 'currency', currency: currency!, ...digits });
}

/** Questions a beginner can tap to start a chat about the asset in focus. */
export const questionsFor = (name: string) => [
  `Jelaskan pergerakan harga ${name} dengan bahasa sederhana`,
  `Apa risiko terbesar ${name} saat ini?`,
  `Apa yang perlu aku pantau dari ${name} minggu ini?`,
];
