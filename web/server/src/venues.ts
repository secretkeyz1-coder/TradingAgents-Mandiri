// Crypto venues beyond Binance, through CCXT (one library for many exchanges' REST and
// WebSocket APIs): candles for the chart and the lab from the venue the user picks, and live
// quotes from every venue for the price comparison panel. Binance candles stay on binance.ts.
//
// The server fetches everything: many of these exchanges are blocked by Indonesian ISPs, so a
// browser in Indonesia could not reach them, while the server can.
//
// Candle history per venue differs (checked from the server, 31 Oct 2026): Bybit, OKX, Bitget
// and Gate page through CCXT's own pagination; Coinbase and KuCoin page forward by hand; Kraken
// keeps only its last 720 bars and Indodax about nine days of 15m bars, so those two are read as
// their latest page.
import ccxt from "ccxt";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "./auth";
import type { Candle, Interval } from "./market";

export const VENUE_IDS = ["binance", "bybit", "okx", "coinbase", "kraken", "bitget", "kucoin", "gate", "indodax"] as const;
export type VenueId = (typeof VENUE_IDS)[number];

type Paging = "auto" | "manual" | "latest";
/** rateLimit: milliseconds between requests where CCXT's default is faster than the venue allows (Bitget's history). */
export const VENUES: Record<VenueId, { label: string; tv: string; quote: string; paging: Paging; page: number; rateLimit?: number }> = {
  binance: { label: "Binance", tv: "BINANCE", quote: "USDT", paging: "auto", page: 1000 },
  bybit: { label: "Bybit", tv: "BYBIT", quote: "USDT", paging: "auto", page: 1000 },
  okx: { label: "OKX", tv: "OKX", quote: "USDT", paging: "auto", page: 200 },
  coinbase: { label: "Coinbase", tv: "COINBASE", quote: "USD", paging: "manual", page: 300 },
  kraken: { label: "Kraken", tv: "KRAKEN", quote: "USD", paging: "latest", page: 720 },
  bitget: { label: "Bitget", tv: "BITGET", quote: "USDT", paging: "auto", page: 200, rateLimit: 300 },
  kucoin: { label: "KuCoin", tv: "KUCOIN", quote: "USDT", paging: "manual", page: 1500 },
  gate: { label: "Gate", tv: "GATEIO", quote: "USDT", paging: "auto", page: 1000 },
  indodax: { label: "Indodax", tv: "INDODAX", quote: "IDR", paging: "latest", page: 1000 },
};
export const isVenue = (v: unknown): v is VenueId => typeof v === "string" && (VENUE_IDS as readonly string[]).includes(v);

/** The asset of a Yahoo crypto symbol: BTC-USD → BTC; Yahoo's id-suffixed coins (APT21794-USD) → APT. */
export function cryptoBase(symbol: string): string | null {
  const m = symbol.toUpperCase().match(/^([A-Z0-9]+)-(USD|USDT|USDC)$/);
  return m ? m[1].replace(/^([A-Z]+)\d{3,}$/, "$1") : null;
}

const TIMEFRAMES: Partial<Record<Interval, string>> = { "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" };
export const venueTimeframe = (interval: Interval) => TIMEFRAMES[interval] ?? null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Exchange = any;
const exchanges = new Map<VenueId, Promise<Exchange>>();

/** One CCXT instance per venue for the life of the process, its markets loaded once. */
function exchange(venue: VenueId): Promise<Exchange> {
  const known = exchanges.get(venue);
  if (known) return known;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Cls = (ccxt.pro as any)[venue] ?? (ccxt as any)[venue];
  const ex = new Cls({ enableRateLimit: true, timeout: 15_000, ...(VENUES[venue].rateLimit ? { rateLimit: VENUES[venue].rateLimit } : {}) });
  const loading: Promise<Exchange> = ex.loadMarkets().then(() => ex);
  // A venue that failed to load is tried again a minute later, not on every request meanwhile.
  loading.catch((e: Error) => {
    console.error(`venue ${venue}: ${e.message.slice(0, 200)}`);
    setTimeout(() => exchanges.delete(venue), 60_000);
  });
  exchanges.set(venue, loading);
  return loading;
}

/** The venue's market for an asset, or null when it does not list it. */
export async function venuePair(venue: VenueId, base: string): Promise<string | null> {
  const pair = `${base}/${VENUES[venue].quote}`;
  const ex = await exchange(venue);
  return ex.markets?.[pair] ? pair : null;
}

