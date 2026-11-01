// Model tokens, the main running cost. Every worker command that calls a model
// reports its tokens per model when it ends (web/worker/ta_worker.py, event
// "usage"), and they are kept per account and kind of work for the business
// dashboard (business.ts). LLM_COST_IDR_PER_MTOK="input,output" (rupiah per
// million tokens) turns the counts into an estimated cost there.
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { llmUsage, users, type UsageKind } from "./db/schema";

/** Whose work a worker command does, and what kind of work it is. */
export type Meter = { userId: string | null; kind: UsageKind };

/** Keep one command's "usage" event: { models: { [model]: { input, output } } }. */
export async function recordTokens(meter: Meter, models: unknown): Promise<void> {
  if (!models || typeof models !== "object") return;
  const count = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const rows = Object.entries(models as Record<string, { input?: unknown; output?: unknown } | null>)
    .map(([model, t]) => ({
      userId: meter.userId,
      kind: meter.kind,
      model: model.slice(0, 120) || "tidak dikenal",
      inputTokens: count(t?.input),
      outputTokens: count(t?.output),
    }))
    .filter((r) => r.inputTokens + r.outputTokens > 0);
  if (rows.length) await db.insert(llmUsage).values(rows);
}

const [costIn, costOut] = (process.env.LLM_COST_IDR_PER_MTOK ?? "").split(",").map((v) => Number(v.trim()));
/** Rupiah for these tokens, or null when no price is set. */
const cost = (input: number, output: number) =>
  Number.isFinite(costIn) && Number.isFinite(costOut) && (costIn > 0 || costOut > 0) ? Math.round((input * costIn + output * costOut) / 1_000_000) : null;

/** The last 30 days: totals, per day (WIB), per kind of work, per model, and the ten heaviest accounts. */
export async function tokenSummary() {
  const recent = sql`${llmUsage.createdAt} > now() - interval '30 days'`;
  const input = sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::float8`;
  const output = sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::float8`;
  const day = sql<string>`to_char(${llmUsage.createdAt} at time zone 'Asia/Jakarta', 'YYYY-MM-DD')`;
  const [[total], days, kinds, models, top] = await Promise.all([
    db.select({ input, output }).from(llmUsage).where(recent),
    db.select({ day, input, output }).from(llmUsage).where(recent).groupBy(day).orderBy(day),
    db.select({ kind: llmUsage.kind, input, output }).from(llmUsage).where(recent).groupBy(llmUsage.kind),
    db
      .select({ model: llmUsage.model, input, output })
      .from(llmUsage)
      .where(recent)
      .groupBy(llmUsage.model)
      .orderBy(desc(sql`sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens})`))
      .limit(8),
    db
      .select({ username: users.username, plan: users.plan, input, output })
      .from(llmUsage)
      .innerJoin(users, eq(llmUsage.userId, users.id))
      .where(recent)
      .groupBy(users.id, users.username, users.plan)
      .orderBy(desc(sql`sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens})`))
      .limit(10),
  ]);
  const priced = <T extends { input: number; output: number }>(r: T) => ({ ...r, cost: cost(r.input, r.output) });
  return {
    total: priced(total),
    days,
    kinds: kinds.map(priced),
    models: models.map(priced),
    users: top.map(priced),
    priced: cost(1, 1) !== null,
  };
}
