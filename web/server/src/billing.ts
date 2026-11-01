// Subscriptions paid by bank transfer or QRIS and confirmed by an admin, until a
// payment gateway takes over. A member picks a plan and period, and may give a
// coupon (coupons.ts); the order gets a reference and a unique code added to the
// price, so one line on the bank statement matches one order. The member says
// when it is paid, admins hear of it (Telegram and e-mail), and an admin's
// confirmation extends the plan: from its current end when the same plan is
// still running, else from now. A coupon that takes the whole price activates
// the plan at once. Every order has an invoice page (invoice.ts), linked from
// its e-mails. PAYMENT_INSTRUCTIONS (bank, account number and name, QRIS; "\n"
// for a new line) goes with every order; without it members cannot order yet.
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, type AppEnv } from "./auth";
import { applyCoupon } from "./coupons";
import { db } from "./db";
import { payments, users } from "./db/schema";
import { invoiceLink, invoicePath, renderInvoice, verifyInvoice } from "./invoice";
import { composeMail, sendMail } from "./mail";
import { planOf } from "./plans";
import { FOUNDING, PERIOD_LABEL, PLANS, rupiah, TRIAL_DAYS, type Period } from "../../shared/plans";
import { escape, publicUrl, sendTelegram } from "./watch";

const INSTRUCTIONS = (process.env.PAYMENT_INSTRUCTIONS ?? "").replace(/\\n/g, "\n").trim();
/** An order not paid within this many days lapses. */
export const ORDER_DAYS = 3;
const DAY_MS = 86_400_000;
const OPEN = ["pending", "claimed"] as const;

type Payment = typeof payments.$inferSelect;
type Owner = typeof users.$inferSelect;
const publicPayment = (p: Payment) => ({
  id: p.id,
  reference: p.reference,
  plan: p.plan,
  period: p.period,
  founding: p.founding,
  amount: p.amount,
  uniqueCode: p.uniqueCode,
  couponCode: p.couponCode,
  discount: p.discount,
  status: p.status,
  note: p.note,
  adminNote: p.adminNote,
  createdAt: p.createdAt,
  claimedAt: p.claimedAt,
  paidAt: p.paidAt,
  periodStart: p.periodStart,
  periodEnd: p.periodEnd,
  invoiceUrl: invoicePath(p.id),
});

/** "Pro per bulan", "Pro founding per bulan". */
export const label = (p: Pick<Payment, "plan" | "period" | "founding">) => `${PLANS[p.plan].name}${p.founding ? " founding" : ""} per ${PERIOD_LABEL[p.period]}`;
const day = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" });
/** An e-mail's invoice button, when the server knows its public address. */
const invoiceButton = (p: Payment, text: string) => (invoiceLink(p.id) ? { label: text, url: invoiceLink(p.id) } : undefined);

