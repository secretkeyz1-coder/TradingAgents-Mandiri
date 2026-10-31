// Candles from Yahoo Finance, the source the engine analyses, so the decision
// markers sit on the prices the agents saw. Daily by default; intraday and
// weekly/monthly are only for looking, the engine itself stays daily.
// Unofficial endpoint: cached, and a failure is reported rather than retried in a loop.
// Crypto comes from Binance instead (binance.ts): real time, the bars the BINANCE: chart shows;
// so do gold's intraday bars (the XAUUSDT perpetual, outside spot gold's closed hours).
import { barsFor, binanceCandles, binancePair, binancePerpetual } from "./binance";

/** `time` is YYYY-MM-DD for 1d and up, YYYY-MM-DDTHH:MM:SS in the exchange's own time zone for intraday. */
export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

export type CandleSeries = {
  symbol: string;
  currency: string | null;
  exchangeTimezone: string | null;
  interval: Interval;
  candles: Candle[];
  /** binance = real time; yahoo = delayed (about 15 minutes for futures). */
  source: "binance" | "yahoo";
};

const CACHE_TTL_MS = 15 * 60_000;
/** Binance bars are fresh: a scan just after a bar closes must see it. */
const BINANCE_TTL_MS = 20_000;
const RANGE_DAYS: Record<(typeof RANGES)[number], number> = { "6mo": 182, "1y": 365, "2y": 730, "5y": 1826 };
const cache = new Map<string, { at: number; value: CandleSeries }>();

export const SYMBOL_PATTERN = /^[A-Za-z0-9.\-=^]{1,20}$/;
export const RANGES = ["6mo", "1y", "2y", "5y"] as const;
export const INTERVALS = ["15m", "1h", "4h", "1d", "1wk", "1mo"] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTRADAY: readonly Interval[] = ["15m", "1h", "4h"];
// Yahoo keeps 15-minute bars for 60 days; any range asks for the last month of them.
const MINUTE_RANGE = "1mo";
// Yahoo serves hourly bars for 730 days at most; 1y keeps clear of that edge.
const INTRADAY_MAX_RANGE = "1y";

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

export async function getCandles(symbol: string, range: (typeof RANGES)[number], interval: Interval = "1d"): Promise<CandleSeries> {
  const intraday = INTRADAY.includes(interval);
  if (intraday && (range === "2y" || range === "5y")) range = INTRADAY_MAX_RANGE;
  const yahooRange = interval === "15m" ? MINUTE_RANGE : range;
  const key = `${symbol}|${yahooRange}|${interval}`;
  const hit = cache.get(key);
  const futures = !binancePair(symbol) && !!binancePerpetual(symbol, interval);
  const pair = binancePair(symbol) ?? binancePerpetual(symbol, interval);
  if (hit && Date.now() - hit.at < (hit.value.source === "binance" ? BINANCE_TTL_MS : CACHE_TTL_MS)) return hit.value;

  if (pair) {
    try {
      // The same windows Yahoo would give: a month of 15m bars, at most a year of intraday ones.
      const days = interval === "15m" ? 30 : RANGE_DAYS[range];
      const count = barsFor(interval, days);
      // A refresh fetches only the newest page and stitches it onto the bars already held.
      const held = hit?.value.source === "binance" ? hit.value.candles : [];
      const page = held.length ? await binanceCandles(pair, interval, 1000, futures) : [];
      const candles =
        page.length && held.length && held.at(-1)!.time >= page[0].time
          ? [...held.filter((c) => c.time < page[0].time), ...page].slice(-count)
          : await binanceCandles(pair, interval, count, futures);
      const value: CandleSeries = { symbol, currency: "USD", exchangeTimezone: "UTC", interval, candles, source: "binance" };
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch (e) {
      console.error(`binance ${pair} ${interval}: ${(e as Error).message}; falling back to Yahoo`);
    }
  }

  // 4h is not a Yahoo interval; it is built from hourly bars below.
  const yahooInterval = interval === "4h" ? "1h" : interval;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${yahooRange}&interval=${yahooInterval}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => null)) as YahooChart | null;
  const result = body?.chart?.result?.[0];
  if (!res.ok || !result) {
    throw new Error(body?.chart?.error?.description ?? `Yahoo Finance tidak punya data untuk ${symbol} (HTTP ${res.status})`);
  }

  const quote = result.indicators.quote[0];
  // Dividend/split-adjusted, as the engine reads prices (yfinance auto_adjust),
  // so drawings and decision markers sit on the same series the agents used.
  // Intraday responses carry no adjclose, so those bars stay as traded.
  const adjclose = result.indicators.adjclose?.[0]?.adjclose;
  // Times in the exchange's own time zone: a Jakarta session at 09:00 WIB is
  // still the previous day in UTC.
  const offset = (result.meta.gmtoffset ?? 0) * 1000;
  let candles: Candle[] = [];
  (result.timestamp ?? []).forEach((ts, i) => {
    const [open, high, low, close] = [quote.open[i], quote.high[i], quote.low[i], quote.close[i]];
    if (open == null || high == null || low == null || close == null) return;
    const local = new Date(ts * 1000 + offset).toISOString();
    const time = intraday ? local.slice(0, 19) : local.slice(0, 10);
    const f = adjclose?.[i] != null && close ? adjclose[i]! / close : 1;
    const candle = { time, open: open * f, high: high * f, low: low * f, close: close * f, volume: quote.volume[i] ?? 0 };
    // Yahoo can repeat the current bar; keep the latest row for a time.
    if (candles.at(-1)?.time === time) candles[candles.length - 1] = candle;
    else candles.push(candle);
  });
  if (interval === "4h") candles = aggregate(candles, 4);

  const value = {
    symbol: result.meta.symbol,
    currency: result.meta.currency ?? null,
    exchangeTimezone: result.meta.exchangeTimezoneName ?? null,
    interval,
    candles,
    source: "yahoo" as const,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Merge hourly bars into `hours`-wide bars aligned to midnight in the exchange's time zone (00, 04, 08, …). */
function aggregate(hourly: Candle[], hours: number): Candle[] {
  const out: Candle[] = [];
  for (const c of hourly) {
    const hour = Number(c.time.slice(11, 13));
    const bucket = `${c.time.slice(0, 10)}T${String(hour - (hour % hours)).padStart(2, "0")}:00:00`;
    const last = out.at(-1);
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, time: bucket });
    }
  }
  return out;
}
