// The watchlist: symbols each user has analysed automatically once a trading
// day, with the results sent to that user's Telegram chat. Each run is
// ordinary analyses (same queue, same daily caps); this module only decides
// when, and reports when they are done.
//
// Settings (env): WATCH_TIME (HH:MM WIB, default 16:30), WATCH_DAYS (ISO
// weekdays, default 1-5), WATCH_ANALYSTS, WATCH_DEPTH, WATCH_LANGUAGE,
// TELEGRAM_BOT_TOKEN (one bot for everyone), PUBLIC_URL (links in the message).
// Each user sets their own Telegram chat id in their profile.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { track } from "./activity";
import type { AppEnv, User } from "./auth";
import { db } from "./db";
import { analyses, users, watchlist, watchRuns, type AnalysisRequest } from "./db/schema";
import { recordError } from "./errors";
import { enqueue, subscribe, TERMINAL } from "./jobs";
import { leaderOnly } from "./locks";
import { log } from "./log";
import { SYMBOL_PATTERN } from "./market";
import { capMessage, limitsOf, needsVerification } from "./plans";
import { readShared, writeShared } from "./shared";
import { overLimit, room } from "./usage";
import { getCatalog } from "./worker";

const WIB_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
// A server that starts long after the scheduled time does not catch up with that day's run.
const CATCH_UP_MS = 3 * 3_600_000;

const settings = {
  time: /^\d{1,2}:\d{2}$/.test(process.env.WATCH_TIME ?? "") ? process.env.WATCH_TIME! : "16:30",
  days: parseDays(process.env.WATCH_DAYS ?? "1-5"),
  analysts: (process.env.WATCH_ANALYSTS ?? "market,social,news,fundamentals").split(",").map((a) => a.trim()).filter(Boolean),
  depth: Number(process.env.WATCH_DEPTH ?? 1),
  language: process.env.WATCH_LANGUAGE ?? "Indonesian",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  // Only for tests: point at a local stand-in instead of Telegram.
  telegramApi: (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, ""),
  publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
};

/** "1-5" or "1,3,5" (ISO weekdays, Monday = 1) to a set. */
function parseDays(spec: string): Set<number> {
  const days = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((n) => Number(n.trim()));
    if (!a) continue;
    for (let d = a; d <= (b || a); d++) if (d >= 1 && d <= 7) days.add(d);
  }
  return days.size ? days : new Set([1, 2, 3, 4, 5]);
}

/** Wall-clock time in Jakarta, as a Date whose UTC fields read as WIB. */
const wib = (ms = Date.now()) => new Date(ms + WIB_MS);
const wibDay = (ms = Date.now()) => wib(ms).toISOString().slice(0, 10);
const isoWeekday = (d: Date) => d.getUTCDay() || 7;

/** When the run is due on the WIB day that `ms` falls on. */
function dueOn(ms: number): number {
  const d = wib(ms);
  const [h, m] = settings.time.split(":").map(Number);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - WIB_MS;
}

/** The next scheduled run, as an ISO instant. */
function nextRun(after = Date.now()): string {
  for (let i = 0; i < 8; i++) {
    const at = dueOn(after + i * DAY_MS);
    if (at > after && settings.days.has(isoWeekday(wib(at)))) return new Date(at).toISOString();
  }
  return new Date(after).toISOString();
}

/** Whether the server has a bot, and the app's public address for links (signal alerts use both too). */
export const telegramBot = () => Boolean(settings.telegramToken);
export const publicUrl = () => settings.publicUrl;

/** The last message the bot tried to send, from any instance, for the status page (status.ts). */
const markSend = (ok: boolean) => writeShared("telegram:last", { at: Date.now(), ok }).catch((err) => log.warn("telegram_mark_failed", { error: err }));
export const telegramHealth = async () => ({ configured: telegramBot(), last: await readShared<{ at: number; ok: boolean }>("telegram:last") });

