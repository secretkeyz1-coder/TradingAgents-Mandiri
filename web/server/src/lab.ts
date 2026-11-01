// The strategy lab: test a built-in engine, a published indicator or one of the user's scripts on a long history, per
// symbol, with trading costs, and judge it on data it was not tuned on. The first part of the
// history (in-sample) is where a strategy is shaped; the rest (out-of-sample) is the check. A
// strategy passes only when it stays positive after costs on the part it never saw.
//
// Engines run in the Python worker (lab.py) on the bars sent from here; scripts run in the same
// sandbox as the chart, with longer limits. Scoring happens here, the same way for both.
import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { track } from "./activity";
import type { AppEnv } from "./auth";
import { db } from "./db";
import { labRuns, userScripts } from "./db/schema";
import { canUse, catalogScripts, keyOf, usableRows } from "./indicators";
import { holdLease, leaseHeld } from "./locks";
import { capMessage, limitsOf } from "./plans";
import { tradeCost } from "./ledger";
import { getLabCandles, LAB_MAX_DAYS, SYMBOL_PATTERN, type Interval } from "./market";
import { quickjs } from "./script-run";
import { runScript, toScriptBars, type ScriptBar } from "../../shared/script";
import { storedVenue, VENUE_IDS } from "./venues";
import { runCommand } from "./worker";

export const LAB_ENGINES: Record<string, { label: string; timeframes: string[] }> = {
  pob: { label: "PoB BYSTRA", timeframes: ["15m", "1h"] },
  scalper: { label: "Scalper Pro+", timeframes: ["15m", "1h", "4h", "1d"] },
  fib: { label: "Fib Golden Zone", timeframes: ["15m", "1h", "4h", "1d"] },
};
const MAX_RUNS_KEPT = 30;
const ENGINE_TIMEOUT_MS = 3 * 60_000;
/**
 * One run at a time across instances: a run is minutes of CPU for long histories. A lease
 * (locks.ts), renewed while the run lasts; one left by a crashed process frees itself.
 */
const RUN_LEASE = "lab";
const RUN_LEASE_MS = 2 * 60_000;

export const runSchema = z.object({
  strategy: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("engine"), name: z.enum(["pob", "scalper", "fib"]) }),
    z.object({ kind: z.literal("script"), id: z.uuid() }),
    // An indicator the admin published (indicators.ts).
    z.object({ kind: z.literal("catalog"), id: z.uuid() }),
  ]),
  symbols: z.array(z.string().trim().toUpperCase().regex(SYMBOL_PATTERN)).min(1).max(5),
  timeframe: z.enum(["15m", "1h", "4h", "1d"]),
  days: z.number().int().min(7).max(1825),
  costs: z.enum(["taker", "maker"]).default("taker"),
  split: z.number().min(0.5).max(0.9).default(0.7),
  expiry: z.number().int().min(4).max(500).default(96),
  /** For crypto symbols: the venue whose bars to test on (default Binance). */
  venue: z.enum(VENUE_IDS).optional(),
});
type RunConfig = z.infer<typeof runSchema>;

type Trade = { index: number; time: string; side: string; entry: number; stopLoss: number; outcome: string; r: number };
type Scored = Trade & { cost: number; net: number; oos: boolean };

export type LabStats = { n: number; win: number | null; gross: number | null; cost: number | null; net: number | null; pf: number | null; total: number; maxDrawdown: number };

function stats(trades: Scored[]): LabStats {
  const net = trades.map((t) => t.net);
  const gain = net.filter((x) => x > 0).reduce((a, x) => a + x, 0);
  const loss = -net.filter((x) => x < 0).reduce((a, x) => a + x, 0);
  let run = 0;
  let peak = 0;
  let deepest = 0;
  for (const x of net) {
    run += x;
    peak = Math.max(peak, run);
    deepest = Math.max(deepest, peak - run);
  }
  const n = trades.length;
  const mean = (f: (t: Scored) => number) => (n ? trades.reduce((a, t) => a + f(t), 0) / n : null);
  return {
    n,
    // A win is a trade that paid after costs, whatever closed it.
    win: n ? trades.filter((t) => t.net > 0).length / n : null,
    gross: mean((t) => t.r),
    cost: mean((t) => t.cost),
    net: mean((t) => t.net),
    pf: loss > 0 ? gain / loss : null,
    total: run,
    maxDrawdown: deepest,
  };
}

