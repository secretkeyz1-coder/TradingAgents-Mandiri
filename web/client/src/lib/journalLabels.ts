// How a journal trade reads to the user, shared by the trading plan card's "Saya ambil"
// (chart/TradePlan) and Pantau → Jurnal (workspace/dock/JournalView), so both name it alike.
import type { JournalMood, JournalStatus } from './api';

/** The moods a trade can carry, in the order the chips show them. */
export const MOODS: { key: JournalMood; label: string }[] = [
  { key: 'calm', label: 'Tenang' },
  { key: 'confident', label: 'Yakin' },
  { key: 'unsure', label: 'Ragu' },
  { key: 'fomo', label: 'FOMO' },
  { key: 'fear', label: 'Takut' },
  { key: 'revenge', label: 'Balas dendam' },
];
export const MOOD_LABEL = Object.fromEntries(MOODS.map((m) => [m.key, m.label])) as Record<JournalMood, string>;

export const STATUS_LABEL: Record<JournalStatus, string> = {
  open: 'Berjalan',
  win: 'Kena TP',
  loss: 'Kena SL',
  // Not "ditutup sendiri": the journal says that of its own close at TP or SL.
  closed: 'Kamu tutup',
  cancelled: 'Tidak jadi',
};

/** A result in R with its sign, as the journal writes it (+2,0R). */
export const signedR = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}R`;
