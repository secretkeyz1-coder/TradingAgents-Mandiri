// Price notifications: "tell me when the price reaches X". A user sets a level on an
// asset; once a minute, beside the signal scan (alerts.ts), the newest price and the 15m
// bars since the level was armed are checked. A level that was crossed sends one message
// (Telegram, and e-mail when the server mails and the address is verified) and stays as a
// record.
//
// Prices are the chart's own candles (market.ts getCandles): crypto and gold live from
// Binance (or the chart's venue), everything else from Yahoo, late and cached. A level
// fires once even with two server instances: switching it off is one conditional update,
// and only the instance that made it sends.
import { and, asc, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "./auth";
import { binancePerpetual } from "./binance";
import { db } from "./db";
import { priceAlerts, signalAlerts, users, type PriceDirection } from "./db/schema";
import { composeMail, mailEnabled, sendMail } from "./mail";
import { getCandles, SYMBOL_PATTERN, type Candle } from "./market";
import { capMessage, limitsOf } from "./plans";
import { cryptoBase, storedVenue, VENUES, venueOfTv, type VenueId } from "./venues";
import { escape, publicUrl, sendTelegram, telegramBot } from "./watch";

type PriceAlert = typeof priceAlerts.$inferSelect;

/** The newest 15m candles of a symbol and where they came from; null when no source answers. */
export type Quote = (symbol: string, venue: string) => Promise<{ candles: Candle[]; source?: string } | null>;

const liveQuote: Quote = (symbol, venue) => getCandles(symbol, "6mo", "15m", (venue || undefined) as VenueId | undefined).catch(() => null);

const price = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 5 : 8 });

/**
 * Whether the level was crossed: the newest price, or a high or a low of a bar opened after
 * the one the level was armed on, so a touch between two checks counts and a move from
 * before the level was set never does.
 */
export function crossed(a: Pick<PriceAlert, "direction" | "price" | "armedBar">, candles: Candle[]): { now: number; touched: boolean } | null {
  const last = candles.at(-1);
  if (!last) return null;
  const beyond = (v: number) => (a.direction === "above" ? v >= a.price : v <= a.price);
  if (beyond(last.close)) return { now: last.close, touched: false };
  const armed = a.armedBar;
  if (armed && candles.some((c) => c.time > armed && beyond(a.direction === "above" ? c.high : c.low))) return { now: last.close, touched: true };
  return null;
}

/** Where a level's price came from, said plainly in the message. */
function dataNote(a: PriceAlert, source?: string) {
  if (!source || source === "yahoo") return a.symbol.endsWith("=F") ? `Data Yahoo (futures ${a.symbol}), tertunda` : "Data Yahoo, tertunda";
  if (source === "binance") return binancePerpetual(a.symbol, "15m") ? "Data Binance (perpetual), real-time, bisa beda beberapa poin dari spot" : "Data Binance, real-time";
  return `Data ${VENUES[source as VenueId]?.label ?? source}, real-time`;
}

/** One message for a fired level: Telegram, and e-mail when the server mails and the address is verified. */
async function notify(
  a: PriceAlert,
  to: { chat: string | null; email: string | null; verified: Date | null },
  hit: { now: number; touched: boolean },
  source?: string,
): Promise<boolean> {
  const title = `${a.label || a.tvSymbol} ${a.direction === "above" ? "naik ke" : "turun ke"} ${price(a.price)}`;
  const now = hit.touched ? `Sempat menyentuh ${price(a.price)}; harga sekarang ${price(hit.now)}.` : `Harga sekarang ${price(hit.now)}.`;
  const note = `${dataNote(a, source)}. Notifikasi ini sekali saja; pasang lagi di aplikasi kalau perlu.`;
  const base = publicUrl();
  const url = base ? `${base}/app#/?s=${encodeURIComponent(a.tvSymbol)}` : "";
  const telegram = await sendTelegram(
    to.chat,
    [`<b>🔔 ${escape(title)}</b>`, escape(`${now} (${a.tvSymbol})`), url ? `<a href="${url}">Buka di aplikasi</a>` : "", `<i>${escape(note)} Riset, bukan saran investasi.</i>`]
      .filter(Boolean)
      .join("\n"),
  );
  const mailed =
    mailEnabled() && to.email && to.verified
      ? (await sendMail(composeMail(to.email, title, [now, note], url ? { label: "Buka di aplikasi", url } : undefined))).ok
      : false;
  return telegram.ok || mailed;
}

let checking = false;

