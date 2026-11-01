// Reminders before money is due: 7, 3 and 1 day before a paid plan ends, the
// day before a trial ends, once a plan or trial has ended, and a day before an
// unpaid order lapses. By e-mail, and by Telegram when the account has linked
// it. Each goes once per account and occasion (the notices table), checked
// every hour; REMINDERS=off stops them.
import { and, eq, gt, isNotNull, lt, ne } from "drizzle-orm";
import { label, ORDER_DAYS } from "./billing";
import { db } from "./db";
import { notices, payments, users } from "./db/schema";
import { recordError } from "./errors";
import { invoiceLink } from "./invoice";
import { leaderOnly } from "./locks";
import { composeMail, sendMail } from "./mail";
import { escape, publicUrl, sendTelegram } from "./watch";
import { PLANS, rupiah, TRIAL_DAYS } from "../../shared/plans";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Days before a paid plan ends when a reminder goes out. */
const STAGES = [7, 3, 1];

type User = typeof users.$inferSelect;
type Button = { label: string; url: string };

const day = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" });
const billingButton = (): Button | undefined => (publicUrl() ? { label: "Buka Paket & tagihan", url: `${publicUrl()}/app` } : undefined);

/** True the first time this account meets this occasion; the notice is kept either way. */
async function firstTime(userId: string, key: string): Promise<boolean> {
  const rows = await db.insert(notices).values({ userId, key }).onConflictDoNothing().returning({ id: notices.id });
  return rows.length > 0;
}

/** By e-mail and Telegram, whichever the account has. The first line greets by name and stays out of Telegram. */
async function tell(u: User, subject: string, lines: string[], button?: Button) {
  if (u.email) await sendMail(composeMail(u.email, subject, lines, button));
  if (u.telegramChatId) {
    const link = button ? [`<a href="${escape(button.url)}">${escape(button.label)}</a>`] : [];
    await sendTelegram(u.telegramChatId, [`<b>${escape(subject)}</b>`, ...lines.slice(1).map(escape), ...link].join("\n"));
  }
}

/** Whether the plan period now running is the free trial: it began when the trial did and is no longer than one. */
const isTrial = (u: User) => Boolean(u.trialStartedAt && u.planUntil && u.planUntil.getTime() - u.trialStartedAt.getTime() <= TRIAL_DAYS * DAY_MS + 60_000);

export async function sendReminders(now = new Date()): Promise<void> {
  const t = now.getTime();
  // Plans ending within a week, or ended in the last two days (for the note that they have).
  const due = await db
    .select()
    .from(users)
    .where(
      and(
        ne(users.role, "admin"),
        eq(users.disabled, false),
        ne(users.plan, "free"),
        isNotNull(users.planUntil),
        gt(users.planUntil, new Date(t - 2 * DAY_MS)),
        lt(users.planUntil, new Date(t + 7 * DAY_MS)),
      ),
    );
  // An account whose payment an admin is checking has renewed already, as far as it knows.
  const checking = new Set((await db.select({ userId: payments.userId }).from(payments).where(eq(payments.status, "claimed"))).map((r) => r.userId));
  for (const u of due) {
    if ((!u.email && !u.telegramChatId) || checking.has(u.id)) continue;
    const end = u.planUntil as Date;
    const left = end.getTime() - t;
    const plan = PLANS[u.plan].name;
    const trial = isTrial(u);
    if (left <= 0) {
      if (!(await firstTime(u.id, `ended:${end.toISOString()}`))) continue;
      await tell(
        u,
        trial ? `Masa coba ${plan} sudah berakhir` : `Paket ${plan} sudah berakhir`,
        [
          `Halo ${u.username},`,
          `${trial ? `Masa coba ${plan}` : `Paket ${plan}`} kamu berakhir ${day(end)}, jadi akunmu sekarang di paket Gratis. Skrip, watchlist, dan riwayatmu tetap tersimpan.`,
          "Berlangganan lagi kapan saja dari menu akun → Paket & tagihan.",
        ],
        billingButton(),
      );
    } else if (trial) {
      if (left > DAY_MS || !(await firstTime(u.id, `trial:${end.toISOString()}`))) continue;
      await tell(
        u,
        `Masa coba ${plan} berakhir ${day(end)}`,
        [
          `Halo ${u.username},`,
          `Masa coba ${plan} kamu berakhir ${day(end)}. Setelah itu akunmu kembali ke paket Gratis dengan kapasitasnya.`,
          `Kalau ${plan} membantumu, pesan dari menu akun → Paket & tagihan sebelum masa cobanya habis.`,
        ],
        billingButton(),
      );
    } else {
      // The nearest stage the time left has reached. A plan bought with less than a week left skips the farther ones.
      const stage = [...STAGES].reverse().find((s) => left <= s * DAY_MS);
      if (!stage || !(await firstTime(u.id, `renew:${end.toISOString()}:${stage}`))) continue;
      await tell(
        u,
        `Paket ${plan} berakhir ${day(end)}`,
        [
          `Halo ${u.username},`,
          `Paket ${plan} kamu berlaku sampai ${day(end)}. Setelah itu akunmu kembali ke paket Gratis.`,
          "Perpanjang dari menu akun → Paket & tagihan. Memperpanjang paket yang sama menambah dari tanggal berakhirnya, jadi tidak ada hari yang hilang.",
        ],
        billingButton(),
      );
    }
  }

  // Unpaid orders, a day before they lapse.
  const lapsing = await db
    .select({ payment: payments, user: users })
    .from(payments)
    .innerJoin(users, eq(payments.userId, users.id))
    .where(
      and(
        eq(payments.status, "pending"),
        gt(payments.amount, 0),
        lt(payments.createdAt, new Date(t - (ORDER_DAYS - 1) * DAY_MS)),
        gt(payments.createdAt, new Date(t - ORDER_DAYS * DAY_MS)),
      ),
    );
  for (const { payment: p, user: u } of lapsing) {
    if (u.disabled || (!u.email && !u.telegramChatId)) continue;
    if (!(await firstTime(u.id, `order:${p.id}`))) continue;
    const lapse = new Date(p.createdAt.getTime() + ORDER_DAYS * DAY_MS);
    const link = invoiceLink(p.id);
    await tell(
      u,
      `Tagihan ${p.reference} belum dibayar`,
      [
        `Halo ${u.username},`,
        `Pembayaran pesanan ${label(p)} sebesar ${rupiah(p.amount)} belum kami terima. Pesanan ini berlaku sampai ${day(lapse)}, lalu batal sendiri.`,
        'Setelah mentransfer, tekan "Saya sudah bayar" di menu akun → Paket & tagihan.',
      ],
      link ? { label: "Lihat tagihan", url: link } : billingButton(),
    );
  }
}

export function startReminders() {
  if (process.env.REMINDERS === "off") return;
  const tick = leaderOnly(() => sendReminders().catch((err) => recordError("reminders", err)));
  setTimeout(tick, 60_000);
  setInterval(tick, HOUR_MS);
}
