// The chart's indicator catalog and who may use it. The built-in engines (Scalper Pro+, PoB
// BYSTRA, Fib Golden Zone) and the script indicators an admin publishes each name the plans
// that see them, and an admin can open one to named accounts too (indicator_grants). An admin
// always sees all of them. Everyone else sees, draws and gets notified about only what this
// allows: GET /api/indicators feeds the chart's menu, and the alert routes and scan (alerts.ts)
// and the lab (lab.ts) ask the same question. A built-in is keyed by its engine's name, a
// published script by "catalog:<id>"; a member's own scripts ("script:<id>") are theirs and
// not gated here. A published script's source is copied into its row, so it runs the same for
// everyone until an admin changes it here.
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AppEnv, type User } from "./auth";
import { openCreatorSignals } from "./creators";
import { db } from "./db";
import { indicatorGrants, indicators, signalAlerts, signalEvents, users, type SignalIndicator } from "./db/schema";
import { planOf } from "./plans";
import { PLAN_IDS, type PlanId } from "../../shared/plans";
import { SCRIPT_LIMITS } from "../../shared/script";

export type IndicatorRow = typeof indicators.$inferSelect;
export const CATALOG_KEY = /^catalog:([0-9a-f-]{36})$/;
/** The key alerts, the lab and the chart use for a catalog row. */
export const keyOf = (row: Pick<IndicatorRow, "id" | "builtin">): SignalIndicator => row.builtin ?? `catalog:${row.id}`;

type Owner = Pick<User, "id" | "role" | "plan" | "planUntil">;

/** The catalog keys each of these accounts may use, read in two queries however many accounts there are. */
export async function usableKeys(owners: Owner[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!owners.length) return out;
  const [rows, grants] = await Promise.all([
    db.select({ id: indicators.id, builtin: indicators.builtin, plans: indicators.plans, active: indicators.active }).from(indicators),
    db.select().from(indicatorGrants).where(inArray(indicatorGrants.userId, [...new Set(owners.map((o) => o.id))])),
  ]);
  for (const o of owners) {
    const granted = new Set(grants.filter((g) => g.userId === o.id).map((g) => g.indicatorId));
    const plan = planOf(o);
    const open = rows.filter((r) => o.role === "admin" || (r.active && (r.plans.includes(plan) || granted.has(r.id))));
    out.set(o.id, new Set(open.map(keyOf)));
  }
  return out;
}

/** Whether this account may use the indicator with this key; a member's own script is always theirs to use. */
export async function canUse(user: Owner, key: string): Promise<boolean> {
  if (key.startsWith("script:")) return true;
  return (await usableKeys([user])).get(user.id)?.has(key) ?? false;
}

/** The catalog rows this account may use, in the menu's order. */
export async function usableRows(user: Owner): Promise<IndicatorRow[]> {
  const keys = (await usableKeys([user])).get(user.id) ?? new Set<string>();
  const rows = await db.select().from(indicators).orderBy(asc(indicators.sortOrder), asc(indicators.name));
  return rows.filter((r) => keys.has(keyOf(r)));
}

/** The published scripts by key, for the scan to run and for names in lists and history; a removed one has none. */
export async function catalogScripts(): Promise<Map<string, { name: string; code: string }>> {
  const rows = await db.select({ id: indicators.id, name: indicators.name, code: indicators.code }).from(indicators).where(isNull(indicators.builtin));
  return new Map(rows.map((r) => [`catalog:${r.id}`, { name: r.name, code: r.code ?? "" }]));
}

const view = (r: IndicatorRow) => ({
  id: r.id,
  key: keyOf(r),
  builtin: r.builtin,
  name: r.name,
  description: r.description,
  code: r.code,
  plans: r.plans,
  defaultOn: r.defaultOn,
  active: r.active,
  sortOrder: r.sortOrder,
  updatedAt: r.updatedAt,
});

export const indicatorsApi = new Hono<AppEnv>();
/** Mounted before sign-in: the pricing page lists what each plan opens. */
export const indicatorsPublicApi = new Hono<AppEnv>();

/** What the chart's Indikator menu offers this account, with a published script's source for the browser's sandbox. */
indicatorsApi.get("/indicators", async (c) => {
  const rows = await usableRows(c.get("user"));
  return c.json({
    // `active` is false only in an admin's menu: what members no longer see.
    items: rows.map((r) => ({ key: keyOf(r), builtin: r.builtin, name: r.name, description: r.description, defaultOn: r.defaultOn, active: r.active, code: r.code })),
  });
});

/** What the pricing page lists: indicators open to at least one plan; one kept to named accounts is not on offer. */
indicatorsPublicApi.get("/public/indicators", async (c) => {
  const rows = await db.select().from(indicators).where(eq(indicators.active, true)).orderBy(asc(indicators.sortOrder), asc(indicators.name));
  return c.json(rows.filter((r) => r.plans.length).map((r) => ({ name: r.name, description: r.description, plans: r.plans })));
});

indicatorsApi.use("/admin/indicators", requireAdmin);
indicatorsApi.use("/admin/indicators/*", requireAdmin);