/** The engine's signals on these bars, from the worker. */
async function engineTrades(name: string, timeframe: string, symbol: string, bars: ScriptBar[], expiry: number): Promise<Trade[]> {
  let found: { index: number; side: string; entry: number; stop_loss: number; outcome: string; r: number | null }[] = [];
  let error = "";
  const handle = runCommand("lab", { engine: name, timeframe, symbol, expiry, bars }, null, async (e) => {
    if (e.type === "lab_signals") found = e.signals as typeof found;
    else if (e.type === "error") error = String(e.message ?? "");
  });
  const timer = setTimeout(() => handle.kill(), ENGINE_TIMEOUT_MS);
  const { exitCode, stderrTail } = await handle.done.finally(() => clearTimeout(timer));
  if (exitCode !== 0) throw new Error(error || stderrTail.trim().split("\n").slice(-1)[0] || `worker keluar dengan kode ${exitCode}`);
  return found
    .filter((s) => s.outcome !== "open" && s.r != null && bars[s.index])
    .map((s) => ({ index: s.index, time: bars[s.index].time, side: s.side, entry: s.entry, stopLoss: s.stop_loss, outcome: s.outcome, r: s.r! }));
}

/** The script's signals on these bars, in the sandbox, with room for years of bars. */
async function scriptTrades(code: string, bars: ScriptBar[], expiry: number): Promise<Trade[]> {
  const run = runScript(await quickjs(), code, bars, { expiry, limits: { timeMs: 30_000, maxSignals: 50_000 } });
  if (!run.ok) throw new Error(run.error);
  return run.result.signals
    .filter((s) => s.outcome !== "open" && s.r != null)
    .map((s) => ({ index: s.index, time: s.time, side: s.side, entry: s.entry, stopLoss: s.stopLoss, outcome: s.outcome, r: s.r! }));
}

