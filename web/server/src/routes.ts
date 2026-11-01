import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { isAdmin, type AppEnv } from "./auth";
import { backendUrlRefused } from "./config";
import { db } from "./db";
import { analyses, analysisEvents, users, type JobKind } from "./db/schema";
import { cancel, enqueue, subscribe, TERMINAL, type LiveEvent } from "./jobs";
import { getCandles, INTERVALS, RANGES, SYMBOL_PATTERN, type Interval } from "./market";
import { catalogFor, modelsFor } from "./models";
import { briefFor } from "./site";
import { overLimit, room, usage } from "./usage";
import { isVenue } from "./venues";
import { gist } from "./watch";
import { getCatalog, type Catalog } from "./worker";

// Every backtest cell is one full analysis (many LLM calls), so a sweep is capped.
const MAX_BACKTEST_CELLS = Number(process.env.MAX_BACKTEST_CELLS ?? 40);

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

export const createSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9.\-=^]+$/, "Ticker hanya boleh huruf, angka, dan . - = ^"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD")
    .refine((d) => d <= today(), "Tanggal tidak boleh di masa depan"),
  analysts: z.array(z.enum(["market", "social", "news", "fundamentals"])).min(1, "Pilih minimal satu analyst"),
  depth: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  provider: z.string().min(1).max(40),
  quickModel: z.string().trim().min(1).max(120),
  deepModel: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(40),
  backendUrl: z.url().max(300).optional().or(z.literal("").transform(() => undefined)),
});

export const backtestSchema = createSchema.omit({ ticker: true, date: true }).extend({
  tickers: z
    .array(createSchema.shape.ticker)
    .min(1, "Isi minimal satu ticker")
    .max(5, "Maksimal 5 ticker per backtest"),
  start: createSchema.shape.date,
  end: createSchema.shape.date,
  everyNDays: z.number().int().min(1).max(90),
  runId: z.string().regex(/^[0-9_]{8,24}$/).optional(),
});

const idSchema = z.uuid();

/** The dates tradingagents.backtest.iter_grid makes: start, every n days, never past today. */
export function gridDates(start: string, end: string, everyNDays: number): string[] {
  const last = end < today() ? end : today();
  const dates: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + everyNDays)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function checkProvider(catalog: Catalog, request: { provider: string; backendUrl?: string }): string | null {
  const provider = catalog.providers.find((p) => p.key === request.provider);
  if (!provider) return `Provider tidak dikenal: ${request.provider}`;
  if (provider.needsUrl && !request.backendUrl) return `${provider.label} butuh Backend URL`;
  return backendUrlRefused(request.backendUrl);
}

const issues = (error: z.ZodError) => error.issues.map((i) => i.message).join("; ");

export const api = new Hono<AppEnv>();

/**
 * The analysis if the signed-in user may see it: their own, or anyone's for an
 * admin. Anything else answers as if it did not exist.
 */
async function visible(c: Context<AppEnv>, id: string) {
  if (!idSchema.safeParse(id).success) return null;
  const [row] = await db.select({ userId: analyses.userId }).from(analyses).where(eq(analyses.id, id));
  const user = c.get("user");
  return row && (row.userId === user.id || isAdmin(user)) ? row : null;
}

const finite = (n: number) => (Number.isFinite(n) ? n : null);

api.get("/options", async (c) => c.json(catalogFor(c.get("user"), await getCatalog())));

/** Today's use against the daily caps (see usage.ts); `left` also respects the server's total, null = no cap. */
api.get("/usage", async (c) => {
  const user = c.get("user");
  const u = await usage(user);
  return c.json({
    ...u,
    analyses: { ...u.analyses, left: finite(await room(user, "analyses")) },
    chat: { ...u.chat, left: finite(await room(user, "chat")) },
  });
});

/** The user's analyses or backtests; an admin may ask for everyone's with ?scope=all. */
api.get("/analyses", async (c) => {
  const kind: JobKind = c.req.query("kind") === "backtest" ? "backtest" : "analysis";
  const user = c.get("user");
  const all = c.req.query("scope") === "all" && isAdmin(user);
  const rows = await db
    .select({
      id: analyses.id,
      kind: analyses.kind,
      ticker: analyses.ticker,
      tradeDate: analyses.tradeDate,
      status: analyses.status,
      rating: analyses.rating,
      request: analyses.request,
      progress: analyses.progress,
      createdAt: analyses.createdAt,
      finishedAt: analyses.finishedAt,
      owner: users.username,
    })
    .from(analyses)
    .leftJoin(users, eq(analyses.userId, users.id))
    .where(and(eq(analyses.kind, kind), all ? undefined : eq(analyses.userId, user.id)))
    .orderBy(desc(analyses.createdAt))
    .limit(100);
  return c.json(rows);
});

