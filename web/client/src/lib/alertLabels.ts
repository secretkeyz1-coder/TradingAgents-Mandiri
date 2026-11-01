// How a signal alert reads to the user, shared by the chart's Notifikasi menu
// (chart/AlertsMenu) and the Alert tab (workspace/dock/AlertsView) so both name it alike.
import type { SignalAlert } from './api';

/** Built-in engines by name; a user's script is named by its combo label instead. */
export const INDICATOR_NAMES: Record<string, string> = { pob: 'PoB BYSTRA', scalper: 'Scalper Pro+', fib: 'Fib Golden Zone' };

export const TIMEFRAME_LABELS: Record<SignalAlert['timeframe'], string> = { '15m': '15m', '1h': '1j', '4h': '4j', '1d': 'harian' };

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

/** Shown on an alert whose indicator the admin no longer opens to this account. */
export const UNAVAILABLE_NOTE = 'Indikator ini tidak tersedia di paketmu, jadi notifikasinya dijeda.';
