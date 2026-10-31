// Real-time crypto candles from Binance's public market data (no key), so the
// chart, the signal engines and the signal ledger read the bars the BINANCE:
// chart shows, without Yahoo's delay. web/worker/chart_agent.py fetches the same
// endpoint with the same windows, so both sides compute on identical bars.
import type { Candle, Interval } from "./market";

const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
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

type Kline = [number, string, string, string, string, string, ...unknown[]];

async function klines(pair: string, interval: Interval, endTime?: number): Promise<Kline[]> {
  let last: unknown;
  for (const host of HOSTS) {
    const url = `${host}/api/v3/klines?symbol=${pair}&interval=${INTERVAL[interval]}&limit=${LIMIT}${endTime ? `&endTime=${endTime}` : ""}`;
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

/** The last `count` bars, oldest first, the newest possibly still forming (as Yahoo serves them). Times in UTC. */
export async function binanceCandles(pair: string, interval: Interval, count: number): Promise<Candle[]> {
  const rows: Kline[] = [];
  let end: number | undefined;
  while (rows.length < count) {
    const page = await klines(pair, interval, end);
    if (!page.length) break;
    rows.unshift(...page);
    if (page.length < LIMIT) break;
    end = page[0][0] - 1;
  }
  const intraday = MINUTES[interval] < 1440;
  return rows.slice(-count).map((k) => {
    const iso = new Date(k[0]).toISOString();
    return { time: intraday ? iso.slice(0, 19) : iso.slice(0, 10), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
  });
}

/** Bars covering `days`. */
export const barsFor = (interval: Interval, days: number) => Math.ceil((days * 1440) / MINUTES[interval]);
