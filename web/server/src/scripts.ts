// A user's own indicator scripts: stored per account, run on the chart (browser)
// and here (alerts, the agent's CLI) in the same sandbox, and written by the AI on
// request: translated from Pine Script, or from a prompt in plain words in two
// steps (a plan the user ticks, then the script from the rules kept). Every draft
// the AI writes is run on the chart's bars and checked (script-check.ts) before the
// member sees it, and sent back to the AI with what failed, a few times at most.
// The AI's work streams as server-sent events, since a model can take minutes.
import { and, asc, eq, like } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { SCRIPT_LIMITS, SCRIPT_REFERENCE, SCRIPT_TEMPLATES, toScriptBars, type ScriptBar } from "../../shared/script";
import { GUIDE_EXAMPLE, PINE_DICTIONARY, pineDictionaryText, SCRIPT_GUIDE } from "../../shared/script-guide";
import { track } from "./activity";
import type { AppEnv } from "./auth";
import { backendUrlRefused, config } from "./config";
import { modelsFor, shownTo } from "./models";
import { db } from "./db";
import { signalAlerts, userScripts } from "./db/schema";
import { getCandles, SYMBOL_PATTERN, type Interval } from "./market";
import { checkOffThread, type ScriptCheck } from "./script-check";
import { runOnSymbol, SCRIPT_TIMEFRAMES, type ScriptTimeframe } from "./script-run";
import { capMessage, limitsOf } from "./plans";
import { overLimit, spendChat } from "./usage";
import { VENUE_IDS, type VenueId } from "./venues";
import { getCatalog, runCommand } from "./worker";

const nameSchema = z.string().trim().min(1, "Nama skrip wajib").max(40);
const codeSchema = z.string().min(1, "Kode kosong").max(SCRIPT_LIMITS.maxCode);
const idSchema = z.uuid();

export const scriptsApi = new Hono<AppEnv>();

scriptsApi.get("/scripts", async (c) => {
  const rows = await db.select().from(userScripts).where(eq(userScripts.userId, c.get("user").id)).orderBy(asc(userScripts.name));
  return c.json({
    items: rows,
    max: limitsOf(c.get("user")).scripts,
    templates: SCRIPT_TEMPLATES,
    reference: SCRIPT_REFERENCE,
    guide: SCRIPT_GUIDE,
    dictionary: PINE_DICTIONARY,
    limits: SCRIPT_LIMITS,
  });
});

scriptsApi.post("/scripts", async (c) => {
  const body = z.object({ name: nameSchema, code: codeSchema, pine: z.string().max(60_000).nullish() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const user = c.get("user");
  const userId = user.id;
  const count = (await db.select({ id: userScripts.id }).from(userScripts).where(eq(userScripts.userId, userId))).length;
  const max = limitsOf(user).scripts;
  if (count >= max) return c.json({ error: capMessage(user, max, "skrip") }, 409);
  const [row] = await db
    .insert(userScripts)
    .values({ userId, name: body.data.name, code: body.data.code, pine: body.data.pine ?? null })
    .onConflictDoNothing()
    .returning();
  if (row) await track(user, "script", null, { name: row.name });
  return row ? c.json(row, 201) : c.json({ error: "Nama skrip sudah dipakai" }, 409);
});

scriptsApi.put("/scripts/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = z.object({ name: nameSchema.optional(), code: codeSchema.optional(), pine: z.string().max(60_000).nullish() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  try {
    const [row] = await db
      .update(userScripts)
      .set({ ...body.data, updatedAt: new Date() })
      .where(and(eq(userScripts.id, id), eq(userScripts.userId, c.get("user").id)))
      .returning();
    return row ? c.json(row) : c.json({ error: "Not found" }, 404);
  } catch {
    return c.json({ error: "Nama skrip sudah dipakai" }, 409);
  }
});

