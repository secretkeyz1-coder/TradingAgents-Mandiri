// Daily candles from Yahoo Finance, the source the engine analyses, so the
// decision markers sit on the prices the agents saw. Unofficial endpoint:
// cached, and a failure is reported rather than retried in a loop.

export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

export type CandleSeries = { symbol: string; currency: string | null; exchangeTimezone: string | null; candles: Candle[] };

const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; value: CandleSeries }>();

export const SYMBOL_PATTERN = /^[A-Za-z0-9.\-=^]{1,20}$/;
export const RANGES = ["6mo", "1y", "2y", "5y"] as const;

type YahooChart = {
  chart: {
    result?: {
      meta: { symbol: string; currency?: string; exchangeTimezoneName?: string; gmtoffset?: number };
      timestamp?: number[];
      indicators: {
        quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[];
        adjclose?: { adjclose: (number | null)[] }[];
      };
    }[];
    error?: { description?: string } | null;
  };
};

export async function getCandles(symbol: string, range: (typeof RANGES)[number]): Promise<CandleSeries> {
  const key = `${symbol}|${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => null)) as YahooChart | null;
  const result = body?.chart?.result?.[0];
  if (!res.ok || !result) {
    throw new Error(body?.chart?.error?.description ?? `Yahoo Finance tidak punya data untuk ${symbol} (HTTP ${res.status})`);
  }

  const quote = result.indicators.quote[0];
  // Dividend/split-adjusted, as the engine reads prices (yfinance auto_adjust),
  // so drawings and decision markers sit on the same series the agents used.
  const adjclose = result.indicators.adjclose?.[0]?.adjclose;
  // Dates in the exchange's own time zone: a Jakarta session at 09:00 WIB is
  // still the previous day in UTC.
  const offset = (result.meta.gmtoffset ?? 0) * 1000;
  const candles: Candle[] = [];
  (result.timestamp ?? []).forEach((ts, i) => {
    const [open, high, low, close] = [quote.open[i], quote.high[i], quote.low[i], quote.close[i]];
    if (open == null || high == null || low == null || close == null) return;
    const time = new Date(ts * 1000 + offset).toISOString().slice(0, 10);
    const f = adjclose?.[i] != null && close ? adjclose[i]! / close : 1;
    const candle = { time, open: open * f, high: high * f, low: low * f, close: close * f, volume: quote.volume[i] ?? 0 };
    // Yahoo can repeat the current day; keep the latest row for a date.
    if (candles.at(-1)?.time === time) candles[candles.length - 1] = candle;
    else candles.push(candle);
  });

  const value = {
    symbol: result.meta.symbol,
    currency: result.meta.currency ?? null,
    exchangeTimezone: result.meta.exchangeTimezoneName ?? null,
    candles,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
