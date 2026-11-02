// The trade journal: trades a member says they took (from the chart's plan card or by hand), each
// with its plan (entry, stop, target), how they felt and a note, so they can see later what worked
// and in which state of mind. The minute price check (alerts.ts, after the price levels) settles an
// open trade when a 15m bar opened after the one it was recorded on reaches its target or its stop,
// on the candles the levels read (price-alerts.ts); a bar that reaches both counts as the stop, the
// order inside a bar being unknown. Results are in R (risk = entry to stop), so trades of any size
// compare. Settling is one conditional update, so two server instances never settle or message twice.
//
// From Sunday 19.00 WIB, a member with a linked Telegram who used the journal that week gets a recap
// of it, claimed in the notices table first so it goes once per week.
import { and, asc, count, desc, eq, gte, isNotNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { track } from "./activity";
import type { AppEnv } from "./auth";
import { db } from "./db";
import { journalTrades, notices, users, type JournalMood } from "./db/schema";
import { recordError } from "./errors";
import { leaderOnly } from "./locks";
import { log } from "./log";
import { SYMBOL_PATTERN, type Candle } from "./market";
import { capMessage, limitsOf } from "./plans";
import { quotes, type Quote } from "./price-alerts";
import { cryptoBase, storedVenue, venueOfTv } from "./venues";
import { escape, publicUrl, sendTelegram, telegramBot } from "./watch";

type Trade = typeof journalTrades.$inferSelect;

export const MOODS = ["calm", "confident", "unsure", "fomo", "fear", "revenge"] as const satisfies readonly JournalMood[];
const MOOD_NAMES: Record<JournalMood, string> = { calm: "Tenang", confident: "Yakin", unsure: "Ragu", fomo: "FOMO", fear: "Takut", revenge: "Balas dendam" };
/** The same inside a sentence ("trade saat ragu"). */
const MOOD_WORDS: Record<JournalMood, string> = { calm: "tenang", confident: "yakin", unsure: "ragu", fomo: "FOMO", fear: "takut", revenge: "ingin balas dendam" };

let send: typeof sendTelegram = sendTelegram;
/** Send the journal's messages elsewhere (the test suite's list); without an argument, back to Telegram. */
export function useJournalSender(sender: typeof sendTelegram = sendTelegram) {
  send = sender;
}

const price = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 0.01 ? 5 : 8 });
const signedR = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}R`;
const sideName = (t: Pick<Trade, "side">) => (t.side === "BUY" ? "Beli" : "Jual");

/** A result in R: how far the exit went in the trade's favour, over the distance from entry to stop. */
export function resultR(t: Pick<Trade, "side" | "entry" | "stopLoss">, exit: number): number {
  return (t.side === "BUY" ? exit - t.entry : t.entry - exit) / Math.abs(t.entry - t.stopLoss);
}

/**
 * Whether an open trade's stop or target was reached: by the high or low of a bar opened after the
 * one it was recorded on, or by the newest price. A bar that reaches both counts as the stop, since
 * which came first inside it is unknown. A trade not armed yet is never settled.
 */
export function settles(t: Pick<Trade, "side" | "stopLoss" | "takeProfit" | "armedBar">, candles: Candle[]): { status: "win" | "loss"; price: number } | null {
  const armed = t.armedBar;
  if (!armed) return null;
  const buy = t.side === "BUY";
  const stopped = (low: number, high: number) => (buy ? low <= t.stopLoss : high >= t.stopLoss);
  const reached = (low: number, high: number) => (buy ? high >= t.takeProfit : low <= t.takeProfit);
  for (const c of candles) {
    if (c.time <= armed) continue;
    if (stopped(c.low, c.high)) return { status: "loss", price: t.stopLoss };
    if (reached(c.low, c.high)) return { status: "win", price: t.takeProfit };
  }
  const last = candles.at(-1);
  if (last && stopped(last.close, last.close)) return { status: "loss", price: t.stopLoss };
  if (last && reached(last.close, last.close)) return { status: "win", price: t.takeProfit };
  return null;
}

/** The link that opens the journal in the app, when the server knows its address. */
const journalLink = () => (publicUrl() ? `<a href="${publicUrl()}/app#/?dock=journal">Buka jurnal</a>` : "");

/** The message for a trade the price check settled. */
function settledText(t: Trade): string {
  const money = t.riskIdr ? ` (≈ ${t.r! >= 0 ? "+" : "−"}Rp ${Math.round(Math.abs(t.r! * t.riskIdr)).toLocaleString("id-ID")})` : "";
  return [
    `<b>📒 Jurnal: ${escape(`${t.tvSymbol} ${sideName(t)} kena ${t.status === "win" ? "TP" : "SL"} di ${price(t.exitPrice!)}`)}</b>`,
    escape(`Hasil ${signedR(t.r!)}${money}. Entry ${price(t.entry)}, SL ${price(t.stopLoss)}, TP ${price(t.takeProfit)}.`),
    journalLink(),
    "<i>Dicek dari candle 15 menit; harga eksekusi di broker bisa berbeda. Catatan pribadi, bukan saran investasi.</i>",
  ]
    .filter(Boolean)
    .join("\n");
}

let settling = false;

/** Settle every open trade whose stop or target the price reached. `quote` reads the prices; a test passes its own. */
export async function settleJournal(quote: Quote = quotes) {
  if (settling) return;
  settling = true;
  try {
    const rows = await db
      .select({ trade: journalTrades, chat: users.telegramChatId })
      .from(journalTrades)
      .innerJoin(users, eq(journalTrades.userId, users.id))
      .where(and(eq(journalTrades.status, "open"), eq(users.disabled, false)))
      .orderBy(asc(journalTrades.openedAt));
    if (!rows.length) return;
    // One price read per symbol and venue.
    const keys = [...new Set(rows.map(({ trade }) => `${trade.symbol}|${trade.venue}`))];
    const series = new Map(await Promise.all(keys.map(async (k) => [k, await quote(...(k.split("|") as [string, string]))] as const)));
    for (const { trade, chat } of rows) {
      const candles = series.get(`${trade.symbol}|${trade.venue}`)?.candles;
      if (!candles?.length) continue;
      // A trade recorded while no price could be read is armed on the first one.
      if (!trade.armedBar) {
        await db
          .update(journalTrades)
          .set({ armedBar: candles.at(-1)!.time })
          .where(and(eq(journalTrades.id, trade.id), eq(journalTrades.status, "open")));
        continue;
      }
      const hit = settles(trade, candles);
      if (!hit) continue;
      const [done] = await db
        .update(journalTrades)
        .set({ status: hit.status, exitPrice: hit.price, r: resultR(trade, hit.price), closedAt: new Date() })
        .where(and(eq(journalTrades.id, trade.id), eq(journalTrades.status, "open")))
        .returning();
      if (!done || !chat) continue;
      const sent = await send(chat, settledText(done));
      if (sent.ok) await db.update(journalTrades).set({ notifiedAt: new Date() }).where(eq(journalTrades.id, done.id));
      else log.warn("journal_settle_not_sent", { error: sent.error });
    }
  } finally {
    settling = false;
  }
}

// --------------------------------------------------------------------------- summary

type Group = { key: string; n: number; wins: number; totalR: number };

/** Closed trades in brief: how many, how many paid, the total and mean R, by mood and by source. */
export function summarize(rows: Trade[]) {
  const done = rows.filter((t) => t.r != null && t.status !== "cancelled");
  const group = (keyOf: (t: Trade) => string): Group[] => {
    const groups = new Map<string, Trade[]>();
    for (const t of done) groups.set(keyOf(t), [...(groups.get(keyOf(t)) ?? []), t]);
    return [...groups.entries()]
      .map(([key, list]) => ({ key, n: list.length, wins: list.filter((t) => t.r! > 0).length, totalR: list.reduce((a, t) => a + t.r!, 0) }))
      .sort((a, b) => b.n - a.n || b.totalR - a.totalR);
  };
  const wins = done.filter((t) => t.r! > 0).length;
  const totalR = done.reduce((a, t) => a + t.r!, 0);
  return {
    closed: done.length,
    wins,
    winRate: done.length ? wins / done.length : null,
    totalR,
    avgR: done.length ? totalR / done.length : null,
    /** "" for trades recorded without a mood. */
    byMood: group((t) => t.mood ?? ""),
    bySource: group((t) => t.label ?? t.source),
  };
}

// --------------------------------------------------------------------------- routes

export const journalApi = new Hono<AppEnv>();

const view = (t: Trade) => ({
  id: t.id,
  symbol: t.symbol,
  tvSymbol: t.tvSymbol,
  side: t.side,
  entry: t.entry,
  stopLoss: t.stopLoss,
  takeProfit: t.takeProfit,
  source: t.source,
  label: t.label,
  mood: t.mood,
  note: t.note,
  riskIdr: t.riskIdr,
  status: t.status,
  exitPrice: t.exitPrice,
  r: t.r,
  openedAt: t.openedAt,
  closedAt: t.closedAt,
  notified: Boolean(t.notifiedAt),
});

/** The member's journal: every open trade, the trades opened or closed in the last `days` days, and the summary of those closed. */
journalApi.get("/journal", async (c) => {
  const user = c.get("user");
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select()
    .from(journalTrades)
    .where(and(eq(journalTrades.userId, user.id), or(eq(journalTrades.status, "open"), gte(journalTrades.openedAt, since), gte(journalTrades.closedAt, since))))
    .orderBy(desc(journalTrades.openedAt))
    .limit(500);
  return c.json({
    days,
    items: rows.map(view),
    summary: summarize(rows.filter((t) => t.closedAt && t.closedAt >= since)),
    open: rows.filter((t) => t.status === "open").length,
    max: limitsOf(user).journal,
    telegram: { bot: telegramBot(), chat: Boolean(user.telegramChatId) },
  });
});

export const journalSchema = z
  .object({
    symbol: z.string().regex(SYMBOL_PATTERN),
    tvSymbol: z.string().min(1).max(40),
    side: z.enum(["BUY", "SELL"]),
    entry: z.number().positive().finite(),
    stopLoss: z.number().positive().finite(),
    takeProfit: z.number().positive().finite(),
    /** scalper, pob, fib, a script or catalog key, or manual. */
    source: z.string().trim().min(1).max(60).default("manual"),
    label: z.string().trim().min(1).max(80).optional(),
    mood: z.enum(MOODS).optional(),
    note: z.string().trim().max(500).optional(),
    riskIdr: z.number().positive().finite().max(1e12).optional(),
  })
  .refine((t) => (t.side === "BUY" ? t.stopLoss < t.entry && t.entry < t.takeProfit : t.takeProfit < t.entry && t.entry < t.stopLoss), {
    message: "Untuk Beli, SL di bawah entry dan TP di atasnya; untuk Jual sebaliknya.",
  });

journalApi.post("/journal", async (c) => {
  const body = journalSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    const levels = body.error.issues.find((i) => i.code === "custom");
    return c.json({ error: levels?.message ?? "Isi entry, SL, dan TP yang valid" }, 400);
  }
  const user = c.get("user");
  const t = body.data;
  const symbol = t.symbol.toUpperCase();
  const tvSymbol = t.tvSymbol.toUpperCase();
  const venue = storedVenue(venueOfTv(tvSymbol));
  if (venue && !cryptoBase(symbol)) return c.json({ error: "Bursa hanya untuk simbol kripto" }, 400);
  const max = limitsOf(user).journal;
  const [{ n }] = await db
    .select({ n: count() })
    .from(journalTrades)
    .where(and(eq(journalTrades.userId, user.id), eq(journalTrades.status, "open")));
  if (n >= max) return c.json({ error: capMessage(user, max, "trade terbuka di jurnal") }, 409);
  // Armed on the newest bar, so a move from before the trade was taken never settles it. A trade the
  // price has already carried past its stop or target is not a running one.
  const last = (await quotes(symbol, venue))?.candles.at(-1);
  if (last) {
    const buy = t.side === "BUY";
    if (buy ? last.close <= t.stopLoss : last.close >= t.stopLoss) return c.json({ error: `Harga sekarang ${price(last.close)} sudah melewati SL.` }, 400);
    if (buy ? last.close >= t.takeProfit : last.close <= t.takeProfit) return c.json({ error: `Harga sekarang ${price(last.close)} sudah melewati TP.` }, 400);
  }
  const [row] = await db
    .insert(journalTrades)
    .values({
      userId: user.id,
      symbol,
      tvSymbol,
      venue,
      side: t.side,
      entry: t.entry,
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      source: t.source,
      label: t.label ?? null,
      mood: t.mood ?? null,
      note: t.note || null,
      riskIdr: t.riskIdr ?? null,
      armedBar: last?.time ?? null,
    })
    .returning();
  await track(user, "journal", tvSymbol, { side: t.side, source: t.source });
  return c.json(view(row), 201);
});

const updateSchema = z.object({
  mood: z.enum(MOODS).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Closed by its owner at this price (sold, or bought back). */
  close: z.object({ price: z.number().positive().finite() }).optional(),
  /** Never taken after all: kept out of the results. */
  cancel: z.literal(true).optional(),
});

journalApi.patch("/journal/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Isian tidak valid" }, 400);
  const user = c.get("user");
  const [trade] = await db
    .select()
    .from(journalTrades)
    .where(and(eq(journalTrades.id, id), eq(journalTrades.userId, user.id)));
  if (!trade) return c.json({ error: "Trade tidak ditemukan" }, 404);
  const { mood, note, close, cancel } = body.data;
  const set: Partial<typeof journalTrades.$inferInsert> = {};
  if (mood !== undefined) set.mood = mood;
  if (note !== undefined) set.note = note || null;
  const closing = Boolean(close || cancel);
  if (closing) {
    if (trade.status !== "open") return c.json({ error: "Trade ini sudah selesai" }, 409);
    set.closedAt = new Date();
    if (cancel) set.status = "cancelled";
    else {
      set.status = "closed";
      set.exitPrice = close!.price;
      set.r = resultR(trade, close!.price);
    }
  }
  if (!Object.keys(set).length) return c.json(view(trade));
  // Closing races the price check: only a trade still open closes, and only once.
  const [row] = await db
    .update(journalTrades)
    .set(set)
    .where(and(eq(journalTrades.id, id), eq(journalTrades.userId, user.id), closing ? eq(journalTrades.status, "open") : undefined))
    .returning();
  if (!row) return c.json({ error: "Trade ini baru saja selesai di TP atau SL" }, 409);
  return c.json(view(row));
});

journalApi.delete("/journal/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  await db.delete(journalTrades).where(and(eq(journalTrades.id, id), eq(journalTrades.userId, c.get("user").id)));
  return c.json({ ok: true });
});

// --------------------------------------------------------------------------- weekly recap

const WIB_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
/** Sunday from 19.00 WIB: the week is over for most markets, and the next one not begun. */
const RECAP_MINUTE = 19 * 60;

/** The ISO week a WIB wall-clock date (read through its UTC fields) falls in, as "2026-W45". */
function isoWeek(wib: Date): string {
  const day = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  return `${year}-W${String(Math.ceil(((+day - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7)).padStart(2, "0")}`;
}

/** One member's week in a message: trades closed since `from`, the best and worst, by mood, and what is still open. */
export function recapText(closed: Trade[], open: number, from: Date, to: Date): string {
  const s = summarize(closed);
  const day = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" });
  const lines = ["<b>📒 Rekap jurnal pekan ini</b>", escape(`${day(from)} – ${day(to)}`)];
  if (!s.closed) lines.push("Belum ada trade yang selesai pekan ini.");
  else {
    lines.push(escape(`Selesai: ${s.closed} trade · untung ${s.wins} (${Math.round((s.winRate ?? 0) * 100)}%) · total ${signedR(s.totalR)}`));
    const ranked = closed.filter((t) => t.r != null && t.status !== "cancelled").sort((a, b) => b.r! - a.r!);
    const name = (t: Trade) => `${t.tvSymbol} ${sideName(t)} ${signedR(t.r!)}`;
    if (ranked.length > 1) lines.push(escape(`Terbaik: ${name(ranked[0])} · terburuk: ${name(ranked.at(-1)!)}`));
    const moods = s.byMood.filter((g) => g.key);
    if (moods.length) lines.push(escape(`Per perasaan: ${moods.map((g) => `${MOOD_NAMES[g.key as JournalMood]} ${signedR(g.totalR)} (${g.n})`).join(" · ")}`));
    // The mood that cost the most per trade, once it has happened more than once.
    const costly = moods.filter((g) => g.n >= 2 && g.totalR < 0).sort((a, b) => a.totalR / a.n - b.totalR / b.n)[0];
    if (costly) {
      lines.push(
        escape(`Trade saat ${MOOD_WORDS[costly.key as JournalMood]} rata-rata ${signedR(costly.totalR / costly.n)}. Pekan depan, coba tunggu setup yang sudah direncanakan.`),
      );
    }
  }
  if (open) lines.push(escape(`Masih terbuka: ${open}`));
  const link = journalLink();
  if (link) lines.push(link);
  lines.push("<i>Catatan pribadimu, bukan saran investasi.</i>");
  return lines.join("\n");
}

/**
 * From Sunday 19.00 WIB, each member's recap of the week since Monday 00.00 WIB, once: those with a
 * linked Telegram who opened or closed a trade that week (a trade still open from before counts in
 * the recap, but alone sends none).
 */
export async function sendJournalRecaps(now = new Date()) {
  const wib = new Date(+now + WIB_MS);
  if (wib.getUTCDay() !== 0 || wib.getUTCHours() * 60 + wib.getUTCMinutes() < RECAP_MINUTE) return;
  const from = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - 6) - WIB_MS);
  const period = isoWeek(wib);
  const rows = await db
    .select({ trade: journalTrades, chat: users.telegramChatId })
    .from(journalTrades)
    .innerJoin(users, eq(journalTrades.userId, users.id))
    .where(
      and(
        eq(users.disabled, false),
        isNotNull(users.telegramChatId),
        or(eq(journalTrades.status, "open"), gte(journalTrades.openedAt, from), gte(journalTrades.closedAt, from)),
      ),
    );
  const byUser = new Map<string, { chat: string; trades: Trade[] }>();
  for (const { trade, chat } of rows) {
    const entry = byUser.get(trade.userId) ?? { chat: chat!, trades: [] };
    entry.trades.push(trade);
    byUser.set(trade.userId, entry);
  }
  for (const [userId, { chat, trades }] of byUser) {
    if (!trades.some((t) => t.openedAt >= from || (t.closedAt && t.closedAt >= from))) continue;
    const [claimed] = await db.insert(notices).values({ userId, key: `journal-recap:${period}` }).onConflictDoNothing().returning({ id: notices.id });
    if (!claimed) continue;
    const closed = trades.filter((t) => t.closedAt && t.closedAt >= from);
    const sent = await send(chat, recapText(closed, trades.filter((t) => t.status === "open").length, from, now));
    if (!sent.ok) log.warn("journal_recap_not_sent", { period, error: sent.error });
  }
}

/** Looks for the weekly recap every ten minutes, on the scheduler leader only. */
export function startJournalRecaps() {
  setInterval(leaderOnly(() => sendJournalRecaps().catch((err) => recordError("journal", err))), 10 * 60_000);
}