scriptsApi.delete("/scripts/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const userId = c.get("user").id;
  // Its notifications go with it.
  await db.delete(signalAlerts).where(and(eq(signalAlerts.userId, userId), like(signalAlerts.indicator, `script:${id}`)));
  await db.delete(userScripts).where(and(eq(userScripts.id, id), eq(userScripts.userId, userId)));
  return c.json({ ok: true });
});

/** The server's run of a script, for checking it gives what the chart shows. */
scriptsApi.post("/scripts/run", async (c) => {
  const body = z
    .object({ code: codeSchema, symbol: z.string().regex(SYMBOL_PATTERN), timeframe: z.enum(SCRIPT_TIMEFRAMES) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Data tidak valid" }, 400);
  try {
    const run = await runOnSymbol(body.data.code, body.data.symbol.toUpperCase(), body.data.timeframe);
    return c.json(run.ok ? { ok: true, ms: run.ms, bars: run.bars.length, stats: run.result.stats, signals: run.result.signals.slice(-10) } : run);
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 502);
  }
});

const modelFields = {
  provider: z.string().min(1).max(40),
  quickModel: z.string().trim().min(1).max(120),
  deepModel: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(40).default("Indonesian"),
  backendUrl: z.url().max(300).optional().or(z.literal("").transform(() => undefined)),
};
type ModelFields = z.infer<z.ZodObject<typeof modelFields>>;
/** The chart a draft is tested on: the one the editor shows; without it, Bitcoin hourly. */
const chartFields = {
  symbol: z.string().regex(SYMBOL_PATTERN).optional(),
  timeframe: z.enum(SCRIPT_TIMEFRAMES).optional(),
  venue: z.enum(VENUE_IDS).optional(),
};

export const translateSchema = z.object({ pine: z.string().trim().min(20, "Tempel skrip Pine-nya").max(60_000), ...modelFields, ...chartFields });
const promptText = z.string().trim().min(20, "Tulis prompt atau aturanmu, minimal 20 huruf").max(20_000, "Prompt paling panjang 20.000 huruf");
export const planSchema = z.object({ prompt: promptText, ...modelFields });
export const composeSchema = z.object({
  prompt: promptText,
  rules: z.array(z.string().trim().min(1).max(300)).min(1, "Pilih minimal satu aturan").max(30, "Paling banyak 30 aturan"),
  ...modelFields,
  ...chartFields,
});

/** The full translation the translator copies the shape of: the guide's Pine example. */
const EXAMPLE = (SCRIPT_TEMPLATES.find((t) => t.name === GUIDE_EXAMPLE) ?? SCRIPT_TEMPLATES[0]).code;
const DICTIONARY = pineDictionaryText();
/** How many times the AI may repair a draft that failed the check. */
const MAX_REPAIRS = 2;
const TIMEFRAME_NAMES: Record<ScriptTimeframe, string> = { "15m": "15 menit", "1h": "1 jam", "4h": "4 jam", "1d": "harian" };

type TestBars = { bars: ScriptBar[]; context: { timeframe: string; tz: string | null }; where: string };
type LoadBars = (symbol: string, timeframe: ScriptTimeframe, venue?: VenueId) => Promise<TestBars>;
const liveBars: LoadBars = async (symbol, timeframe, venue) => {
  // The chart's own window (script-run.ts), so the test sees what the chart will.
  const series = await getCandles(symbol, "1y", timeframe as Interval, venue);
  return { bars: toScriptBars(series.candles), context: { timeframe, tz: series.exchangeTimezone }, where: `${symbol} ${TIMEFRAME_NAMES[timeframe]}` };
};
let loadBars = liveBars;
/** Test drafts on other bars (the test suite's fixed ones); without an argument, back to live candles. */
export function useTestBars(load: LoadBars = liveBars) {
  loadBars = load;
}
const testBars = (symbol?: string, timeframe?: ScriptTimeframe, venue?: VenueId) =>
  loadBars(symbol?.toUpperCase() ?? "BTC-USD", timeframe ?? "1h", venue).catch((e: Error) => e);

type Draft = { code: string; report: unknown };
type StepOut = { code?: string; report?: unknown; plan?: unknown };
type Step = (task: Record<string, unknown>) => Promise<StepOut>;
type Say = (event: string, data: object) => Promise<void>;

/**
 * The job as it will run (for a member, on the server's own models: models.ts), or why it cannot: an unknown
 * provider, a backend URL this server does not allow, or a used-up quota. Counts as one chat message, taken here
 * as the work starts (usage.ts spendChat), as the agent's turn is.
 */
async function ready(c: Context<AppEnv>, fields: ModelFields): Promise<ModelFields | Response> {
  const job = await modelsFor(c.get("user"), fields);
  const provider = (await getCatalog()).providers.find((p) => p.key === job.provider);
  if (!provider) return c.json({ error: `Provider tidak dikenal: ${job.provider}` }, 400);
  if (provider.needsUrl && !job.backendUrl) return c.json({ error: `${provider.label} butuh Backend URL` }, 400);
  const refused = backendUrlRefused(job.backendUrl);
  if (refused) return c.json({ error: refused }, 400);
  const quota = await overLimit(c.get("user"), "chat");
  if (quota) return c.json({ error: quota }, 429);
  await spendChat(c.get("user").id);
  return job;
}

/**
 * The AI's work as server-sent events, so a slow model never leaves the line quiet for long (Cloudflare cuts a
 * response quiet for 100 s): `step` { text } as it goes, then `result` or `plan`, or `error` { message }, then `end`,
 * with a comment line every 15 s between. Each step is one run of the worker's translate command, whose model call
 * may take `translateTimeoutS` twice (one retry); leaving the page stops it.
 */
function aiWork(c: Context<AppEnv>, job: ModelFields, work: (step: Step, say: Say) => Promise<void>) {
  const user = c.get("user");
  return streamSSE(c, async (stream) => {
    let current: { kill(): void } | null = null;
    stream.onAbort(() => current?.kill());
    const ping = setInterval(() => void stream.write(": ping\n\n").catch(() => {}), 15_000);
    const say: Say = (event, data) => stream.writeSSE({ event, data: JSON.stringify(data) });
    const step: Step = async (task) => {
      if (stream.aborted) throw new Error("Dibatalkan");
      let out: StepOut = {};
      let error = "";
      const handle = runCommand(
        "translate",
        { ...job, ...task, reference: SCRIPT_REFERENCE, dictionary: DICTIONARY, example: EXAMPLE, llmTimeout: config.translateTimeoutS },
        { userId: user.id, kind: "translate" },
        async (e) => {
          if (e.type === "code") out = { code: String(e.code ?? "") || undefined, report: e.report ?? null };
          else if (e.type === "plan") out = { plan: e.plan ?? undefined };
          else if (e.type === "error") error = String(e.message ?? "");
        },
      );
      current = handle;
      const timer = setTimeout(() => handle.kill(), (config.translateTimeoutS * 2 + 60) * 1000);
      const { exitCode, stderrTail } = await handle.done.finally(() => clearTimeout(timer));
      current = null;
      if (out.code || out.plan) return out;
      throw new Error(error || `Penerjemah berhenti tanpa hasil (exit ${exitCode}). ${stderrTail.trim().split("\n").slice(-2).join(" ")}`);
    };
    try {
      await work(step, say);
    } catch (e) {
      if (!stream.aborted) await say("error", { message: await shownTo(user, (e as Error).message) });
    } finally {
      clearInterval(ping);
      if (!stream.aborted) await say("end", {});
    }
  });
}

/**
 * Tests a draft on the chart's bars (script-check.ts, on its own thread) and, while it fails, has the AI repair it, up
 * to MAX_REPAIRS times; answers the last draft with its check. Bars that do not load, or a check that does not finish,
 * leave the draft untested, and a repair that fails leaves the draft before it: either way the member gets a script
 * and the reason.
 */
async function tested(c: Context<AppEnv>, first: Draft, bars: Promise<TestBars | Error>, say: Say, repair: (draft: Draft, problems: string[]) => Promise<Draft>) {
  const test = await bars;
  if (test instanceof Error) return { ...first, check: null, repairs: 0, note: `Tidak bisa memuat candle untuk menguji: ${test.message}` };
  let draft = first;
  for (let repairs = 0; ; repairs++) {
    await say("step", { text: `Menguji di ${test.where}, ${test.bars.length.toLocaleString("id-ID")} candle` });
    let check: ScriptCheck & { where: string };
    try {
      check = { ...(await checkOffThread(draft.code, test.bars, test.context)), where: test.where };
    } catch (e) {
      return { ...draft, check: null, repairs, note: `Tidak bisa menguji skrip: ${(e as Error).message}` };
    }
    if (!check.problems.length || repairs === MAX_REPAIRS) return { ...draft, check, repairs };
    await say("step", { text: `Memperbaiki (${repairs + 1} dari ${MAX_REPAIRS}): ${check.problems[0]}` });
    try {
      draft = await repair(draft, check.problems);
    } catch (e) {
      return { ...draft, check, repairs, note: `Perbaikan otomatis berhenti: ${await shownTo(c.get("user"), (e as Error).message)}` };
    }
  }
}

const invalid = (c: Context<AppEnv>, issues: z.core.$ZodIssue[]) => c.json({ error: issues.map((i) => i.message).join("; ") }, 400);

/**
 * Pine Script to this app's script language, by the deep model, with a report of what was kept, changed and dropped;
 * tested and repaired as above. Counts as one chat message.
 */
scriptsApi.post("/scripts/translate", async (c) => {
  const parsed = translateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { pine, symbol, timeframe, venue, ...fields } = parsed.data;
  const job = await ready(c, fields);
  if (job instanceof Response) return job;
  return aiWork(c, job, async (step, say) => {
    const bars = testBars(symbol, timeframe, venue);
    await say("step", { text: "Menerjemahkan dengan AI" });
    const first = await step({ mode: "pine", pine });
    const result = await tested(c, { code: first.code!, report: first.report ?? null }, bars, say, async (draft, problems) => {
      const out = await step({ mode: "repair", source: "pine", pine, code: draft.code, problems });
      return { code: out.code!, report: out.report ?? draft.report };
    });
    await say("result", result);
  });
});

/**
 * A prompt or rules in plain words, step one: a plan of rules a script can compute from prices, rules changed so they can be
 * tested, and what no script can do, for the user to tick. Counts as one chat message.
 */
scriptsApi.post("/scripts/plan", async (c) => {
  const parsed = planSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { prompt, ...fields } = parsed.data;
  const job = await ready(c, fields);
  if (job instanceof Response) return job;
  return aiWork(c, job, async (step, say) => {
    await say("step", { text: "Memilah prompt jadi aturan" });
    const out = await step({ mode: "plan", prompt });
    await say("plan", { plan: out.plan });
  });
});

/** Step two: a script from the rules the user kept, with the prompt for context; tested and repaired. Counts as one chat message. */
scriptsApi.post("/scripts/compose", async (c) => {
  const parsed = composeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { prompt, rules, symbol, timeframe, venue, ...fields } = parsed.data;
  const job = await ready(c, fields);
  if (job instanceof Response) return job;
  return aiWork(c, job, async (step, say) => {
    const bars = testBars(symbol, timeframe, venue);
    await say("step", { text: `Menulis skrip dari ${rules.length} aturan` });
    const first = await step({ mode: "compose", prompt, rules });
    const result = await tested(c, { code: first.code!, report: null }, bars, say, async (draft, problems) => {
      const out = await step({ mode: "repair", source: "prompt", prompt, rules, code: draft.code, problems });
      return { code: out.code!, report: null };
    });
    await say("result", result);
  });
});