/** Every indicator with its plans, the accounts granted it, and how many signal notifications use it. */
indicatorsApi.get("/admin/indicators", async (c) => {
  const [rows, grants, inUse] = await Promise.all([
    db.select().from(indicators).orderBy(asc(indicators.sortOrder), asc(indicators.name)),
    db
      .select({ indicatorId: indicatorGrants.indicatorId, id: users.id, username: users.username, email: users.email })
      .from(indicatorGrants)
      .innerJoin(users, eq(indicatorGrants.userId, users.id))
      .orderBy(asc(users.username)),
    db.select({ indicator: signalAlerts.indicator, n: count() }).from(signalAlerts).groupBy(signalAlerts.indicator),
  ]);
  const alerts = new Map(inUse.map((a) => [a.indicator, a.n]));
  return c.json(
    rows.map((r) => ({
      ...view(r),
      grants: grants.filter((g) => g.indicatorId === r.id).map(({ id, username, email }) => ({ id, username, email })),
      alerts: alerts.get(keyOf(r)) ?? 0,
    })),
  );
});

const plans = z
  .array(z.enum(PLAN_IDS))
  .max(PLAN_IDS.length)
  .transform((list) => PLAN_IDS.filter((p): p is PlanId => list.includes(p)));
const fields = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(60),
  description: z.string().trim().max(200),
  code: z
    .string()
    .trim()
    .min(1, "Isi kode skripnya")
    .max(SCRIPT_LIMITS.maxCode, `Kode terlalu panjang (maksimal ${SCRIPT_LIMITS.maxCode.toLocaleString("id-ID")} karakter)`),
  plans,
  defaultOn: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
});
const issues = (e: z.ZodError) => e.issues.map((i) => i.message).join("; ");

/** Publish a script as an indicator: its source is copied here. */
indicatorsApi.post("/admin/indicators", async (c) => {
  const body = fields.partial({ description: true, plans: true, defaultOn: true, active: true, sortOrder: true }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: issues(body.error) }, 400);
  const [row] = await db.insert(indicators).values({ description: "", ...body.data }).returning();
  return c.json(view(row), 201);
});

indicatorsApi.patch("/admin/indicators/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Indikator tidak ditemukan" }, 404);
  const body = fields.partial().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: issues(body.error) }, 400);
  const [row] = await db.select().from(indicators).where(eq(indicators.id, id));
  if (!row) return c.json({ error: "Indikator tidak ditemukan" }, 404);
  // A built-in's name is the one its signal messages and the public pages use; its engine lives in the code base.
  if (row.builtin && body.data.code !== undefined) return c.json({ error: "Kode indikator bawaan tidak bisa diubah di sini" }, 400);
  if (row.builtin && body.data.name !== undefined && body.data.name !== row.name) return c.json({ error: "Nama indikator bawaan tidak bisa diubah" }, 400);
  const [updated] = await db
    .update(indicators)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(indicators.id, id))
    .returning();
  return c.json(view(updated));
});

/** A published script goes with the signal notifications that use it; their calls stay in their owners' history. A built-in only switches off. */
indicatorsApi.delete("/admin/indicators/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ ok: true, alerts: 0 });
  const [row] = await db.select().from(indicators).where(eq(indicators.id, id));
  if (!row) return c.json({ ok: true, alerts: 0 });
  if (row.builtin) return c.json({ error: "Indikator bawaan tidak bisa dihapus. Matikan saja agar tersembunyi dari semua member." }, 400);
  const using = await db.select().from(signalAlerts).where(eq(signalAlerts.indicator, keyOf(row)));
  // An alert's scan scores the public record's open signals, so none goes while one runs (as when a member removes it, alerts.ts).
  for (const a of using) {
    if (await openCreatorSignals(a.id)) {
      return c.json({ error: "Indikator ini dipakai sinyal publik creator yang masih berjalan. Matikan dulu agar tidak ada sinyal baru, lalu hapus setelah sinyalnya selesai." }, 409);
    }
  }
  await db.transaction(async (tx) => {
    // Signals stay in their owners' history; one recorded before they carried their pair takes it now.
    for (const a of using) {
      await tx
        .update(signalEvents)
        .set({ userId: a.userId, symbol: a.symbol, tvSymbol: a.tvSymbol, indicator: a.indicator, timeframe: a.timeframe, venue: a.venue })
        .where(and(eq(signalEvents.alertId, a.id), isNull(signalEvents.userId)));
    }
    await tx.delete(signalAlerts).where(eq(signalAlerts.indicator, keyOf(row)));
    await tx.delete(indicators).where(eq(indicators.id, id));
  });
  return c.json({ ok: true, alerts: using.length });
});

/** The accounts that may use an indicator whatever their plan, replaced as a whole. */
indicatorsApi.put("/admin/indicators/:id/grants", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Indikator tidak ditemukan" }, 404);
  const body = z.object({ userIds: z.array(z.uuid()).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Daftar pengguna tidak valid" }, 400);
  const [row] = await db.select({ id: indicators.id }).from(indicators).where(eq(indicators.id, id));
  if (!row) return c.json({ error: "Indikator tidak ditemukan" }, 404);
  const ids = [...new Set(body.data.userIds)];
  const known = ids.length ? await db.select({ id: users.id }).from(users).where(inArray(users.id, ids)) : [];
  await db.transaction(async (tx) => {
    await tx.delete(indicatorGrants).where(eq(indicatorGrants.indicatorId, id));
    if (known.length) await tx.insert(indicatorGrants).values(known.map((u) => ({ indicatorId: id, userId: u.id }))).onConflictDoNothing();
  });
  const grants = await db
    .select({ id: users.id, username: users.username, email: users.email })
    .from(indicatorGrants)
    .innerJoin(users, eq(indicatorGrants.userId, users.id))
    .where(eq(indicatorGrants.indicatorId, id))
    .orderBy(asc(users.username));
  return c.json({ grants });
});
