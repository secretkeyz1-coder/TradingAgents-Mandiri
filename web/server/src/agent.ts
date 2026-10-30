// The chart agent's API: chat sessions per symbol, their messages (each turn
// streamed as server-sent events from the Python worker), what the agent
// remembers, and the drawings it puts on charts. The worker validates every
// drawing against real prices; this side only stores and forwards.
import { and, asc, desc, eq, gt, isNull, max, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { backendUrlRefused } from "./config";
import { db } from "./db";
import {
  agentMemories,
  agentMessages,
  agentSessions,
  agentSkills,
  chartDrawings,
  type AgentToolCall,
  type DrawingKind,
  type SkillDefinition,
  type SkillStatus,
} from "./db/schema";
import { SYMBOL_PATTERN } from "./market";
import { overLimit } from "./usage";
import { getCatalog, runCommand } from "./worker";

/** Turns sent to the model verbatim; older ones are folded into the session summary. */
const KEEP_TURNS = 16;
/** Fold when this many turns sit outside the summary. */
const SUMMARIZE_AT = 24;

const idSchema = z.uuid();
const symbolSchema = z.string().regex(SYMBOL_PATTERN).transform((s) => s.toUpperCase());

const turnSchema = z.object({
  message: z.string().trim().min(1, "Pesan kosong").max(4000),
  provider: z.string().min(1).max(40),
  quickModel: z.string().trim().min(1).max(120),
  deepModel: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(40).default("Indonesian"),
  backendUrl: z.url().max(300).optional().or(z.literal("").transform(() => undefined)),
});

/** One turn per session at a time: a second send while the agent works is refused. */
const busy = new Set<string>();

export const agentApi = new Hono();

agentApi.get("/agent/sessions", async (c) => {
  const symbol = symbolSchema.safeParse(c.req.query("symbol") ?? "");
  const rows = await db
    .select()
    .from(agentSessions)
    .where(symbol.success ? eq(agentSessions.symbol, symbol.data) : undefined)
    .orderBy(desc(agentSessions.updatedAt))
    .limit(50);
  return c.json(rows);
});

agentApi.post("/agent/sessions", async (c) => {
  const body = z.object({ symbol: symbolSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Simbol tidak valid" }, 400);
  const [row] = await db.insert(agentSessions).values({ symbol: body.data.symbol }).returning();
  return c.json(row, 201);
});

agentApi.get("/agent/sessions/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, id));
  if (!session) return c.json({ error: "Not found" }, 404);
  const messages = await db.select().from(agentMessages).where(eq(agentMessages.sessionId, id)).orderBy(asc(agentMessages.id));
  return c.json({ ...session, messages, busy: busy.has(id) });
});

agentApi.delete("/agent/sessions/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json({ error: "Not found" }, 404);
  if (busy.has(id)) return c.json({ error: "Agent sedang menjawab di sesi ini" }, 409);
  await db.delete(agentSessions).where(eq(agentSessions.id, id));
  return c.json({ ok: true });
});

agentApi.get("/agent/memories", async (c) => {
  const symbol = symbolSchema.safeParse(c.req.query("symbol") ?? "");
  const rows = await db
    .select()
    .from(agentMemories)
    .where(symbol.success ? or(eq(agentMemories.scope, "user"), eq(agentMemories.symbol, symbol.data)) : undefined)
    .orderBy(desc(agentMemories.createdAt));
  return c.json(rows);
});

agentApi.delete("/agent/memories/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json({ error: "Not found" }, 404);
  await db.delete(agentMemories).where(eq(agentMemories.id, id));
  return c.json({ ok: true });
});

agentApi.get("/drawings", async (c) => {
  const symbol = symbolSchema.safeParse(c.req.query("symbol") ?? "");
  if (!symbol.success) return c.json({ error: "Simbol tidak valid" }, 400);
  const rows = await db.select().from(chartDrawings).where(eq(chartDrawings.symbol, symbol.data)).orderBy(asc(chartDrawings.createdAt));
  return c.json(rows);
});

agentApi.delete("/drawings/:id", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json({ error: "Not found" }, 404);
  await db.delete(chartDrawings).where(eq(chartDrawings.id, id));
  return c.json({ ok: true });
});