function addPeriod(from: Date, period: Period): Date {
  const d = new Date(from);
  if (period === "year") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

/** Orders left unpaid too long lapse; checked whenever orders are read. */
async function lapseOld() {
  await db
    .update(payments)
    .set({ status: "cancelled", adminNote: `Kedaluwarsa: tidak dibayar dalam ${ORDER_DAYS} hari` })
    .where(and(eq(payments.status, "pending"), lt(payments.createdAt, new Date(Date.now() - ORDER_DAYS * DAY_MS))));
}

/** Founding seats left, and whether this account holds one already (its price stays while it subscribes). */
async function founding(userId: string) {
  const holders = await db
    .selectDistinct({ userId: payments.userId })
    .from(payments)
    .where(and(eq(payments.founding, true), eq(payments.status, "paid"), sql`${payments.amount} > 0`));
  return { price: FOUNDING.price, left: Math.max(0, FOUNDING.seats - holders.length), mine: holders.some((h) => h.userId === userId) };
}

/** Admins hear about a payment to check, by Telegram and e-mail, whichever they have. */
async function tellAdmins(html: string, subject: string, lines: string[]) {
  const admins = await db.select().from(users).where(and(eq(users.role, "admin"), eq(users.disabled, false)));
  for (const a of admins) {
    if (a.telegramChatId) await sendTelegram(a.telegramChatId, html);
    if (a.email) await sendMail(composeMail(a.email, subject, lines));
  }
}

/**
 * Mark an order paid and give its plan, from the end of the same plan still
 * running or else from now, and tell the owner. Null when the order was
 * settled meanwhile.
 */
async function activate(order: Payment, owner: Owner, by: string | null, note: string | null) {
  const now = new Date();
  const start = planOf(owner) === order.plan && owner.planUntil && owner.planUntil > now ? owner.planUntil : now;
  const end = addPeriod(start, order.period);
  const [paid] = await db
    .update(payments)
    .set({ status: "paid", paidAt: now, periodStart: start, periodEnd: end, confirmedBy: by, adminNote: note })
    .where(and(eq(payments.id, order.id), inArray(payments.status, [...OPEN])))
    .returning();
  if (!paid) return null;
  await db.update(users).set({ plan: order.plan, planUntil: end }).where(eq(users.id, owner.id));
  const lines = [
    `Halo ${owner.username},`,
    paid.amount > 0
      ? `Pembayaran ${rupiah(paid.amount)} untuk ${label(paid)} sudah kami terima (referensi ${paid.reference}).`
      : `Kupon ${paid.couponCode} menanggung seluruh harga ${label(paid)} (referensi ${paid.reference}).`,
    `Paket ${PLANS[paid.plan].name} aktif sampai ${day(end)}. Terima kasih!`,
  ];
  if (owner.email) await sendMail(composeMail(owner.email, `Pembayaran diterima: ${paid.reference}`, lines, invoiceButton(paid, "Lihat bukti pembayaran")));
  if (owner.telegramChatId) {
    await sendTelegram(owner.telegramChatId, `<b>✅ Pembayaran diterima</b>\n${escape(label(paid))} · ${rupiah(paid.amount)}\nAktif sampai ${escape(day(end))}`);
  }
  return paid;
}

export const billingApi = new Hono<AppEnv>();

billingApi.get("/billing", async (c) => {
  const user = c.get("user");
  await lapseOld();
  const orders = await db.select().from(payments).where(eq(payments.userId, user.id)).orderBy(desc(payments.createdAt)).limit(30);
  return c.json({
    open: Boolean(INSTRUCTIONS),
    instructions: INSTRUCTIONS,
    orderDays: ORDER_DAYS,
    founding: await founding(user.id),
    orders: orders.map(publicPayment),
  });
});

/** What a coupon takes off each plan for the chosen period, or why it does not apply. */
billingApi.get("/billing/coupon", async (c) => {
  const q = z.object({ code: z.string().trim().min(1).max(40), period: z.enum(["month", "year"]) }).safeParse(c.req.query());
  if (!q.success) return c.json({ error: "Isi kode kuponnya" }, 400);
  const user = c.get("user");
  const plans: Partial<Record<"pro" | "creator", { discount: number; total: number } | { error: string }>> = {};
  for (const plan of ["pro", "creator"] as const) {
    const r = await applyCoupon(q.data.code, user.id, plan, q.data.period);
    plans[plan] = "error" in r ? { error: r.error } : { discount: r.discount, total: PLANS[plan].price[q.data.period] - r.discount };
  }
  return c.json({ code: q.data.code.toUpperCase(), plans });
});

const orderSchema = z.object({
  plan: z.enum(["pro", "creator"]),
  period: z.enum(["month", "year"]),
  founding: z.boolean().optional(),
  coupon: z.string().trim().max(40).optional(),
});

billingApi.post("/billing/orders", async (c) => {
  const user = c.get("user");
  if (user.role === "admin") return c.json({ error: "Akun admin tidak perlu berlangganan" }, 400);
  if (!INSTRUCTIONS) return c.json({ error: "Pembayaran belum dibuka. Hubungi admin." }, 503);
  const body = orderSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Pilihan paket tidak valid" }, 400);
  const { plan, period } = body.data;
  const code = body.data.coupon ?? "";
  const seat = body.data.founding ? await founding(user.id) : null;
  if (seat && (plan !== "pro" || period !== "month")) return c.json({ error: "Harga founding hanya untuk Pro bulanan" }, 400);
  if (seat && !seat.mine && seat.left <= 0) return c.json({ error: "Kursi founding member sudah habis" }, 409);
  if (seat && code) return c.json({ error: "Kupon tidak berlaku untuk harga founding" }, 400);
  let discount = 0;
  let couponCode: string | null = null;
  if (code) {
    const r = await applyCoupon(code, user.id, plan, period);
    if ("error" in r) return c.json({ error: r.error }, 400);
    discount = r.discount;
    couponCode = r.code;
  }
  await lapseOld();
  const open = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userId, user.id), inArray(payments.status, [...OPEN])));
  if (open.some((p) => p.status === "claimed")) return c.json({ error: "Pembayaranmu sebelumnya sedang diperiksa admin. Tunggu konfirmasinya dulu." }, 409);
  // A new order replaces an unpaid one.
  if (open.length) {
    await db
      .update(payments)
      .set({ status: "cancelled", adminNote: "Diganti pesanan baru" })
      .where(inArray(
        payments.id,
        open.map((p) => p.id),
      ));
  }
  const price = (seat ? FOUNDING.price : PLANS[plan].price[period]) - discount;
  // A code no other open order of the same price uses, so the amount transferred names the order.
  // An order the coupon pays in full needs no transfer and so no code.
  let uniqueCode = 0;
  if (price > 0) {
    const taken = new Set(
      (
        await db
          .select({ code: payments.uniqueCode })
          .from(payments)
          .where(and(inArray(payments.status, [...OPEN]), sql`${payments.amount} - ${payments.uniqueCode} = ${price}`))
      ).map((r) => r.code),
    );
    for (let i = 0; i < 300 && (!uniqueCode || taken.has(uniqueCode)); i++) uniqueCode = 1 + Math.floor(Math.random() * 999);
  }
  let row: Payment | undefined;
  for (let i = 0; i < 5 && !row; i++) {
    [row] = await db
      .insert(payments)
      .values({
        userId: user.id,
        reference: `INV-${randomBytes(4).toString("hex").toUpperCase()}`,
        plan,
        period,
        founding: Boolean(seat),
        amount: price + uniqueCode,
        uniqueCode,
        couponCode,
        discount,
      })
      .onConflictDoNothing()
      .returning();
  }
  if (!row) return c.json({ error: "Gagal membuat pesanan, coba lagi" }, 500);
  if (price === 0) {
    const paid = await activate(row, user, null, `Kupon ${couponCode}`);
    return c.json(publicPayment(paid ?? row), 201);
  }
  if (user.email) {
    await sendMail(
      composeMail(
        user.email,
        `Pesanan ${row.reference}: ${label(row)}`,
        [
          `Halo ${user.username},`,
          `Terima kasih sudah memesan ${label(row)}.${row.discount ? ` Kupon ${row.couponCode} memotong ${rupiah(row.discount)}.` : ""} Transfer tepat ${rupiah(row.amount)} dalam ${ORDER_DAYS} hari; tiga digit terakhirnya (${row.uniqueCode}) adalah kode unik pesananmu.`,
          ...INSTRUCTIONS.split("\n"),
          'Setelah membayar, buka menu akun → Paket & tagihan dan tekan "Saya sudah bayar". Paket aktif setelah admin memeriksa pembayaranmu.',
        ],
        invoiceButton(row, "Lihat tagihan"),
      ),
    );
  }
  return c.json(publicPayment(row), 201);
});

