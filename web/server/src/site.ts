// What the public site shows without signing in: prices for the tape and the
// research desk, the crypto map, the latest live signals with their record,
// and the AI market brief. Everything is cached, so a busy landing page costs a
// few upstream calls a minute. The brief is written by the quick model every
// six hours from the figures computed here, and only from them
// (worker/brief.py); SITE_BRIEF=off stops it.
import { desc } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { BINANCE_HOSTS } from "./binance";
import { db } from "./db";
import { marketBriefs } from "./db/schema";
import { recordError } from "./errors";
import { publicLedger } from "./ledger";
import { leaderOnly } from "./locks";
import { log } from "./log";
import { getCandles } from "./market";
import { getCatalog, runCommand } from "./worker";

/** `unit` replaces the quote currency where it misleads: an index moves in points. */
type Asset = { symbol: string; label: string; brief: boolean; unit?: string };
/** The tape and the desk, in this order; the AI reads the `brief` ones. */
const ASSETS: Asset[] = [
  { symbol: "BTC-USD", label: "BTC", brief: true },
  { symbol: "ETH-USD", label: "ETH", brief: true },
  { symbol: "SOL-USD", label: "SOL", brief: false },
  { symbol: "GC=F", label: "Emas", brief: true },
  { symbol: "^JKSE", label: "IHSG", brief: true, unit: "poin indeks" },
  { symbol: "^GSPC", label: "S&P 500", brief: false, unit: "poin indeks" },
  { symbol: "IDR=X", label: "USD/IDR", brief: false },
];
/** The crypto map: Binance spot pairs against USDT. */
const MAP = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "TRX", "AVAX", "LINK", "DOT", "LTC", "BCH", "NEAR", "UNI", "ATOM", "APT", "ARB", "OP", "SUI", "TON", "SHIB", "PEPE", "FIL"];
const BRIEF_HOURS = 6;

const cache = new Map<string, { at: number; value: unknown }>();
const loading = new Map<string, Promise<unknown>>();

/** Drop every cached answer: the tests write rows a fresh cache would otherwise hide for up to a minute. */
export const forgetCache = () => cache.clear();

/** The cached answer while it is fresh, one load at a time, and the stale answer when a refresh fails. */
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T);
  const running = loading.get(key);
  if (running) return running as Promise<T>;
  const next = load()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((err) => {
      if (hit) return hit.value as T;
      throw err;
    })
    .finally(() => loading.delete(key));
  loading.set(key, next);
  return next;
}

const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

/** Wilder's RSI of a series of closes. */
function rsi(closes: number[], n = 14): number | null {
  if (closes.length <= n) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

/** One asset from its daily bars: price, change on the previous close, a 30-day line, and the figures the brief reads. */
async function quote(a: Asset) {
  const series = await getCandles(a.symbol, "6mo", "1d");
  const bars = series.candles.filter((c) => Number.isFinite(c.close));
  if (bars.length < 2) throw new Error(`${a.symbol}: data kosong`);
  const closes = bars.map((c) => c.close);
  const last = closes.at(-1)!;
  const back = (n: number) => (closes.length > n ? last / closes[closes.length - 1 - n] - 1 : null);
  const month = bars.slice(-30);
  return {
    symbol: a.symbol,
    label: a.label,
    price: last,
    change: back(1),
    currency: series.currency,
    delayed: series.source === "yahoo",
    time: bars.at(-1)!.time,
    spark: closes.slice(-30),
    figures: {
      change7d: back(7),
      change30d: back(30),
      sma20: closes.length >= 20 ? mean(closes.slice(-20)) : null,
      sma50: closes.length >= 50 ? mean(closes.slice(-50)) : null,
      rsi14: rsi(closes),
      high30: Math.max(...month.map((c) => c.high)),
      low30: Math.min(...month.map((c) => c.low)),
    },
  };
}

async function market() {
  const settled = await Promise.allSettled(ASSETS.map(quote));
  const quotes = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (!quotes.length) throw new Error("Data pasar tidak tersedia");
  return quotes;
}

/** 24-hour change and volume of the map's coins, largest volume first. */
async function cryptoMap() {
  const symbols = encodeURIComponent(JSON.stringify(MAP.map((s) => `${s}USDT`)));
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/ticker/24hr?symbols=${symbols}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const rows = (await res.json()) as { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }[];
      return rows
        .map((r) => ({ symbol: r.symbol.replace(/USDT$/, ""), price: Number(r.lastPrice), change: Number(r.priceChangePercent) / 100, volume: Number(r.quoteVolume) }))
        .sort((a, b) => b.volume - a.volume);
    } catch {
      /* the next host */
    }
  }
  throw new Error("Binance tidak bisa dihubungi");
}

// --------------------------------------------------------------------------- the AI brief