agentApi.delete("/drawings", async (c) => {
  const symbol = symbolSchema.safeParse(c.req.query("symbol") ?? "");
  if (!symbol.success) return c.json({ error: "Simbol tidak valid" }, 400);
  await db.delete(chartDrawings).where(eq(chartDrawings.symbol, symbol.data));
  return c.json({ ok: true });
});

agentApi.get("/agent/skills", async (c) => {
  const rows = await db.select().from(agentSkills).orderBy(asc(agentSkills.name), desc(agentSkills.version));
  return c.json(rows);
});

/**
 * Skill lifecycle. Only the user moves a skill between states; the agent can
 * only propose drafts. Activating a version archives the name's other active one.
 */
const TRANSITIONS: Record<string, { from: SkillStatus[]; to: SkillStatus }> = {
  approve: { from: ["draft"], to: "active" },
  reject: { from: ["draft"], to: "rejected" },
  disable: { from: ["active"], to: "disabled" },
  enable: { from: ["disabled"], to: "active" },
  restore: { from: ["archived"], to: "active" },
};

agentApi.post("/agent/skills/:id/:action", async (c) => {
  const id = c.req.param("id");
  const rule = TRANSITIONS[c.req.param("action")];
  if (!idSchema.safeParse(id).success || !rule) return c.json({ error: "Not found" }, 404);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(agentSkills).where(eq(agentSkills.id, id));
    if (!row) return { status: 404, error: "Not found" };
    if (!rule.from.includes(row.status)) return { status: 409, error: `Skill berstatus ${row.status}` };
    if (rule.to === "active") {
      await tx
        .update(agentSkills)
        .set({ status: "archived" })
        .where(and(eq(agentSkills.name, row.name), eq(agentSkills.status, "active"), ne(agentSkills.id, id)));
    }
    await tx.update(agentSkills).set({ status: rule.to }).where(eq(agentSkills.id, id));
    return { status: 200 };
  });
  return result.status === 200 ? c.json({ ok: true }) : c.json({ error: result.error }, result.status as 404 | 409);
});

agentApi.delete("/agent/skills/by-name/:name", async (c) => {
  await db.delete(agentSkills).where(eq(agentSkills.name, c.req.param("name")));
  return c.json({ ok: true });
});

