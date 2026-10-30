// The watchlist: symbols analysed automatically once a trading day, with the
// results sent to Telegram. Each run is ordinary analyses (same queue, same
// daily cap); this module only decides when, and reports when they are done.
//
// Settings (env): WATCH_TIME (HH:MM WIB, default 16:30), WATCH_DAYS (ISO
// weekdays, default 1-5), WATCH_ANALYSTS, WATCH_DEPTH, WATCH_LANGUAGE,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PUBLIC_URL (for links in the message).
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "./db";
import { analyses, watchlist, watchRuns, type AnalysisRequest } from "./db/schema";
import { enqueue, subscribe } from "./jobs";
import { SYMBOL_PATTERN } from "./market";
import { overLimit, usage } from "./usage";
import { getCatalog } from "./worker";

const WIB_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const MAX_ITEMS = 10;
// A server that starts long after the scheduled time does not catch up with that day's run.
const CATCH_UP_MS = 3 * 3_600_000;

const settings = {
  time: /^\d{1,2}:\d{2}$/.test(process.env.WATCH_TIME ?? "") ? process.env.WATCH_TIME! : "16:30",
  days: parseDays(process.env.WATCH_DAYS ?? "1-5"),
  analysts: (process.env.WATCH_ANALYSTS ?? "market,social,news,fundamentals").split(",").map((a) => a.trim()).filter(Boolean),
  depth: Number(process.env.WATCH_DEPTH ?? 1),
  language: process.env.WATCH_LANGUAGE ?? "Indonesian",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChat: process.env.TELEGRAM_CHAT_ID ?? "",
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

const telegramReady = () => Boolean(settings.telegramToken && settings.telegramChat);

async function sendTelegram(html: string): Promise<{ ok: boolean; error?: string }> {
  if (!telegramReady()) return { ok: false, error: "TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID belum diisi di .env server" };
  try {
    const res = await fetch(`${settings.telegramApi}/bot${settings.telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: settings.telegramChat, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return body.ok ? { ok: true } : { ok: false, error: `Telegram: ${body.description ?? `HTTP ${res.status}`}` };
  } catch (e) {
    return { ok: false, error: `Telegram tidak bisa dihubungi: ${(e as Error).message}` };
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The executive summary of a final decision, cut at a sentence end, without markdown. */
function gist(decision: string | undefined): string {
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

async function report(ids: string[], skipped: string[], title: string): Promise<string> {
  const rows = ids.length ? await db.select().from(analyses).where(inArray(analyses.id, ids)) : [];
  const tv = Object.fromEntries((await db.select().from(watchlist)).map((w) => [w.symbol, w.tvSymbol]));
  const lines = [`<b>📊 ${escape(title)}</b>`, ""];
  for (const r of rows.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    const link = settings.publicUrl
      ? ` · <a href="${settings.publicUrl}/#/?s=${encodeURIComponent(tv[r.ticker] ?? r.ticker)}&amp;run=${r.id}">laporan</a>`
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

/** When every analysis of a run has ended, send one message for the whole run. */
function notifyWhenDone(ids: string[], skipped: string[], title: string, day?: string) {
  const finish = async () => {
    const sent = await sendTelegram(await report(ids, skipped, title));
    if (!sent.ok) console.error(`watchlist ${title}: ${sent.error}`);
    if (day && sent.ok) await db.update(watchRuns).set({ notifiedAt: new Date() }).where(eq(watchRuns.day, day));
  };
  if (!ids.length) return void finish().catch((err) => console.error("watchlist notify failed", err));
  const pending = new Set(ids);
  for (const id of ids) {
    const stop = subscribe(id, (event) => {
      if (event.type !== "end") return;
      stop();
      pending.delete(id);
      if (!pending.size) finish().catch((err) => console.error("watchlist notify failed", err));
    });
  }
}

/** Queue one analysis per watched symbol, as many as today's cap allows. */
async function startRun(day?: string): Promise<{ ids: string[]; skipped: string[] } | { error: string }> {
  const items = await db.select().from(watchlist).orderBy(asc(watchlist.createdAt));
  if (!items.length) return { error: "Watchlist kosong" };
  const catalog = await getCatalog();
  const { provider, quickModel, deepModel } = catalog.defaults;
  const known = new Set(catalog.analysts.map((a) => a.value));
  const analysts = settings.analysts.filter((a) => known.has(a));
  const cap = (await usage()).analyses;
  const room = cap.limit ? Math.max(0, cap.limit - cap.used) : items.length;
  const take = items.slice(0, room);
  const skipped = items.slice(room).map((w) => w.symbol);

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
    const [row] = await db.insert(analyses).values({ ticker: w.symbol, tradeDate: date, request }).returning({ id: analyses.id });
    ids.push(row!.id);
  }
  if (day) await db.update(watchRuns).set({ analysisIds: ids, skipped }).where(eq(watchRuns.day, day));
  const title = `Watchlist ${new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric" })}`;
  // Subscribe before the queue can start them, so no ending is missed.
  notifyWhenDone(ids, skipped, title, day);
  for (const id of ids) enqueue(id);
  return { ids, skipped };
}

async function tick() {
  const now = Date.now();
  if (!settings.days.has(isoWeekday(wib(now)))) return;
  const due = dueOn(now);
  if (now < due || now > due + CATCH_UP_MS) return;
  if (!(await db.$count(watchlist))) return;
  // Claim the day: on a second server instance this insert finds the row and does nothing.
  const day = wibDay(now);
  const [claimed] = await db.insert(watchRuns).values({ day }).onConflictDoNothing().returning({ day: watchRuns.day });
  if (!claimed) return;
  const result = await startRun(day);
  if ("error" in result) console.error(`watchlist ${day}: ${result.error}`);
  else console.log(`watchlist ${day}: ${result.ids.length} analisa, ${result.skipped.length} dilewati`);
}

export function startWatchScheduler() {
  const run = () => tick().catch((err) => console.error("watchlist tick failed", err));
  run();
  setInterval(run, 60_000);
}

export const watchApi = new Hono();

watchApi.get("/watchlist", async (c) => {
  const items = await db.select().from(watchlist).orderBy(asc(watchlist.createdAt));
  const recent = items.length
    ? await db
        .select({ id: analyses.id, ticker: analyses.ticker, rating: analyses.rating, status: analyses.status, tradeDate: analyses.tradeDate, createdAt: analyses.createdAt })
        .from(analyses)
        .where(inArray(analyses.ticker, items.map((w) => w.symbol)))
        .orderBy(desc(analyses.createdAt))
    : [];
  const [lastRun] = await db.select().from(watchRuns).orderBy(desc(watchRuns.day)).limit(1);
  return c.json({
    items: items.map((w) => ({ symbol: w.symbol, tvSymbol: w.tvSymbol, last: recent.find((a) => a.ticker === w.symbol) ?? null })),
    max: MAX_ITEMS,
    schedule: { time: settings.time, days: [...settings.days], next: nextRun(), analysts: settings.analysts, depth: settings.depth },
    telegram: { configured: telegramReady(), links: Boolean(settings.publicUrl) },
    lastRun: lastRun ?? null,
  });
});

const addSchema = z.object({ symbol: z.string().regex(SYMBOL_PATTERN), tvSymbol: z.string().min(1).max(40) });

watchApi.post("/watchlist", async (c) => {
  const body = addSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Simbol tidak valid" }, 400);
  if ((await db.$count(watchlist)) >= MAX_ITEMS) return c.json({ error: `Watchlist maksimal ${MAX_ITEMS} simbol` }, 400);
  await db
    .insert(watchlist)
    .values({ symbol: body.data.symbol.toUpperCase(), tvSymbol: body.data.tvSymbol.toUpperCase() })
    .onConflictDoNothing();
  return c.json({ ok: true }, 201);
});

watchApi.delete("/watchlist/:symbol", async (c) => {
  await db.delete(watchlist).where(eq(watchlist.symbol, c.req.param("symbol").toUpperCase()));
  return c.json({ ok: true });
});

/** Run the whole watchlist now, outside the schedule; it counts against the daily cap like any analysis. */
watchApi.post("/watchlist/run", async (c) => {
  if (await db.$count(watchlist)) {
    const quota = await overLimit("analyses", 1);
    if (quota) return c.json({ error: quota }, 429);
  }
  const result = await startRun();
  return "error" in result ? c.json(result, 400) : c.json(result, 201);
});

watchApi.post("/watchlist/test", async (c) => {
  const sent = await sendTelegram("<b>✅ TradingAgents</b>\nNotifikasi watchlist tersambung ke chat ini.");
  return sent.ok ? c.json({ ok: true }) : c.json({ error: sent.error }, 400);
});
