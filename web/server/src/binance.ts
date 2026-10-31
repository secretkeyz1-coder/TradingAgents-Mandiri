// Real-time crypto candles from Binance's public market data (no key), so the
// chart, the signal engines and the signal ledger read the bars the BINANCE:
// chart shows, without Yahoo's delay. web/worker/chart_agent.py fetches the same
// endpoint with the same windows, so both sides compute on identical bars.
//
// Gold's intraday bars come from Binance's XAUUSDT perpetual (USDT-margined, a
// TradFi contract that tracks gold): real time where Yahoo's COMEX feed lags
// about 15 minutes. It trades around the clock, so bars from the hours spot
// gold is shut (the daily break, the weekend) are dropped, leaving the bars a
// broker's XAUUSD chart has.
import type { Candle, Interval } from "./market";

const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
export { HOSTS as BINANCE_HOSTS };
const FUTURES_HOSTS = ["https://fapi.binance.com"];
/** Yahoo futures symbols served intraday by a Binance perpetual. */
const PERPETUALS: Record<string, string> = { "GC=F": "XAUUSDT" };
const LIMIT = 1000;
const INTERVAL: Record<Interval, string> = { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "1w", "1mo": "1M" };
const MINUTES: Record<Interval, number> = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440, "1wk": 10080, "1mo": 43200 };
/** Pairs Binance answered "invalid symbol" for: they stay on Yahoo. */
const unknown = new Set<string>();

/** BTC-USD → BTCUSDT; Yahoo's id-suffixed coins (APT21794-USD) → APTUSDT; anything else → null. */
export function binancePair(symbol: string): string | null {
  const m = symbol.toUpperCase().match(/^([A-Z0-9]+)-(USD|USDT|USDC)$/);
  if (!m) return null;
  const base = m[1].replace(/^([A-Z]+)\d{3,}$/, "$1");
  const pair = `${base}USDT`;
  return unknown.has(pair) ? null : pair;
}

/** GC=F → XAUUSDT, for intraday bars only; anything else → null. */
export function binancePerpetual(symbol: string, interval: Interval): string | null {
  const pair = PERPETUALS[symbol.toUpperCase()];
  return pair && MINUTES[interval] < 1440 && !unknown.has(pair) ? pair : null;
}

const newYork = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", weekday: "short", hour: "2-digit" });
/**
 * Whether spot gold trades at this bar's start: Sunday 18:00 to Friday 17:00 New York
 * time, less the daily 17:00-18:00 break. web/worker/chart_agent.py applies the same rule.
 */
export function metalsOpen(ms: number): boolean {
  const parts = newYork.formatToParts(new Date(ms));
  const day = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (hour === 17 || day === "Sat") return false;
  if (day === "Fri") return hour < 17;
  if (day === "Sun") return hour >= 18;
  return true;
}

type Kline = [number, string, string, string, string, string, ...unknown[]];

async function klines(pair: string, interval: Interval, endTime: number | undefined, futures: boolean): Promise<Kline[]> {
  let last: unknown;
  for (const host of futures ? FUTURES_HOSTS : HOSTS) {
    const path = futures ? "/fapi/v1/klines" : "/api/v3/klines";
    const url = `${host}${path}?symbol=${pair}&interval=${INTERVAL[interval]}&limit=${LIMIT}${endTime ? `&endTime=${endTime}` : ""}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 400) {
        unknown.add(pair);
        throw new Error(`Binance tidak punya ${pair}`);
      }
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      return (await res.json()) as Kline[];
    } catch (e) {
      last = e;
      if (unknown.has(pair)) break;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * The last `count` bars, oldest first, the newest possibly still forming (as Yahoo serves them). Times in UTC.
 * A perpetual (`futures`) keeps only the bars that start while spot gold trades.
 */
export async function binanceCandles(pair: string, interval: Interval, count: number, futures = false): Promise<Candle[]> {
  const rows: Kline[] = [];
  let end: number | undefined;
  while (rows.length < count) {
    const page = await klines(pair, interval, end, futures);
    if (!page.length) break;
    rows.unshift(...page);
    if (page.length < LIMIT) break;
    end = page[0][0] - 1;
  }
  const intraday = MINUTES[interval] < 1440;
  return rows
    .slice(-count)
    .filter((k) => !futures || metalsOpen(k[0]))
    .map((k) => {
      const iso = new Date(k[0]).toISOString();
      return { time: intraday ? iso.slice(0, 19) : iso.slice(0, 10), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
    });
}

/** Bars covering `days`. */
export const barsFor = (interval: Interval, days: number) => Math.ceil((days * 1440) / MINUTES[interval]);
