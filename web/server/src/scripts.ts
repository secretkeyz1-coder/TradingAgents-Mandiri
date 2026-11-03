// A user's own indicator scripts: stored per account, run on the chart (browser)
// and here (alerts, the agent's CLI) in the same sandbox, and written by the AI on
// request: translated from Pine Script, or from a prompt in plain words in two
// steps (a plan the user ticks, then the script from the rules kept).
import { and, asc, eq, like } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { SCRIPT_LIMITS, SCRIPT_REFERENCE, SCRIPT_TEMPLATES } from "../../shared/script";
import { track } from "./activity";
import type { AppEnv } from "./auth";
import { backendUrlRefused } from "./config";
import { modelsFor } from "./models";
import { db } from "./db";
import { signalAlerts, userScripts } from "./db/schema";
import { SYMBOL_PATTERN } from "./market";
import { runOnSymbol, SCRIPT_TIMEFRAMES } from "./script-run";
import { capMessage, limitsOf } from "./plans";
import { overLimit } from "./usage";
import { getCatalog, runCommand } from "./worker";

const nameSchema = z.string().trim().min(1, "Nama skrip wajib").max(40);
const codeSchema = z.string().min(1, "Kode kosong").max(SCRIPT_LIMITS.maxCode);
const idSchema = z.uuid();

export const scriptsApi = new Hono<AppEnv>();

scriptsApi.get("/scripts", async (c) => {
  const rows = await db.select().from(userScripts).where(eq(userScripts.userId, c.get("user").id)).orderBy(asc(userScripts.name));
  return c.json({ items: rows, max: limitsOf(c.get("user")).scripts, templates: SCRIPT_TEMPLATES, reference: SCRIPT_REFERENCE, limits: SCRIPT_LIMITS });
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

const translateSchema = z.object({ pine: z.string().trim().min(20, "Tempel skrip Pine-nya").max(60_000), ...modelFields });
const promptText = z.string().trim().min(20, "Tulis prompt atau aturanmu, minimal 20 huruf").max(20_000, "Prompt paling panjang 20.000 huruf");
export const planSchema = z.object({ prompt: promptText, ...modelFields });
export const composeSchema = z.object({
  prompt: promptText,
  rules: z.array(z.string().trim().min(1).max(300)).min(1, "Pilih minimal satu aturan").max(30, "Paling banyak 30 aturan"),
  ...modelFields,
});

/** The script the translator copies the shape of. */
const EXAMPLE = (SCRIPT_TEMPLATES.find((t) => t.name === "EMA cross + ATR") ?? SCRIPT_TEMPLATES[0]).code;

/**
 * One job of the worker's translate command (a Pine translation, or a prompt's plan or script) on the user's deep model,
 * which for a member is the server's (models.ts). Counts as one chat message. Answers `{ [want]: … }` from the
 * worker's event of that name, else the reason it stopped.
 */
async function translateReply(c: Context<AppEnv>, fields: ModelFields, task: Record<string, unknown>, want: "code" | "plan") {
  const job = await modelsFor(c.get("user"), fields);
  const provider = (await getCatalog()).providers.find((p) => p.key === job.provider);
  if (!provider) return c.json({ error: `Provider tidak dikenal: ${job.provider}` }, 400);
  if (provider.needsUrl && !job.backendUrl) return c.json({ error: `${provider.label} butuh Backend URL` }, 400);
  const refused = backendUrlRefused(job.backendUrl);
  if (refused) return c.json({ error: refused }, 400);
  const quota = await overLimit(c.get("user"), "chat");
  if (quota) return c.json({ error: quota }, 429);

  let out: unknown = null;
  let error = "";
  const handle = runCommand("translate", { ...job, ...task, reference: SCRIPT_REFERENCE, example: EXAMPLE }, { userId: c.get("user").id, kind: "translate" }, async (e) => {
    if (e.type === want) out = want === "code" ? String(e.code ?? "") || null : (e.plan ?? null);
    else if (e.type === "error") error = String(e.message ?? "");
  });
  const timer = setTimeout(() => handle.kill(), 5 * 60_000);
  const { exitCode, stderrTail } = await handle.done.finally(() => clearTimeout(timer));
  if (out) return c.json({ [want]: out });
  return c.json({ error: error || `Penerjemah berhenti tanpa hasil (exit ${exitCode}). ${stderrTail.trim().split("\n").slice(-2).join(" ")}` }, 502);
}

const invalid = (c: Context<AppEnv>, issues: z.core.$ZodIssue[]) => c.json({ error: issues.map((i) => i.message).join("; ") }, 400);

/** Pine Script to this app's script language, by the user's deep model. Counts as one chat message. */
scriptsApi.post("/scripts/translate", async (c) => {
  const parsed = translateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { pine, ...fields } = parsed.data;
  return translateReply(c, fields, { mode: "pine", pine }, "code");
});

/**
 * A prompt or rules in plain words, step one: a plan of rules a script can compute from prices, rules changed so they can be
 * tested, and what no script can do, for the user to tick. Counts as one chat message.
 */
scriptsApi.post("/scripts/plan", async (c) => {
  const parsed = planSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { prompt, ...fields } = parsed.data;
  return translateReply(c, fields, { mode: "plan", prompt }, "plan");
});

/** Step two: a script from the rules the user kept, with the prompt for context. Counts as one chat message. */
scriptsApi.post("/scripts/compose", async (c) => {
  const parsed = composeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const { prompt, rules, ...fields } = parsed.data;
  return translateReply(c, fields, { mode: "compose", prompt, rules }, "code");
});