api.post("/backtests", async (c) => {
  const parsed = backtestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
  const request = await modelsFor(c.get("user"), parsed.data);
  if (request.end < request.start) return c.json({ error: "Tanggal akhir sebelum tanggal mulai" }, 400);
  const cells = new Set(request.tickers.map((t) => t.toUpperCase())).size * gridDates(request.start, request.end, request.everyNDays).length;
  if (cells === 0) return c.json({ error: "Rentang tanggal tidak menghasilkan sel" }, 400);
  if (cells > MAX_BACKTEST_CELLS) {
    return c.json({ error: `${cells} sel melebihi batas ${MAX_BACKTEST_CELLS}. Kurangi ticker, persempit tanggal, atau perbesar jarak hari.` }, 400);
  }
  const providerError = checkProvider(await getCatalog(), request);
  if (providerError) return c.json({ error: providerError }, 400);
  const quota = await overLimit(c.get("user"), "analyses", cells);
  if (quota) return c.json({ error: quota }, 429);

  const [row] = await db
    .insert(analyses)
    .values({
      userId: c.get("user").id,
      kind: "backtest",
      ticker: request.tickers.map((t) => t.toUpperCase()).join(","),
      tradeDate: request.start,
      request,
      progress: { done: 0, total: cells, ticker: null, date: null },
    })
    .returning({ id: analyses.id });
  enqueue(row!.id);
  return c.json({ id: row!.id, cells }, 201);
});

api.get("/candles", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const range = (c.req.query("range") ?? "1y") as (typeof RANGES)[number];
  const interval = (c.req.query("interval") ?? "1d") as Interval;
  if (!SYMBOL_PATTERN.test(symbol)) return c.json({ error: "Simbol tidak valid" }, 400);
  if (!RANGES.includes(range)) return c.json({ error: "Range tidak valid" }, 400);
  if (!INTERVALS.includes(interval)) return c.json({ error: "Interval tidak valid" }, 400);
  const venue = c.req.query("venue") || undefined;
  if (venue !== undefined && !isVenue(venue)) return c.json({ error: "Bursa tidak dikenal" }, 400);
  try {
    return c.json(await getCandles(symbol.toUpperCase(), range, interval, venue));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** Every AI decision of this user on one ticker: finished analyses, and the cells of finished backtests. */
api.get("/decisions", async (c) => {
  const ticker = (c.req.query("ticker") ?? "").toUpperCase();
  if (!SYMBOL_PATTERN.test(ticker)) return c.json({ error: "Simbol tidak valid" }, 400);

  const single = await db
    .select({ id: analyses.id, date: analyses.tradeDate, rating: analyses.rating })
    .from(analyses)
    .where(
      and(
        eq(analyses.userId, c.get("user").id),
        eq(analyses.kind, "analysis"),
        eq(analyses.status, "completed"),
        eq(analyses.ticker, ticker),
        isNotNull(analyses.rating),
      ),
    );
  const sweeps = await db
    .select({ id: analyses.id, result: analyses.result })
    .from(analyses)
    .where(
      and(eq(analyses.userId, c.get("user").id), eq(analyses.kind, "backtest"), eq(analyses.status, "completed"), ilike(analyses.ticker, `%${ticker}%`)),
    );

  const decisions = [
    ...single.map((d) => ({ source: "analysis" as const, id: d.id, date: d.date, rating: d.rating!, alpha: null, return: null, pending: null })),
    ...sweeps.flatMap((s) =>
      (s.result?.cells ?? [])
        .filter((cell) => cell.ticker === ticker)
        .map((cell) => ({ source: "backtest" as const, id: s.id, date: cell.date, rating: cell.rating, alpha: cell.alpha, return: cell.return, pending: cell.pending })),
    ),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return c.json(decisions);
});

/**
 * The one answer the Pemula screen shows for a ticker: this user's latest finished analysis of
 * it (latest trade date first), else the daily AI brief's view when the brief covers it, else null.
 */
api.get("/verdict", async (c) => {
  const ticker = (c.req.query("ticker") ?? "").toUpperCase();
  if (!SYMBOL_PATTERN.test(ticker)) return c.json({ error: "Simbol tidak valid" }, 400);
  const [last] = await db
    .select({
      id: analyses.id,
      date: analyses.tradeDate,
      rating: analyses.rating,
      reports: analyses.reports,
      at: analyses.finishedAt,
      hasReport: sql<boolean>`${analyses.reportHtml} is not null`,
    })
    .from(analyses)
    .where(
      and(
        eq(analyses.userId, c.get("user").id),
        eq(analyses.kind, "analysis"),
        eq(analyses.status, "completed"),
        eq(analyses.ticker, ticker),
        isNotNull(analyses.rating),
      ),
    )
    .orderBy(desc(analyses.tradeDate), desc(analyses.createdAt))
    .limit(1);
  if (last) {
    const { reports, ...rest } = last;
    return c.json({ source: "analysis" as const, ...rest, summary: gist(reports?.final_trade_decision) });
  }
  const brief = await briefFor(ticker);
  return c.json(brief ? { source: "brief" as const, ...brief } : null);
});

api.post("/analyses", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: issues(parsed.error) }, 400);
  const request = await modelsFor(c.get("user"), parsed.data);
  const providerError = checkProvider(await getCatalog(), request);
  if (providerError) return c.json({ error: providerError }, 400);
  const quota = await overLimit(c.get("user"), "analyses");
  if (quota) return c.json({ error: quota }, 429);

  const [row] = await db
    .insert(analyses)
    .values({ userId: c.get("user").id, ticker: request.ticker.toUpperCase(), tradeDate: request.date, request })
    .returning({ id: analyses.id });
  enqueue(row!.id);
  return c.json({ id: row!.id }, 201);
});

