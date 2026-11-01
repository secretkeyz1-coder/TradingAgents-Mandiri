// The business dashboard for admins: who pays and for which plan, the monthly
// recurring revenue that makes, money in per month, how trials convert, the
// renewals coming up and the paid plans that lapsed, coupon use, and what the
// model work costs in tokens (tokens.ts). Amounts leave out the unique codes.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { googleEnabled, requireAdmin, signupOpen, type AppEnv } from "./auth";
import { config } from "./config";
import { db } from "./db";
import { payments, users } from "./db/schema";
import { mailEnabled } from "./mail";
import { tokenSummary } from "./tokens";
import { telegramBot } from "./watch";
import { getCatalog } from "./worker";
import { TRIAL_DAYS } from "../../shared/plans";

const DAY_MS = 86_400_000;
const member = sql`${users.role} <> 'admin'`;
/** A paid order that cost money, as opposed to one a coupon paid in full. */
const realPaid = sql`p.status = 'paid' and p.amount > 0`;

/** "2026-11" for the last `n` months in WIB, oldest first. */
function lastMonths(n: number): string[] {
  const wib = new Date(Date.now() + 7 * 3_600_000);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export const businessApi = new Hono<AppEnv>();

businessApi.use("/admin/*", requireAdmin);

businessApi.get("/admin/business", async (c) => {
  // Every member on a plan now, with the payment that bought the period running (none for a trial or a grant).
  const current = await db
    .select({
      username: users.username,
      plan: users.plan,
      planUntil: users.planUntil,
      trialStartedAt: users.trialStartedAt,
      period: payments.period,
      amount: payments.amount,
      uniqueCode: payments.uniqueCode,
    })
    .from(users)
    .leftJoin(payments, and(eq(payments.userId, users.id), eq(payments.status, "paid"), eq(payments.periodEnd, users.planUntil)))
    .where(and(member, sql`${users.plan} <> 'free'`, sql`(${users.planUntil} is null or ${users.planUntil} > now())`));

  const paid = { pro: { month: 0, year: 0 }, creator: { month: 0, year: 0 } };
  let mrr = 0;
  let trials = 0;
  let granted = 0;
  const upcoming: { username: string; plan: string; until: Date }[] = [];
  for (const r of current) {
    if (r.plan === "free") continue;
    if (r.period && r.amount && r.amount > 0) {
      paid[r.plan][r.period]++;
      mrr += (r.amount - (r.uniqueCode ?? 0)) / (r.period === "year" ? 12 : 1);
      if (r.planUntil && r.planUntil.getTime() - Date.now() <= 30 * DAY_MS) upcoming.push({ username: r.username, plan: r.plan, until: r.planUntil });
    } else if (r.trialStartedAt && r.planUntil && r.planUntil.getTime() - r.trialStartedAt.getTime() <= TRIAL_DAYS * DAY_MS + 60_000) {
      trials++;
    } else {
      granted++;
    }
  }
  upcoming.sort((a, b) => a.until.getTime() - b.until.getTime());

  const month = sql<string>`to_char(${payments.paidAt} at time zone 'Asia/Jakarta', 'YYYY-MM')`;
  const months = await db
    .select({ month, amount: sql<number>`sum(${payments.amount} - ${payments.uniqueCode})::float8`, orders: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.status, "paid"), gt(payments.amount, 0), sql`${payments.paidAt} > now() - interval '12 months'`))
    .groupBy(month);
  const byMonth = new Map(months.map((m) => [m.month, m]));

  // Trials started in the last 90 days, and how many of those accounts went on to pay.
  const [conversion] = await db
    .select({
      trials: sql<number>`count(*)::int`,
      converted: sql<number>`count(*) filter (where exists (select 1 from ${payments} p where p.user_id = ${users.id} and ${realPaid} and p.paid_at >= ${users.trialStartedAt}))::int`,
    })
    .from(users)
    .where(and(member, sql`${users.trialStartedAt} > now() - interval '90 days'`));

  // Paid plans that ended in the last 30 days and were not renewed.
  const [lapsed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        member,
        sql`${users.planUntil} between now() - interval '30 days' and now()`,
        sql`exists (select 1 from ${payments} p where p.user_id = ${users.id} and ${realPaid} and p.period_end = ${users.planUntil})`,
      ),
    );

  const coupons = await db
    .select({ code: payments.couponCode, uses: sql<number>`count(*)::int`, discount: sql<number>`sum(${payments.discount})::float8` })
    .from(payments)
    .where(and(eq(payments.status, "paid"), sql`${payments.couponCode} is not null`))
    .groupBy(payments.couponCode)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return c.json({
    subscribers: { paid, trials, granted },
    mrr: Math.round(mrr),
    revenue: lastMonths(12).map((m) => ({ month: m, amount: byMonth.get(m)?.amount ?? 0, orders: byMonth.get(m)?.orders ?? 0 })),
    conversion,
    renewals: {
      week: upcoming.filter((u) => u.until.getTime() - Date.now() <= 7 * DAY_MS).length,
      month: upcoming.length,
      soon: upcoming.slice(0, 8),
    },
    lapsed: lapsed.n,
    coupons,
    tokens: await tokenSummary(),
  });
});

/**
 * How the server is set up, for the admin console's settings page: switches and
 * states only, never a key, a password or a backend address. They are changed in
 * web/deploy/.env and take effect when the container restarts.
 */
businessApi.get("/admin/config", async (c) => {
  const catalog = await getCatalog().catch(() => null);
  return c.json({
    signup: signupOpen(),
    publicSite: process.env.PUBLIC_SITE === "on",
    publicUrl: process.env.PUBLIC_URL || null,
    google: googleEnabled(),
    telegram: telegramBot(),
    mail: mailEnabled(),
    reminders: process.env.REMINDERS !== "off",
    payments: Boolean(process.env.PAYMENT_INSTRUCTIONS?.trim()),
    siteBrief: process.env.SITE_BRIEF !== "off",
    tokenCost: Boolean(process.env.LLM_COST_IDR_PER_MTOK?.trim()),
    backendLimit: config.allowedBackendUrls.length,
    models: catalog ? { provider: catalog.defaults.provider, quick: catalog.defaults.quickModel, deep: catalog.defaults.deepModel } : null,
  });
});