const briefSchema = z.object({
  headline: z.string().min(5).max(200),
  summary: z.string().min(10).max(1200),
  assets: z
    .array(z.object({ symbol: z.string().max(20), bias: z.enum(["naik", "turun", "netral"]), bull: z.string().max(500), bear: z.string().max(500), watch: z.string().max(500) }))
    .min(1)
    .max(8),
  risk: z.string().max(500),
});

/** What the model may use: computed figures, rounded, under plain Indonesian names. */
async function briefData() {
  const quotes = (await market()).filter((q) => ASSETS.find((a) => a.symbol === q.symbol)?.brief);
  const ledger = await publicLedger();
  const fig = (x: number | null, digits = 2) => (x == null ? null : round(x, digits));
  const pct = (x: number | null) => (x == null ? null : round(x * 100, 2));
  return {
    waktu: `${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" })} WIB`,
    aset: quotes.map((q) => ({
      symbol: q.label,
      harga_terakhir: fig(q.price),
      mata_uang: ASSETS.find((a) => a.symbol === q.symbol)?.unit ?? q.currency,
      perubahan_1_hari_persen: pct(q.change),
      perubahan_7_hari_persen: pct(q.figures.change7d),
      perubahan_30_hari_persen: pct(q.figures.change30d),
      rata_rata_20_hari: fig(q.figures.sma20),
      rata_rata_50_hari: fig(q.figures.sma50),
      rsi_14_hari: fig(q.figures.rsi14, 1),
      tertinggi_30_hari: fig(q.figures.high30),
      terendah_30_hari: fig(q.figures.low30),
      data_tertunda: q.delayed,
    })),
    sinyal_terbaru: ledger.latest.slice(0, 5).map((s) => ({ simbol: s.symbol, strategi: s.source, timeframe: s.timeframe, arah: s.side, status: s.status })),
  };
}

let briefing = false;

/** A new brief when the last one is older than BRIEF_HOURS. */
async function writeBrief() {
  if (briefing) return;
  briefing = true;
  try {
    const [latest] = await db.select({ createdAt: marketBriefs.createdAt }).from(marketBriefs).orderBy(desc(marketBriefs.createdAt)).limit(1);
    if (latest && Date.now() - latest.createdAt.getTime() < BRIEF_HOURS * 3_600_000) return;
    const data = await briefData();
    const { provider, quickModel, deepModel, backendUrl } = (await getCatalog()).defaults;
    let content: unknown = null;
    let error = "";
    const handle = runCommand("brief", { provider, quickModel, deepModel, backendUrl, data }, { userId: null, kind: "brief" }, async (e) => {
      if (e.type === "brief") content = e.content;
      else if (e.type === "error") error = String(e.message);
    });
    await handle.done;
    const parsed = briefSchema.safeParse(content);
    if (!parsed.success) {
      log.warn("brief_not_written", { reason: error || "the model's answer did not fit the format" });
      return;
    }
    await db.insert(marketBriefs).values({ model: quickModel, content: parsed.data, data });
    cache.delete("brief");
  } catch (err) {
    void recordError("brief", err);
  } finally {
    briefing = false;
  }
}

export function startBriefs() {
  if (process.env.SITE_BRIEF === "off") return;
  const tick = leaderOnly(writeBrief);
  tick();
  setInterval(tick, 3_600_000);
}

async function latestBrief() {
  const [b] = await db.select().from(marketBriefs).orderBy(desc(marketBriefs.createdAt)).limit(1);
  return b ? { createdAt: b.createdAt, content: b.content, data: b.data } : null;
}

/** The latest brief's take on one engine ticker (BTC-USD, GC=F, ^JKSE …), or null when the brief does not cover it. */
export async function briefFor(ticker: string) {
  const label = ASSETS.find((a) => a.brief && a.symbol === ticker)?.label;
  if (!label) return null;
  const latest = await cached("brief", 60_000, latestBrief);
  const content = latest ? briefSchema.safeParse(latest.content) : null;
  const asset = content?.success ? content.data.assets.find((a) => a.symbol === label) : undefined;
  return latest && asset ? { at: latest.createdAt, ...asset } : null;
}

// --------------------------------------------------------------------------- routes, before the sign-in guard

export const siteApi = new Hono();

async function send(c: Context, load: () => Promise<unknown>) {
  try {
    return c.json((await load()) as object);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 503);
  }
}

siteApi.get("/public/market", (c) => send(c, async () => (await cached("market", 60_000, market)).map(({ figures: _figures, ...q }) => q)));
siteApi.get("/public/crypto-map", (c) => send(c, () => cached("map", 60_000, cryptoMap)));
siteApi.get("/public/signals", (c) => send(c, () => cached("signals", 120_000, publicLedger)));
siteApi.get("/public/brief", (c) => send(c, () => cached("brief", 60_000, latestBrief)));