async function runLab(config: RunConfig, code: string | null) {
  const started = Date.now();
  const all: Scored[] = [];
  const symbols = [];
  for (const symbol of [...new Set(config.symbols)]) {
    try {
      const series = await getLabCandles(symbol, config.timeframe as Interval, config.days, config.venue);
      const bars = toScriptBars(series.candles);
      if (bars.length < 100) throw new Error(`baru ${bars.length} candle, terlalu sedikit`);
      const trades =
        config.strategy.kind === "engine"
          ? await engineTrades(config.strategy.name, config.timeframe, symbol, bars, config.expiry)
          : await scriptTrades(code!, bars, config.expiry);
      const cut = Math.floor(bars.length * config.split);
      const scored = trades.map((t) => {
        const cost = tradeCost(symbol, t.entry, config.costs === "maker", storedVenue(config.venue)) / Math.abs(t.entry - t.stopLoss);
        return { ...t, cost, net: t.r - cost, oos: t.index >= cut };
      });
      all.push(...scored);
      symbols.push({
        symbol,
        source: series.source,
        bars: bars.length,
        from: bars[0].time,
        to: bars.at(-1)!.time,
        split: bars[cut]?.time ?? null,
        is: stats(scored.filter((t) => !t.oos)),
        oos: stats(scored.filter((t) => t.oos)),
      });
    } catch (e) {
      symbols.push({ symbol, error: (e as Error).message.slice(0, 300) });
    }
  }

  const ordered = all.sort((a, b) => a.time.localeCompare(b.time));
  const total = { is: stats(ordered.filter((t) => !t.oos)), oos: stats(ordered.filter((t) => t.oos)) };
  // The combined curve of net R, at most about 1500 points.
  let run = 0;
  const step = Math.max(1, Math.ceil(ordered.length / 1500));
  const equity = ordered.flatMap((t, i) => {
    run += t.net;
    return i % step === 0 || i === ordered.length - 1 ? [{ time: t.time, r: Math.round(run * 100) / 100, oos: t.oos }] : [];
  });
  const verdict =
    total.oos.n < 30
      ? { pass: false, reason: `Data uji baru ${total.oos.n} trade; perlu minimal 30. Perpanjang periode atau tambah simbol.` }
      : (total.is.net ?? 0) <= 0
        ? { pass: false, reason: "Sudah rugi di data awal setelah biaya." }
        : (total.oos.net ?? 0) <= 0
          ? { pass: false, reason: "Untung di data awal, tapi rugi di data uji: kemungkinan hanya cocok dengan masa lalu." }
          : { pass: true, reason: "Positif setelah biaya di data awal dan di data uji. Jalankan di buku catatan live sebelum dipakai." };
  return { symbols, total, equity, verdict, ms: Date.now() - started };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const labApi = new Hono<AppEnv>();

/** The engines and published scripts this account may test, the same ones its chart offers (indicators.ts). */
labApi.get("/lab", async (c) => {
  const user = c.get("user");
  const [scripts, open] = await Promise.all([
    db.select({ id: userScripts.id, name: userScripts.name }).from(userScripts).where(eq(userScripts.userId, user.id)),
    usableRows(user),
  ]);
  const usable = new Set<string>(open.map(keyOf));
  return c.json({
    engines: Object.fromEntries(Object.entries(LAB_ENGINES).filter(([key]) => usable.has(key))),
    catalog: open.filter((r) => !r.builtin).map((r) => ({ id: r.id, name: r.name })),
    scripts,
    maxDays: LAB_MAX_DAYS,
    busy: await leaseHeld(RUN_LEASE),
  });
});

labApi.post("/lab/run", async (c) => {
  const user = c.get("user");
  const body = runSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const config = body.data;
  let name: string;
  let code: string | null = null;
  if (config.strategy.kind !== "script" && !(await canUse(user, config.strategy.kind === "engine" ? config.strategy.name : `catalog:${config.strategy.id}`))) {
    return c.json({ error: "Indikator ini tidak tersedia di paketmu" }, 403);
  }
  if (config.strategy.kind === "engine") {
    const engine = LAB_ENGINES[config.strategy.name];
    if (!engine.timeframes.includes(config.timeframe)) return c.json({ error: `${engine.label} hanya untuk ${engine.timeframes.join(", ")}` }, 400);
    name = engine.label;
  } else if (config.strategy.kind === "catalog") {
    const published = (await catalogScripts()).get(`catalog:${config.strategy.id}`);
    if (!published?.code) return c.json({ error: "Indikator tidak ditemukan" }, 404);
    name = published.name;
    code = published.code;
  } else {
    const [script] = await db
      .select()
      .from(userScripts)
      .where(and(eq(userScripts.id, config.strategy.id), eq(userScripts.userId, user.id)));
    if (!script) return c.json({ error: "Skrip tidak ditemukan" }, 404);
    name = script.name;
    code = script.code;
  }
  const [{ today }] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(labRuns)
    .where(and(eq(labRuns.userId, user.id), gte(labRuns.createdAt, new Date(Date.now() - 86_400_000))));
  const perDay = limitsOf(user).labRuns;
  if (today >= perDay) return c.json({ error: capMessage(user, perDay, "uji Lab per 24 jam") }, 429);
  const lease = await holdLease(RUN_LEASE, RUN_LEASE_MS);
  if (!lease) return c.json({ error: "Lab sedang menjalankan uji lain. Coba lagi sebentar lagi." }, 429);
  try {
    await track(user, "lab", config.symbols.length === 1 ? config.symbols[0] : null, { strategy: name, timeframe: config.timeframe, symbols: config.symbols.length });
    const result = await runLab(config, code);
    const [saved] = await db.insert(labRuns).values({ userId: user.id, name, config, result }).returning({ id: labRuns.id, createdAt: labRuns.createdAt });
    // Keep the newest runs only.
    const keep = await db.select({ id: labRuns.id }).from(labRuns).where(eq(labRuns.userId, user.id)).orderBy(desc(labRuns.createdAt)).limit(MAX_RUNS_KEPT);
    await db.delete(labRuns).where(and(eq(labRuns.userId, user.id), notInArray(labRuns.id, keep.map((k) => k.id))));
    return c.json({ id: saved.id, createdAt: saved.createdAt, name, config, ...result });
  } finally {
    await lease.release();
  }
});

labApi.get("/lab/runs", async (c) => {
  const rows = await db
    .select({ id: labRuns.id, name: labRuns.name, config: labRuns.config, result: labRuns.result, createdAt: labRuns.createdAt })
    .from(labRuns)
    .where(eq(labRuns.userId, c.get("user").id))
    .orderBy(desc(labRuns.createdAt));
  // The list carries the headline only; a run's full result is fetched on its own.
  return c.json(
    rows.map((r) => {
      const result = r.result as { total?: unknown; verdict?: unknown };
      return { id: r.id, name: r.name, config: r.config, createdAt: r.createdAt, total: result.total, verdict: result.verdict };
    }),
  );
});

labApi.get("/lab/runs/:id", async (c) => {
  if (!UUID.test(c.req.param("id"))) return c.json({ error: "Tidak ditemukan" }, 404);
  const [row] = await db
    .select()
    .from(labRuns)
    .where(and(eq(labRuns.id, c.req.param("id")), eq(labRuns.userId, c.get("user").id)));
  if (!row) return c.json({ error: "Tidak ditemukan" }, 404);
  return c.json({ id: row.id, name: row.name, config: row.config, createdAt: row.createdAt, ...(row.result as object) });
});

labApi.delete("/lab/runs/:id", async (c) => {
  if (!UUID.test(c.req.param("id"))) return c.json({ error: "Tidak ditemukan" }, 404);
  await db.delete(labRuns).where(and(eq(labRuns.id, c.req.param("id")), eq(labRuns.userId, c.get("user").id)));
  return c.json({ ok: true });
});