/** A venue call, tried again twice (after 2 s, then 4 s) when the venue answers that we ask too often. */
async function patiently<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      const limited = e instanceof ccxt.RateLimitExceeded || e instanceof ccxt.DDoSProtection || /\b429\b|too many requests/i.test((e as Error).message);
      if (!limited || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/** The last `count` bars of an asset on a venue, oldest first, the newest possibly still forming. Times in UTC. */
export async function venueCandles(venue: VenueId, base: string, interval: Interval, count: number): Promise<Candle[]> {
  const spec = VENUES[venue];
  const tf = venueTimeframe(interval);
  if (!tf) throw new Error(`${spec.label} dipakai untuk timeframe 15m, 1j, 4j dan harian`);
  const ex = await exchange(venue);
  const pair = await venuePair(venue, base);
  if (!pair) throw new Error(`${spec.label} tidak punya ${base}/${spec.quote}`);
  const ms = ex.parseTimeframe(tf) * 1000;
  let rows: number[][];
  if (spec.paging === "latest" || count <= spec.page) {
    rows = await patiently(() => ex.fetchOHLCV(pair, tf, spec.paging === "latest" ? undefined : Date.now() - count * ms, Math.min(count, spec.page)));
  } else if (spec.paging === "auto") {
    rows = await patiently(() =>
      ex.fetchOHLCV(pair, tf, Date.now() - count * ms, undefined, {
        paginate: true,
        paginationCalls: Math.min(200, Math.ceil(count / spec.page) + 5),
      }),
    );
  } else {
    rows = [];
    let since = Date.now() - count * ms;
    for (let calls = 0; calls < 200 && since < Date.now() - ms; calls++) {
      const page: number[][] = await patiently(() => ex.fetchOHLCV(pair, tf, since, spec.page));
      if (!page.length) break;
      rows.push(...page);
      const next = page.at(-1)![0] + ms;
      if (next <= since) break;
      since = next;
    }
  }
  const byTime = new Map(rows.map((r) => [r[0], r]));
  const intraday = ms < 86_400_000;
  return [...byTime.values()]
    .sort((a, b) => a[0] - b[0])
    .slice(-count)
    .map((k) => {
      const iso = new Date(k[0]).toISOString();
      return { time: intraday ? iso.slice(0, 19) : iso.slice(0, 10), open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] ?? 0 };
    });
}

// --------------------------------------------------------------------------- live quotes

export type VenueQuote = {
  venue: VenueId;
  label: string;
  pair: string | null;
  quote: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  /** The price in USD(T) terms, for IDR venues converted at the venue's own USDT/IDR rate. */
  usd: number | null;
  /** When the venue stamped the price, epoch ms. */
  at: number | null;
  live: boolean;
  error?: string;
};

type Watch = { quote: VenueQuote; wanted: number; running: boolean };
const watches = new Map<string, Watch>();
/** A watcher stops a minute after the last page asked for it. */
const IDLE_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Follow one venue's ticker: its WebSocket where it has one (pushed as it changes), else polling its REST API. */
async function follow(key: string, venue: VenueId, pair: string) {
  const w = watches.get(key)!;
  w.running = true;
  const ex = await exchange(venue).catch(() => null);
  while (ex && Date.now() - w.wanted < IDLE_MS) {
    try {
      const t = ex.has.watchTicker ? await ex.watchTicker(pair) : (await sleep(3000), await ex.fetchTicker(pair));
      w.quote = { ...w.quote, last: t.last ?? null, bid: t.bid ?? null, ask: t.ask ?? null, at: t.timestamp ?? Date.now(), live: !!ex.has.watchTicker, error: undefined };
    } catch (e) {
      w.quote = { ...w.quote, error: (e as Error).message.slice(0, 120) };
      await sleep(5000);
    }
  }
  if (ex?.has.unWatchTicker) await ex.unWatchTicker(pair).catch(() => {});
  w.running = false;
}

function want(venue: VenueId, pair: string): Watch {
  const key = `${venue}|${pair}`;
  let w = watches.get(key);
  if (!w) {
    w = {
      quote: { venue, label: VENUES[venue].label, pair, quote: VENUES[venue].quote, last: null, bid: null, ask: null, usd: null, at: null, live: false },
      wanted: 0,
      running: false,
    };
    watches.set(key, w);
  }
  w.wanted = Date.now();
  if (!w.running) follow(key, venue, pair).catch(() => (w!.running = false));
  return w;
}

/** A venue's pair if its markets answer within a moment: undefined while still loading, an Error when it failed. */
async function pairSoon(venue: VenueId, base: string): Promise<string | null | undefined | Error> {
  return Promise.race([venuePair(venue, base).catch((e: Error) => e), sleep(1500).then(() => undefined)]);
}

/** The latest quote of an asset on every venue, starting the watchers it needs. A slow venue never holds the others up. */
export async function venueQuotes(base: string): Promise<VenueQuote[]> {
  return Promise.all(
    VENUE_IDS.map(async (venue): Promise<VenueQuote> => {
      const spec = VENUES[venue];
      const empty = { venue, label: spec.label, pair: null, quote: spec.quote, last: null, bid: null, ask: null, usd: null, at: null, live: false };
      const pair = await pairSoon(venue, base);
      if (pair === undefined) return { ...empty, error: "memuat" };
      if (pair instanceof Error) return { ...empty, error: "gagal terhubung" };
      if (!pair) return { ...empty, error: "tidak tersedia" };
      const q = want(venue, pair).quote;
      if (spec.quote === "IDR") {
        const ratePair = await pairSoon(venue, "USDT");
        const rate = typeof ratePair === "string" ? want(venue, ratePair).quote.last : null;
        return { ...q, usd: q.last && rate ? q.last / rate : null };
      }
      return { ...q, usd: q.last };
    }),
  );
}

export const venuesApi = new Hono<AppEnv>();

venuesApi.get("/venues", (c) => c.json(VENUE_IDS.map((id) => ({ id, label: VENUES[id].label, tv: VENUES[id].tv, quote: VENUES[id].quote }))));

const BASE = /^[A-Z0-9]{2,15}$/;

/** Every venue's live quote for an asset, once a second, for as long as the page listens. */
venuesApi.get("/venues/stream", (c) => {
  const base = (c.req.query("base") ?? "").toUpperCase();
  if (!BASE.test(base)) return c.json({ error: "Aset tidak valid" }, 400);
  return streamSSE(c, async (stream) => {
    let open = true;
    stream.onAbort(() => {
      open = false;
    });
    while (open) {
      await stream.writeSSE({ event: "quotes", data: JSON.stringify(await venueQuotes(base)) });
      await stream.sleep(1000);
    }
  });
});