api.get("/analyses/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await visible(c, id))) return c.json({ error: "Not found" }, 404);
  const [row] = await db.select().from(analyses).where(eq(analyses.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  const { reportHtml, ...rest } = row;
  return c.json({ ...rest, hasReportHtml: Boolean(reportHtml) });
});

api.get("/analyses/:id/report", async (c) => {
  const id = c.req.param("id");
  if (!(await visible(c, id))) return c.text("Not found", 404);
  const [row] = await db.select({ html: analyses.reportHtml }).from(analyses).where(eq(analyses.id, id));
  if (!row?.html) return c.text("Laporan belum tersedia", 404);
  // Model-written content: no scripts, no network, its own origin.
  c.header(
    "Content-Security-Policy",
    "sandbox allow-popups; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
  );
  return c.html(row.html);
});

api.post("/analyses/:id/cancel", async (c) => {
  const id = c.req.param("id");
  if (!(await visible(c, id))) return c.json({ error: "Not found" }, 404);
  const ok = await cancel(id);
  return ok ? c.json({ ok: true }) : c.json({ error: "Analisa tidak sedang berjalan" }, 409);
});

api.delete("/analyses/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await visible(c, id))) return c.json({ error: "Not found" }, 404);
  const deleted = await db
    .delete(analyses)
    .where(and(eq(analyses.id, id), inArray(analyses.status, TERMINAL)))
    .returning({ id: analyses.id });
  return deleted.length ? c.json({ ok: true }) : c.json({ error: "Hanya analisa yang sudah selesai bisa dihapus" }, 409);
});

/**
 * Server-sent events: replays the stored events after `after` (or Last-Event-ID),
 * then streams live ones until the run ends.
 */
api.get("/analyses/:id/events", async (c) => {
  const id = c.req.param("id");
  if (!(await visible(c, id))) return c.json({ error: "Not found" }, 404);
  const after = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0) || 0;

  return streamSSE(c, async (stream) => {
    // Subscribe before reading history so nothing stored in between is lost; the analysis may run
    // in another process (jobs.ts), its events arrive through the database either way.
    const pending: LiveEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = await subscribe(id, (event) => {
      pending.push(event);
      wake?.();
    });
    stream.onAbort(unsubscribe);

    let lastSeq = after;
    const send = async (event: LiveEvent) => {
      if (event.seq <= lastSeq) return;
      lastSeq = event.seq;
      await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
    };
    const sendEnd = (status: string, rating: string | null, error: string | null) =>
      stream.writeSSE({ event: "end", data: JSON.stringify({ type: "end", status, rating, error }) });

    try {
      const history = await db
        .select()
        .from(analysisEvents)
        .where(and(eq(analysisEvents.analysisId, id), gt(analysisEvents.seq, after)))
        .orderBy(asc(analysisEvents.seq));
      for (const e of history) await send({ seq: e.seq, type: e.type, ...e.payload });

      const [row] = await db
        .select({ status: analyses.status, rating: analyses.rating, error: analyses.error })
        .from(analyses)
        .where(eq(analyses.id, id));
      if (!row) return;
      if (TERMINAL.includes(row.status)) {
        await sendEnd(row.status, row.rating, row.error);
        return;
      }

      while (!stream.aborted) {
        if (pending.length === 0) {
          // Wake on a new event, or every 15s to send a keep-alive comment.
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 15_000);
          });
          wake = null;
          if (pending.length === 0) {
            await stream.write(": ping\n\n");
            continue;
          }
        }
        const event = pending.shift()!;
        if (event.type === "end") {
          await sendEnd(String(event.status), (event.rating as string) ?? null, (event.error as string) ?? null);
          return;
        }
        await send(event);
      }
    } finally {
      unsubscribe();
    }
  });
});
