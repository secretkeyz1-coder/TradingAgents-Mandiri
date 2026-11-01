// Discount codes. An admin makes a code that takes a share of the plan price
// (percent) or rupiah off it, for some plans and periods or all, with an
// optional last day and a cap on how many orders may use it. A member types it
// when ordering (billing.ts); each account uses a code once, and founding
// prices take none. A code that brings the price to zero activates the plan at
// once. Codes are switched off, not deleted, so past orders keep their story.
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AppEnv } from "./auth";
import { db } from "./db";
import { coupons, payments } from "./db/schema";
import { PERIOD_LABEL, PLANS, type Period, type PlanId } from "../../shared/plans";

export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** What a code takes off this plan's price for this account, or why it cannot be used. */
export async function applyCoupon(raw: string, userId: string, plan: PlanId, period: Period): Promise<{ code: string; discount: number } | { error: string }> {
  const code = normalizeCode(raw);
  const [coupon] = await db.select().from(coupons).where(eq(coupons.code, code));
  if (!coupon || !coupon.active) return { error: "Kode kupon tidak dikenal" };
  if (coupon.expiresAt && coupon.expiresAt.getTime() <= Date.now()) return { error: "Kupon ini sudah berakhir" };
  if (coupon.plans.length && !coupon.plans.includes(plan)) return { error: `Kupon ini tidak berlaku untuk paket ${PLANS[plan].name}` };
  if (coupon.periods.length && !coupon.periods.includes(period)) {
    return { error: `Kupon ini hanya untuk langganan ${coupon.periods.map((p) => `per ${PERIOD_LABEL[p]}`).join(" atau ")}` };
  }
  const [mine] = await db
    .select({ n: count() })
    .from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.couponCode, code), eq(payments.status, "paid")));
  if (mine.n) return { error: "Kupon ini sudah kamu pakai" };
  if (coupon.maxUses != null) {
    // Paid orders and others' open ones count; this account's own open order is replaced by the new one.
    const [taken] = await db
      .select({ n: count() })
      .from(payments)
      .where(and(eq(payments.couponCode, code), ne(payments.userId, userId), inArray(payments.status, ["pending", "claimed", "paid"])));
    if (taken.n >= coupon.maxUses) return { error: "Kuota kupon ini sudah habis" };
  }
  const price = PLANS[plan].price[period];
  const off = coupon.kind === "percent" ? Math.round((price * coupon.value) / 100) : coupon.value;
  return { code, discount: Math.min(price, off) };
}

export const couponsApi = new Hono<AppEnv>();

couponsApi.use("/admin/*", requireAdmin);

couponsApi.get("/admin/coupons", async (c) => {
  const rows = await db.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(200);
  const used = await db
    .select({
      code: payments.couponCode,
      paid: sql<number>`count(*) filter (where ${payments.status} = 'paid')::int`,
      open: sql<number>`count(*) filter (where ${payments.status} in ('pending', 'claimed'))::int`,
      discount: sql<number>`coalesce(sum(${payments.discount}) filter (where ${payments.status} = 'paid'), 0)::int`,
    })
    .from(payments)
    .where(sql`${payments.couponCode} is not null`)
    .groupBy(payments.couponCode);
  const byCode = new Map(used.map((u) => [u.code, u]));
  return c.json(
    rows.map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind,
      value: r.value,
      plans: r.plans,
      periods: r.periods,
      maxUses: r.maxUses,
      expiresAt: r.expiresAt,
      active: r.active,
      note: r.note,
      createdAt: r.createdAt,
      paid: byCode.get(r.code)?.paid ?? 0,
      open: byCode.get(r.code)?.open ?? 0,
      discountGiven: byCode.get(r.code)?.discount ?? 0,
    })),
  );
});

const createSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{3,24}$/, "Kode 3–24 huruf, angka, - atau _"),
    kind: z.enum(["percent", "amount"]),
    value: z.number().int().positive(),
    plans: z.array(z.enum(["pro", "creator"])).max(2).default([]),
    periods: z.array(z.enum(["month", "year"])).max(2).default([]),
    maxUses: z.number().int().positive().nullable().default(null),
    /** The last day it works, "2026-12-31", through the end of that day in WIB. */
    lastDay: z.iso.date().nullable().default(null),
    note: z.string().trim().max(200).nullable().default(null),
  })
  .refine((b) => b.kind !== "percent" || b.value <= 100, { message: "Persen diskon maksimal 100", path: ["value"] });

couponsApi.post("/admin/coupons", async (c) => {
  const body = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const b = body.data;
  const expiresAt = b.lastDay ? new Date(`${b.lastDay}T23:59:59.999+07:00`) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) return c.json({ error: "Hari terakhirnya sudah lewat" }, 400);
  const [row] = await db
    .insert(coupons)
    .values({
      code: normalizeCode(b.code),
      kind: b.kind,
      value: b.value,
      plans: b.plans,
      periods: b.periods,
      maxUses: b.maxUses,
      expiresAt,
      note: b.note || null,
      createdBy: c.get("user").id,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return c.json({ error: "Kode itu sudah dipakai kupon lain" }, 409);
  return c.json(row, 201);
});

couponsApi.patch("/admin/coupons/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = z.object({ active: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Isi active: true atau false" }, 400);
  const [row] = await db.update(coupons).set({ active: body.data.active }).where(eq(coupons.id, id)).returning();
  return row ? c.json(row) : c.json({ error: "Not found" }, 404);
});