export async function sendTelegram(chatId: string | null, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!settings.telegramToken) return { ok: false, error: "Bot Telegram belum diatur di server ini. Hubungi admin." };
  if (!chatId) return { ok: false, error: "Chat ID Telegram belum diisi di Profil" };
  try {
    const res = await fetch(`${settings.telegramApi}/bot${settings.telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    // A refusal for one chat (blocked bot, wrong ID) says nothing about the service; a server error does.
    await markSend(Boolean(body.ok) || res.status < 500);
    return body.ok ? { ok: true } : { ok: false, error: `Telegram: ${body.description ?? `HTTP ${res.status}`}` };
  } catch (e) {
    await markSend(false);
    return { ok: false, error: `Telegram tidak bisa dihubungi: ${(e as Error).message}` };
  }
}

export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The executive summary of a final decision, cut at a sentence end, without markdown. */
export function gist(decision: string | undefined): string {
  if (!decision) return "";
  const summary =
    decision.match(/\*\*Executive Summary\*\*:?\s*([^\n]+)/i)?.[1] ??
    decision.split("\n").find((l) => l.trim() && !/rating/i.test(l)) ??
    "";
  const plain = summary.replace(/[*_`#>]/g, "").trim();
  if (plain.length <= 240) return plain;
  const cut = plain.slice(0, 240);
  const end = cut.lastIndexOf(". ");
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

async function report(userId: string, ids: string[], skipped: string[], title: string): Promise<string> {
  const rows = ids.length ? await db.select().from(analyses).where(inArray(analyses.id, ids)) : [];
  const tv = Object.fromEntries(
    (await db.select().from(watchlist).where(eq(watchlist.userId, userId))).map((w) => [w.symbol, w.tvSymbol]),
  );
  const lines = [`<b>📊 ${escape(title)}</b>`, ""];
  for (const r of rows.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    const link = settings.publicUrl
      ? ` · <a href="${settings.publicUrl}/app#/?s=${encodeURIComponent(tv[r.ticker] ?? r.ticker)}&amp;run=${r.id}">laporan</a>`
      : "";
    if (r.status === "completed") {
      lines.push(`<b>${escape(r.ticker)}</b> · ${escape(r.rating ?? "tanpa rating")}${link}`);
      const g = gist(r.reports?.final_trade_decision);
      if (g) lines.push(escape(g));
    } else {
      lines.push(`<b>${escape(r.ticker)}</b> · gagal: ${escape((r.error ?? r.status).split("\n")[0].slice(0, 160))}${link}`);
    }
    lines.push("");
  }
  if (skipped.length) lines.push(`Dilewati, kuota analisa harian habis: ${escape(skipped.join(", "))}`, "");
  lines.push("<i>Riset otomatis TradingAgents, bukan saran investasi.</i>");
  return lines.join("\n");
}

/**
 * When every analysis of a run has ended, send one message for the whole run to the user's chat.
 * Resolves once listening; the analyses may run in another process (jobs.ts).
 */
async function notifyWhenDone(userId: string, ids: string[], skipped: string[], title: string, runId?: string) {
  const finish = async () => {
    // Read the chat id now, not when the run started: the user may have just set it.
    const [user] = await db.select({ chat: users.telegramChatId }).from(users).where(eq(users.id, userId));
    const sent = await sendTelegram(user?.chat ?? null, await report(userId, ids, skipped, title));
    if (!sent.ok) log.warn("watchlist_not_sent", { title, user: userId, error: sent.error });
    if (runId && sent.ok) await db.update(watchRuns).set({ notifiedAt: new Date() }).where(eq(watchRuns.id, runId));
  };
  if (!ids.length) return void finish().catch((err) => recordError("watchlist", err));
  const pending = new Set(ids);
  const stops = new Map<string, () => void>();
  const ended = (id: string) => {
    stops.get(id)?.();
    stops.delete(id);
    if (!pending.delete(id)) return;
    if (!pending.size) finish().catch((err) => recordError("watchlist", err));
  };
  for (const id of ids) {
    const stop = await subscribe(id, (event) => {
      if (event.type === "end") ended(id);
    });
    if (pending.has(id)) stops.set(id, stop);
    else stop();
  }
  // One a runner finished before its subscription counts as ended too.
  const finished = await db.select({ id: analyses.id }).from(analyses).where(and(inArray(analyses.id, ids), inArray(analyses.status, TERMINAL)));
  for (const { id } of finished) ended(id);
}

/** Queue one analysis per symbol on this user's watchlist, as many as today's caps allow. */
async function startRun(user: User, runId?: string): Promise<{ ids: string[]; skipped: string[] } | { error: string }> {
  if (needsVerification(user)) return { error: "Verifikasi email kamu dulu untuk menjalankan analisa harian" };
  // As many symbols as the plan holds, oldest first: a lapsed plan pauses the rest.
  const items = (await db.select().from(watchlist).where(eq(watchlist.userId, user.id)).orderBy(asc(watchlist.createdAt))).slice(0, limitsOf(user).watchlist);
  if (!items.length) return { error: "Belum ada simbol untuk analisa harian" };
  const catalog = await getCatalog();
  const { provider, quickModel, deepModel } = catalog.defaults;
  const known = new Set(catalog.analysts.map((a) => a.value));
  const analysts = settings.analysts.filter((a) => known.has(a));
  const fits = Math.min(items.length, await room(user, "analyses"));
  const take = items.slice(0, fits);
  const skipped = items.slice(fits).map((w) => w.symbol);

  const date = wibDay();
  const ids: string[] = [];
  for (const w of take) {
    const request: AnalysisRequest = {
      ticker: w.symbol,
      date,
      analysts: analysts.length ? analysts : ["market"],
      depth: [1, 3, 5].includes(settings.depth) ? settings.depth : 1,
      provider,
      quickModel,
      deepModel,
      language: settings.language,
    };
    const [row] = await db
      .insert(analyses)
      .values({ userId: user.id, ticker: w.symbol, tradeDate: date, request })
      .returning({ id: analyses.id });
    ids.push(row!.id);
  }
  if (runId) await db.update(watchRuns).set({ analysisIds: ids, skipped }).where(eq(watchRuns.id, runId));
  const title = `Analisa harian ${new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" })}`;
  // Subscribe before the queue can start them, so no ending is missed.
  await notifyWhenDone(user.id, ids, skipped, title, runId);
  for (const id of ids) enqueue(id);
  return { ids, skipped };
}

async function tick() {
  const now = Date.now();
  if (!settings.days.has(isoWeekday(wib(now)))) return;
  const due = dueOn(now);
  if (now < due || now > due + CATCH_UP_MS) return;
  const day = wibDay(now);
  // Everyone with something on their watchlist and an active account.
  const owners = await db
    .selectDistinct({ user: users })
    .from(watchlist)
    .innerJoin(users, eq(watchlist.userId, users.id))
    .where(eq(users.disabled, false));
  for (const { user } of owners) {
    // Claim the day for this user: on a second server instance this insert finds the row and does nothing.
    const [claimed] = await db.insert(watchRuns).values({ userId: user.id, day }).onConflictDoNothing().returning({ id: watchRuns.id });
    if (!claimed) continue;
    const result = await startRun(user, claimed.id);
    if ("error" in result) log.warn("watchlist_run_failed", { day, user: user.username, error: result.error });
    else log.info("watchlist_run", { day, user: user.username, queued: result.ids.length, skipped: result.skipped.length });
  }
}

export function startWatchScheduler() {
  const run = leaderOnly(() => tick().catch((err) => recordError("watchlist", err)));
  run();
  setInterval(run, 60_000);
}

export const watchApi = new Hono<AppEnv>();

watchApi.get("/watchlist", async (c) => {
  const user = c.get("user");
  const items = await db.select().from(watchlist).where(eq(watchlist.userId, user.id)).orderBy(asc(watchlist.createdAt));
  const recent = items.length
    ? await db
        .select({ id: analyses.id, ticker: analyses.ticker, rating: analyses.rating, status: analyses.status, tradeDate: analyses.tradeDate, createdAt: analyses.createdAt })
        .from(analyses)
        .where(and(eq(analyses.userId, user.id), inArray(analyses.ticker, items.map((w) => w.symbol))))
        .orderBy(desc(analyses.createdAt))
    : [];
  const [lastRun] = await db.select().from(watchRuns).where(eq(watchRuns.userId, user.id)).orderBy(desc(watchRuns.day)).limit(1);
  return c.json({
    items: items.map((w) => ({ symbol: w.symbol, tvSymbol: w.tvSymbol, last: recent.find((a) => a.ticker === w.symbol) ?? null })),
    max: limitsOf(user).watchlist,
    schedule: { time: settings.time, days: [...settings.days], next: nextRun(), analysts: settings.analysts, depth: settings.depth },
    telegram: {
      bot: Boolean(settings.telegramToken),
      chat: Boolean(user.telegramChatId),
      configured: Boolean(settings.telegramToken && user.telegramChatId),
      links: Boolean(settings.publicUrl),
    },
    lastRun: lastRun ?? null,
  });
});

const addSchema = z.object({ symbol: z.string().regex(SYMBOL_PATTERN), tvSymbol: z.string().min(1).max(40) });

watchApi.post("/watchlist", async (c) => {
  const body = addSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Simbol tidak valid" }, 400);
  const user = c.get("user");
  const max = limitsOf(user).watchlist;
  if ((await db.$count(watchlist, eq(watchlist.userId, user.id))) >= max) {
    return c.json({ error: capMessage(user, max, "simbol untuk analisa harian") }, 400);
  }
  await db
    .insert(watchlist)
    .values({ userId: user.id, symbol: body.data.symbol.toUpperCase(), tvSymbol: body.data.tvSymbol.toUpperCase() })
    .onConflictDoNothing();
  await track(user, "watch", body.data.tvSymbol.toUpperCase());
  return c.json({ ok: true }, 201);
});

watchApi.delete("/watchlist/:symbol", async (c) => {
  await db.delete(watchlist).where(and(eq(watchlist.userId, c.get("user").id), eq(watchlist.symbol, c.req.param("symbol").toUpperCase())));
  return c.json({ ok: true });
});

/** Run the user's whole watchlist now, outside the schedule; it counts against the daily caps like any analysis. */
watchApi.post("/watchlist/run", async (c) => {
  const user = c.get("user");
  if (await db.$count(watchlist, eq(watchlist.userId, user.id))) {
    const quota = await overLimit(user, "analyses", 1);
    if (quota) return c.json({ error: quota }, 429);
  }
  const result = await startRun(user);
  return "error" in result ? c.json(result, 400) : c.json(result, 201);
});

watchApi.post("/watchlist/test", async (c) => {
  const user = c.get("user");
  const sent = await sendTelegram(user.telegramChatId, `<b>✅ TradingAgents</b>\nNotifikasi analisa harian untuk ${escape(user.username)} tersambung ke chat ini.`);
  return sent.ok ? c.json({ ok: true }) : c.json({ error: sent.error }, 400);
});
