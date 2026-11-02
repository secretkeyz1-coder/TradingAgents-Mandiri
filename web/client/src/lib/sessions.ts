// Whether a symbol's market is in its regular hours now, and when that changes, in WIB: the IDX
// sessions (with Friday's longer break), the US exchanges on New York time (so daylight saving
// moves them in WIB), forex and gold from Sunday evening to Friday evening New York time (gold
// with its daily hour off), crypto always. Exchange holidays are not known here, so a holiday
// still reads as open; the badge says these are regular hours.
import { MARKET_TABS } from './tv';

export type Session = { open: boolean; text: string };
type Market = 'idx' | 'us' | 'crypto' | 'forex' | 'commodities';

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const CRYPTO = /^(BINANCE|BYBIT|OKX|COINBASE|KUCOIN|GATEIO|GATE|INDODAX|BITGET|MEXC|HTX|KRAKEN|BITSTAMP|CRYPTO):/;
const US = /^(NASDAQ|NYSE|AMEX|SP|DJ|CBOE|ARCA|BATS):/;

function marketOf(tv: string): Market | null {
  // Gold and silver sit in the Forex tab but keep the futures day, with its hour off.
  if (/^OANDA:X(AU|AG)/.test(tv)) return 'commodities';
  const tab = MARKET_TABS.find((t) => t.groups.some((g) => g.symbols.some(([s]) => s === tv)));
  if (tab) return tab.key as Market;
  if (tv.startsWith('IDX:')) return 'idx';
  if (CRYPTO.test(tv)) return 'crypto';
  if (US.test(tv)) return 'us';
  if (/^(COMEX|NYMEX|CBOT|TVC):/.test(tv)) return 'commodities';
  if (/^(FX_IDC|FX|OANDA|FOREXCOM):/.test(tv)) return 'forex';
  return null;
}

/** The wall clock in a time zone as weekday (0 = Sunday) and minute of the day. */
function clockIn(zone: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')), minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** When a minute of the week in a time zone (Sunday 00:00 = 0) next comes, as the WIB clock reads it. */
function wibAt(zone: string, weekMinute: number, at: Date) {
  const here = clockIn(zone, at);
  const ahead = (((weekMinute - (here.day * 1440 + here.minute)) % 10080) + 10080) % 10080;
  const then = clockIn('Asia/Jakarta', new Date(at.getTime() + ahead * 60_000));
  const time = `${String(Math.floor(then.minute / 60)).padStart(2, '0')}.${String(then.minute % 60).padStart(2, '0')}`;
  return then.day === clockIn('Asia/Jakarta', at).day && ahead < 1440 ? time : `${DAYS[then.day]} ${time}`;
}

/** Open spans as [from, to) minutes of the week in a time zone: open until when, or closed until when. */
function judge(zone: string, spans: [number, number][], at: Date, name: string): Session {
  const now = clockIn(zone, at);
  const minute = now.day * 1440 + now.minute;
  const current = spans.find(([a, b]) => minute >= a && minute < b);
  if (current) return { open: true, text: `${name} buka · tutup ${wibAt(zone, current[1], at)} WIB` };
  const next = spans.map(([a]) => a).sort((a, b) => ((a - minute + 10080) % 10080) - ((b - minute + 10080) % 10080))[0];
  return { open: false, text: `${name} tutup · buka ${wibAt(zone, next, at)} WIB` };
}

const day = (d: number, from: number, to: number): [number, number] => [d * 1440 + from, d * 1440 + to];
// IDX regular sessions: Monday to Thursday 09.00–12.00 and 13.30–15.49, Friday 09.00–11.30 and 14.00–15.49.
const IDX: [number, number][] = [1, 2, 3, 4].flatMap((d) => [day(d, 540, 720), day(d, 810, 949)]).concat([day(5, 540, 690), day(5, 840, 949)]);
// US exchanges 09.30–16.00 New York time.
const NYSE: [number, number][] = [1, 2, 3, 4, 5].map((d) => day(d, 570, 960));
// Forex from Sunday 17.00 to Friday 17.00 New York time; gold the same with an hour off from 17.00 each day.
const FOREX: [number, number][] = [[1020, 5 * 1440 + 1020]];
const GOLD: [number, number][] = [0, 1, 2, 3, 4].map((d) => [d * 1440 + 1080, (d + 1) * 1440 + 1020]);

/** The regular session of the market this TradingView symbol trades on; null when the market is not known. */
export function sessionOf(tv: string, at = new Date()): Session | null {
  const market = marketOf(tv);
  if (market === 'crypto') return { open: true, text: 'Kripto · 24 jam' };
  if (market === 'idx') {
    const s = judge('Asia/Jakarta', IDX, at, 'IDX');
    // Between the two sessions it is the lunch break, not the close.
    const now = clockIn('Asia/Jakarta', at);
    const friday = now.day === 5;
    const lunch = now.day >= 1 && now.day <= 5 && now.minute >= (friday ? 690 : 720) && now.minute < (friday ? 840 : 810);
    return lunch ? { open: false, text: s.text.replace('IDX tutup', 'IDX istirahat siang') } : s;
  }
  if (market === 'us') return judge('America/New_York', NYSE, at, 'Bursa AS');
  if (market === 'forex') return judge('America/New_York', FOREX, at, 'Forex');
  if (market === 'commodities') return judge('America/New_York', GOLD, at, tv.includes('XAU') ? 'Emas' : tv.includes('XAG') ? 'Perak' : 'Komoditas');
  return null;
}