billingApi.post("/billing/orders/:id/claim", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = z.object({ note: z.string().trim().max(300).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const [row] = await db
    .update(payments)
    .set({ status: "claimed", claimedAt: new Date(), note: body.success ? body.data.note || null : null })
    .where(and(eq(payments.id, id), eq(payments.userId, user.id), eq(payments.status, "pending")))
    .returning();
  if (!row) return c.json({ error: "Pesanan tidak ditemukan atau sudah diproses" }, 404);
  const where = publicUrl() ? `\n<a href="${publicUrl()}/app">Buka app</a>, menu akun → Pembayaran` : "";
  await tellAdmins(
    `<b>💳 Pembayaran diklaim</b>\n${escape(user.username)}${user.email ? ` · ${escape(user.email)}` : ""}\n${escape(label(row))} · <b>${rupiah(row.amount)}</b> · ${row.reference}${row.note ? `\nCatatan: ${escape(row.note)}` : ""}${where}`,
    `Pembayaran diklaim: ${row.reference} (${rupiah(row.amount)})`,
    [
      `${user.username}${user.email ? ` (${user.email})` : ""} menyatakan sudah membayar ${label(row)}: ${rupiah(row.amount)}, referensi ${row.reference}.`,
      ...(row.note ? [`Catatan: ${row.note}`] : []),
      "Periksa mutasi rekening, lalu konfirmasi di menu akun → Pembayaran.",
    ],
  );
  return c.json(publicPayment(row));
});

billingApi.post("/billing/orders/:id/cancel", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const [row] = await db
    .update(payments)
    .set({ status: "cancelled", adminNote: "Dibatalkan pemesan" })
    .where(and(eq(payments.id, id), eq(payments.userId, c.get("user").id), inArray(payments.status, [...OPEN])))
    .returning();
  return row ? c.json(publicPayment(row)) : c.json({ error: "Pesanan tidak ditemukan atau sudah diproses" }, 404);
});

// --------------------------------------------------------------------------- admin

billingApi.use("/admin/*", requireAdmin);