/** One turn: store the user's message, run the agent, stream and store what it does. */
agentApi.post("/agent/sessions/:id/messages", async (c) => {
  const id = c.req.param("id");
  if (!idSchema.safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const parsed = turnSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
  const turn = parsed.data;
  const provider = (await getCatalog()).providers.find((p) => p.key === turn.provider);
  if (!provider) return c.json({ error: `Provider tidak dikenal: ${turn.provider}` }, 400);
  if (provider.needsUrl && !turn.backendUrl) return c.json({ error: `${provider.label} butuh Backend URL` }, 400);
  const refused = backendUrlRefused(turn.backendUrl);
  if (refused) return c.json({ error: refused }, 400);

  const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, id));
  if (!session) return c.json({ error: "Not found" }, 404);
  if (busy.has(id)) return c.json({ error: "Agent masih menjawab pesan sebelumnya" }, 409);
  const quota = await overLimit("chat");
  if (quota) return c.json({ error: quota }, 429);
  busy.add(id);

  try {
    // The context the worker needs: recent turns, what to fold into the summary, memories, drawings.
    const earlier = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.sessionId, id), session.summarizedThrough ? gt(agentMessages.id, session.summarizedThrough) : undefined))
      .orderBy(asc(agentMessages.id));
    const recent = earlier.slice(-KEEP_TURNS);
    const toSummarize = earlier.length >= SUMMARIZE_AT ? earlier.slice(0, -KEEP_TURNS) : [];
    const memories = await db
      .select({ id: agentMemories.id, scope: agentMemories.scope, content: agentMemories.content })
      .from(agentMemories)
      .where(or(and(eq(agentMemories.scope, "user"), isNull(agentMemories.symbol)), eq(agentMemories.symbol, session.symbol)));
    const drawings = await db
      .select({ kind: chartDrawings.kind, label: chartDrawings.label })
      .from(chartDrawings)
      .where(eq(chartDrawings.symbol, session.symbol));
    const skills = await db
      .select({ version: agentSkills.version, definition: agentSkills.definition })
      .from(agentSkills)
      .where(eq(agentSkills.status, "active"));

    await db.insert(agentMessages).values({ sessionId: id, role: "user", content: turn.message });
    await db
      .update(agentSessions)
      .set({ updatedAt: new Date(), title: session.title ?? turn.message.slice(0, 60) })
      .where(eq(agentSessions.id, id));

    const job = {
      ...turn,
      symbol: session.symbol,
      depth: 1,
      analysts: ["market"],
      history: recent.map((m) => ({ role: m.role, content: m.content })),
      summary: session.summary,
      toSummarize: toSummarize.map((m) => ({ role: m.role, content: m.content })),
      memories,
      drawings,
      skills,
    };

    return streamSSE(c, async (stream) => {
      const toolCalls: AgentToolCall[] = [];
      let answered = false;
      let seq = 0;
      const send = (event: string, data: object) => stream.writeSSE({ id: String(++seq), event, data: JSON.stringify(data) });

      const handle = runCommand("agent", job, async (event) => {
        const { type, ...payload } = event;
        switch (type) {
          case "tool_call":
            toolCalls.push({ name: String(payload.name), args: (payload.args as Record<string, unknown>) ?? {} });
            break;
          case "tool_result": {
            const last = [...toolCalls].reverse().find((t) => t.name === payload.name && t.summary === undefined);
            if (last) last.summary = String(payload.summary ?? "");
            break;
          }
          case "drawing": {
            const d = payload.drawing as { id: string; kind: DrawingKind; label: string; data: Record<string, unknown> };
            await db.insert(chartDrawings).values({ id: d.id, symbol: session.symbol, sessionId: id, kind: d.kind, label: d.label, data: d.data });
            break;
          }
          case "memory": {
            const m = payload.memory as { id: string; scope: "user" | "symbol"; content: string };
            await db
              .insert(agentMemories)
              .values({ id: m.id, scope: m.scope, symbol: m.scope === "symbol" ? session.symbol : null, content: m.content });
            break;
          }
          case "skill_proposed": {
            // Stored as a draft version; it stays unusable until the user approves it.
            const definition = payload.definition as SkillDefinition;
            const [{ latest }] = await db
              .select({ latest: max(agentSkills.version) })
              .from(agentSkills)
              .where(eq(agentSkills.name, definition.name));
            const [row] = await db
              .insert(agentSkills)
              .values({ name: definition.name, version: (latest ?? 0) + 1, definition, test: payload.test as never, sessionId: id })
              .returning({ id: agentSkills.id, version: agentSkills.version });
            Object.assign(payload, { id: row.id, version: row.version });
            break;
          }
          case "forget":
            await db.delete(agentMemories).where(eq(agentMemories.id, String(payload.id)));
            break;
          case "summary":
            await db
              .update(agentSessions)
              .set({ summary: String(payload.summary), summarizedThrough: toSummarize.at(-1)?.id ?? session.summarizedThrough })
              .where(eq(agentSessions.id, id));
            break;
          case "message":
            answered = true;
            await db.insert(agentMessages).values({ sessionId: id, role: "assistant", content: String(payload.content ?? ""), toolCalls });
            break;
          case "error":
            // The worker already said what went wrong, in the user's terms; no generic exit message on top.
            answered = true;
            break;
        }
        await send(type, payload);
      });

      stream.onAbort(() => handle.kill());
      try {
        const { exitCode, stderrTail } = await handle.done;
        if (!answered && !stream.aborted) {
          const tail = stderrTail.trim().split("\n").slice(-3).join("\n");
          await send("error", { message: `Agent berhenti tanpa jawaban (exit ${exitCode}).\n${tail}` });
        }
        if (!stream.aborted) await send("end", {});
      } finally {
        busy.delete(id);
      }
    });
  } catch (e) {
    busy.delete(id);
    throw e;
  }
});
