// How a signal alert reads to the user, shared by the chart's Notifikasi menu
// (chart/AlertsMenu) and the Alert tab (workspace/dock/AlertsView) so both name it alike.
import type { SignalAlert } from './api';

/** Built-in engines by name; a user's script is named by its combo label instead. */
export const INDICATOR_NAMES: Record<string, string> = { pob: 'PoB BYSTRA', scalper: 'Scalper Pro+', fib: 'Fib Golden Zone' };

export const TIMEFRAME_LABELS: Record<SignalAlert['timeframe'], string> = { '15m': '15 menit', '1h': '1 jam', '4h': '4 jam', '1d': 'harian' };

export const SIGNAL_STATUS: Record<NonNullable<SignalAlert['last']>['status'], string> = {
  open: 'berjalan',
  win: 'TP kena',
  loss: 'SL kena',
  exit: 'keluar (kondisi)',
  expired: 'kedaluwarsa',
  replaced: 'diganti',
};

/** An alert's indicator by name: the server's, else a built-in engine, else its combo label without the timeframe, else "Skrip". */
export function indicatorName(alert: Pick<SignalAlert, 'indicator'> & { name?: string | null }, combos: { indicator: string; label: string }[]): string {
  return alert.name ?? INDICATOR_NAMES[alert.indicator] ?? combos.find((c) => c.indicator === alert.indicator)?.label.replace(/ \S+$/, '') ?? 'Skrip';
}

/** A signal's state as a chip says it: capitalised, and in the journal's words for a target or a stop hit (Kena TP, Kena SL). */
export const SIGNAL_STATE: Record<NonNullable<SignalAlert['last']>['status'], string> = {
  open: 'Berjalan',
  win: 'Kena TP',
  loss: 'Kena SL',
  exit: 'Keluar',
  expired: 'Kedaluwarsa',
  replaced: 'Diganti',
};

/** A signal's label as the engines write it ("SELL · Fib 0,5"): its side, and the setup that follows. */
export function signalParts(label: string): { side: 'BUY' | 'SELL' | null; setup: string } {
  const m = label.match(/^(BUY|SELL)\b\s*(?:·\s*)?(.*)$/i);
  return m ? { side: m[1].toUpperCase() as 'BUY' | 'SELL', setup: m[2].trim() } : { side: null, setup: label };
}

/** Shown on an alert whose indicator the admin no longer opens to this account. */
export const UNAVAILABLE_NOTE = 'Indikator ini tidak tersedia di paketmu, jadi notifikasinya dijeda.';