/** Fire every active level the price has crossed. `quote` reads the prices; a test passes its own. */
export async function checkPrices(quote: Quote = liveQuote) {
  if (checking) return;
  checking = true;
  try {
    const rows = await db
      .select({
        alert: priceAlerts,
        chat: users.telegramChatId,
        email: users.email,
        verified: users.emailVerifiedAt,
        owner: { role: users.role, plan: users.plan, planUntil: users.planUntil },
      })
      .from(priceAlerts)
      .innerJoin(users, eq(priceAlerts.userId, users.id))
      .where(and(eq(priceAlerts.active, true), eq(users.disabled, false)))
      .orderBy(asc(priceAlerts.createdAt));
    if (!rows.length) return;
    // Levels share the plan's notification allowance with signal alerts, which count first:
    // a lapsed plan pauses the newest levels.
    const signals = new Map(
      (await db.select({ userId: signalAlerts.userId, n: count() }).from(signalAlerts).groupBy(signalAlerts.userId)).map((r) => [r.userId, r.n]),
    );
    const held = new Map<string, number>();
    const allowed = rows.filter(({ alert, owner }) => {
      const n = (held.get(alert.userId!) ?? signals.get(alert.userId!) ?? 0) + 1;
      held.set(alert.userId!, n);
      return n <= limitsOf(owner).alerts;
    });
    // One price read per symbol and venue.
    const keys = [...new Set(allowed.map(({ alert }) => `${alert.symbol}|${alert.venue}`))];
    const series = new Map(await Promise.all(keys.map(async (k) => [k, await quote(...(k.split("|") as [string, string]))] as const)));
    for (const row of allowed) {
      const { alert } = row;
      const s = series.get(`${alert.symbol}|${alert.venue}`);
      if (!s?.candles.length) continue;
      const hit = crossed(alert, s.candles);
      if (!hit) {
        // A level set while no price could be read is armed on the first one.
        if (!alert.armedBar) await db.update(priceAlerts).set({ armedBar: s.candles.at(-1)!.time }).where(eq(priceAlerts.id, alert.id));
        continue;
      }
      const [fired] = await db
        .update(priceAlerts)
        .set({ active: false, triggeredAt: new Date(), triggeredPrice: hit.now })
        .where(and(eq(priceAlerts.id, alert.id), eq(priceAlerts.active, true)))
        .returning();
      if (fired && (await notify(fired, row, hit, s.source))) {
        await db.update(priceAlerts).set({ notifiedAt: new Date() }).where(eq(priceAlerts.id, fired.id));
      }
    }
  } finally {
    checking = false;
  }
}

// --------------------------------------------------------------------------- routes

export const priceAlertsApi = new Hono<AppEnv>();

const view = (a: PriceAlert) => ({
  id: a.id,
  symbol: a.symbol,
  tvSymbol: a.tvSymbol,
  label: a.label,
  direction: a.direction,
  price: a.price,
  active: a.active,
  triggeredAt: a.triggeredAt,
  triggeredPrice: a.triggeredPrice,
  notified: Boolean(a.notifiedAt),
  createdAt: a.createdAt,
});

/** Notifications in use: active levels plus signal alerts, against the plan's allowance. */
export async function notificationsInUse(userId: string) {
  const [[levels], [signals]] = await Promise.all([
    db.select({ n: count() }).from(priceAlerts).where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.active, true))),
    db.select({ n: count() }).from(signalAlerts).where(eq(signalAlerts.userId, userId)),
  ]);
  return levels.n + signals.n;
}

/** The user's levels, newest first (`?symbol=` for one asset), and what the plan allows. */
priceAlertsApi.get("/price-alerts", async (c) => {
  const user = c.get("user");
  const symbol = (c.req.query("symbol") ?? "").toUpperCase();
  if (symbol && !SYMBOL_PATTERN.test(symbol)) return c.json({ error: "Simbol tidak valid" }, 400);
  const rows = await db
    .select()
    .from(priceAlerts)
    .where(and(eq(priceAlerts.userId, user.id), symbol ? eq(priceAlerts.symbol, symbol) : undefined))
    .orderBy(desc(priceAlerts.createdAt))
    .limit(100);
  return c.json({
    items: rows.map(view),
    used: await notificationsInUse(user.id),
    max: limitsOf(user).alerts,
    telegram: { bot: telegramBot(), chat: Boolean(user.telegramChatId), configured: telegramBot() && Boolean(user.telegramChatId) },
    mail: mailEnabled() && Boolean(user.email && user.emailVerifiedAt),
  });
});

const levelSchema = z.object({
  symbol: z.string().regex(SYMBOL_PATTERN),
  tvSymbol: z.string().min(1).max(40),
  price: z.number().positive().finite(),
  label: z.string().trim().min(1).max(60).optional(),
});

priceAlertsApi.post("/price-alerts", async (c) => {
  const body = levelSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Isi harga yang valid" }, 400);
  const user = c.get("user");
  const symbol = body.data.symbol.toUpperCase();
  const tvSymbol = body.data.tvSymbol.toUpperCase();
  const venue = storedVenue(venueOfTv(tvSymbol));
  if (venue && !cryptoBase(symbol)) return c.json({ error: "Bursa hanya untuk simbol kripto" }, 400);
  const max = limitsOf(user).alerts;
  if ((await notificationsInUse(user.id)) >= max) return c.json({ error: capMessage(user, max, "notifikasi") }, 409);
  // The direction follows the price now: a level above it waits for a rise, one below for a fall.
  const last = (await liveQuote(symbol, venue))?.candles.at(-1);
  if (!last) return c.json({ error: "Harga aset ini belum bisa dibaca. Coba lagi sebentar lagi." }, 503);
  if (body.data.price === last.close) return c.json({ error: `Harganya memang ${price(last.close)} sekarang. Pilih harga di atas atau di bawahnya.` }, 400);
  const direction: PriceDirection = body.data.price > last.close ? "above" : "below";
  const [same] = await db
    .select()
    .from(priceAlerts)
    .where(
      and(
        eq(priceAlerts.userId, user.id),
        eq(priceAlerts.symbol, symbol),
        eq(priceAlerts.venue, venue),
        eq(priceAlerts.price, body.data.price),
        eq(priceAlerts.active, true),
      ),
    );
  if (same) return c.json(view(same));
  const [row] = await db
    .insert(priceAlerts)
    .values({ userId: user.id, symbol, tvSymbol, label: body.data.label ?? null, venue, direction, price: body.data.price, armedBar: last.time })
    .returning();
  return c.json(view(row), 201);
});

priceAlertsApi.delete("/price-alerts/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  await db.delete(priceAlerts).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, c.get("user").id)));
  return c.json({ ok: true });
});