billingApi.get("/admin/payments", async (c) => {
  await lapseOld();
  const status = c.req.query("status");
  const rows = await db
    .select({ payment: payments, username: users.username, email: users.email, phone: users.phone })
    .from(payments)
    .innerJoin(users, eq(payments.userId, users.id))
    .where(status === "open" ? inArray(payments.status, [...OPEN]) : status === "paid" ? eq(payments.status, "paid") : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(200);
  return c.json(rows.map((r) => ({ ...publicPayment(r.payment), user: { username: r.username, email: r.email, phone: r.phone } })));
});

billingApi.post("/admin/payments/:id/confirm", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = z.object({ note: z.string().trim().max(300).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const [order] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), inArray(payments.status, [...OPEN])));
  const [owner] = order ? await db.select().from(users).where(eq(users.id, order.userId)) : [];
  if (!order || !owner) return c.json({ error: "Pesanan tidak ditemukan atau sudah diproses" }, 404);
  const paid = await activate(order, owner, c.get("user").id, body.success ? body.data.note || null : null);
  return paid ? c.json(publicPayment(paid)) : c.json({ error: "Pesanan sudah diproses" }, 409);
});

billingApi.post("/admin/payments/:id/reject", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = z.object({ reason: z.string().trim().min(3, "Tulis alasannya").max(300) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const [row] = await db
    .update(payments)
    .set({ status: "rejected", adminNote: body.data.reason, confirmedBy: c.get("user").id })
    .where(and(eq(payments.id, id), inArray(payments.status, [...OPEN])))
    .returning();
  if (!row) return c.json({ error: "Pesanan tidak ditemukan atau sudah diproses" }, 404);
  const [owner] = await db.select().from(users).where(eq(users.id, row.userId));
  if (owner?.email) {
    await sendMail(
      composeMail(owner.email, `Pembayaran ${row.reference} belum bisa dikonfirmasi`, [
        `Halo ${owner.username},`,
        `Pembayaran untuk pesanan ${row.reference} (${label(row)}, ${rupiah(row.amount)}) belum bisa kami konfirmasi: ${body.data.reason}`,
        "Kalau kamu sudah mentransfer, balas email ini dengan bukti transfernya.",
      ]),
    );
  }
  return c.json(publicPayment(row));
});

/** The numbers an admin checks first: members, plans, trials, orders waiting, money in. */
billingApi.get("/admin/overview", async (c) => {
  const wib = new Date(Date.now() + 7 * 3_600_000);
  const monthStart = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), 1) - 7 * 3_600_000).toISOString();
  const member = sql`${users.role} <> 'admin'`;
  const running = sql`(${users.planUntil} is null or ${users.planUntil} > now())`;
  const [people] = await db
    .select({
      members: sql<number>`count(*) filter (where ${member})::int`,
      newWeek: sql<number>`count(*) filter (where ${member} and ${users.createdAt} > now() - interval '7 days')::int`,
      verified: sql<number>`count(*) filter (where ${member} and ${users.emailVerifiedAt} is not null)::int`,
      pro: sql<number>`count(*) filter (where ${member} and ${users.plan} = 'pro' and ${running})::int`,
      creator: sql<number>`count(*) filter (where ${member} and ${users.plan} = 'creator' and ${running})::int`,
      trials: sql<number>`count(*) filter (where ${member} and ${users.trialStartedAt} is not null and ${users.plan} <> 'free' and ${users.planUntil} > now() and ${users.planUntil} - ${users.trialStartedAt} <= make_interval(days => ${TRIAL_DAYS}, mins => 1))::int`,
    })
    .from(users);
  const [money] = await db
    .select({
      month: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'paid' and ${payments.paidAt} >= ${monthStart}::timestamptz), 0)::int`,
      last30: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.status} = 'paid' and ${payments.paidAt} > now() - interval '30 days'), 0)::int`,
      open: sql<number>`count(*) filter (where ${payments.status} in ('pending', 'claimed'))::int`,
      claimed: sql<number>`count(*) filter (where ${payments.status} = 'claimed')::int`,
    })
    .from(payments);
  return c.json({ ...people, revenue: { month: money.month, last30: money.last30 }, orders: { open: money.open, claimed: money.claimed } });
});

// --------------------------------------------------------------------------- invoice page

/** The invoice page lives outside /api: its signed link is the key, so it opens from an e-mail without signing in. */
export const invoicePages = new Hono();

invoicePages.get("/invoice/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success || !verifyInvoice(id, c.req.query("t") ?? "")) return c.text("Tautan tagihan tidak valid.", 404);
  const [row] = await db
    .select({ payment: payments, username: users.username, email: users.email, phone: users.phone })
    .from(payments)
    .innerJoin(users, eq(payments.userId, users.id))
    .where(eq(payments.id, id));
  if (!row) return c.text("Tagihan tidak ditemukan.", 404);
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex");
  return c.html(renderInvoice(row.payment, row, { orderDays: ORDER_DAYS, instructions: INSTRUCTIONS }));
});
