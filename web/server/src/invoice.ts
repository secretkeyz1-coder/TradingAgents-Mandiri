// An order's invoice as a page: what was bought, any coupon, the unique code,
// the total, and whether it is paid. It opens from a signed link (in the order
// and receipt e-mails and the billing dialog), so it needs no sign-in, and one
// link opens one invoice only. Plain HTML that fits a printed page; the browser
// saves it as PDF. It is not a tax invoice.
import { timingSafeEqual } from "node:crypto";
import { sign } from "./auth";
import type { payments, users } from "./db/schema";
import { publicUrl } from "./watch";
import { BRAND } from "../../shared/brand";
import { PERIOD_LABEL, PLANS, rupiah } from "../../shared/plans";

type Payment = typeof payments.$inferSelect;
type Buyer = Pick<typeof users.$inferSelect, "username" | "email" | "phone">;

/** The page's own path, signed. */
export const invoicePath = (id: string) => `/invoice/${id}?t=${sign("invoice", id)}`;
/** The full link for an e-mail; empty without PUBLIC_URL, since a mail needs an address to point at. */
export const invoiceLink = (id: string) => (publicUrl() ? `${publicUrl()}${invoicePath(id)}` : "");

export function verifyInvoice(id: string, signature: string): boolean {
  const want = Buffer.from(sign("invoice", id));
  const got = Buffer.from(signature);
  return got.length === want.length && timingSafeEqual(got, want);
}

const STATUS: Record<Payment["status"], string> = {
  pending: "Belum dibayar",
  claimed: "Pembayaran sedang diperiksa",
  paid: "Lunas",
  rejected: "Pembayaran ditolak",
  cancelled: "Dibatalkan",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" });

/** The invoice's lines: the plan at its price, the coupon taken off, the unique code added. They sum to the amount. */
export function invoiceLines(p: Payment): [string, number][] {
  const what = `Paket ${PLANS[p.plan].name}${p.founding ? " founding" : ""} per ${PERIOD_LABEL[p.period]}`;
  const when = p.periodStart && p.periodEnd ? `, ${day(p.periodStart)} – ${day(p.periodEnd)}` : "";
  return [
    [`${what}${when}`, p.amount - p.uniqueCode + p.discount],
    ...(p.discount ? [[`Kupon ${p.couponCode ?? ""}`.trim(), -p.discount] as [string, number]] : []),
    ...(p.uniqueCode ? [["Kode unik transfer", p.uniqueCode] as [string, number]] : []),
  ];
}

export function renderInvoice(p: Payment, buyer: Buyer, opts: { orderDays: number; instructions: string }): string {
  const due = new Date(p.createdAt.getTime() + opts.orderDays * 86_400_000);
  const state =
    p.status === "paid" && p.paidAt
      ? `Lunas, ${day(p.paidAt)}`
      : p.status === "pending"
        ? `Belum dibayar, batas ${day(due)}`
        : STATUS[p.status];
  const rows = invoiceLines(p)
    .map(([label, value]) => `<tr><td>${esc(label)}</td><td class="num">${value < 0 ? "−" : ""}${rupiah(Math.abs(value))}</td></tr>`)
    .join("");
  const seller = BRAND.company || BRAND.name;
  const contact = [BRAND.supportEmail, publicUrl()].filter(Boolean).join(" · ");
  const buyerLines = [buyer.username, buyer.email, buyer.phone].filter((x): x is string => Boolean(x));
  const howToPay =
    p.status === "pending" && opts.instructions
      ? `<section><h2>Cara membayar</h2><p>Transfer tepat <strong>${rupiah(p.amount)}</strong>; tiga digit terakhirnya adalah kode unik pesanan ini.</p><p class="pre">${esc(opts.instructions)}</p></section>`
      : "";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${p.status === "paid" ? "Bukti pembayaran" : "Tagihan"} ${esc(p.reference)} · ${esc(BRAND.name)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f3f4f6; color: #1f2430; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 720px; margin: 32px auto; background: #fff; border: 1px solid #e3e5ea; border-radius: 12px; padding: 40px; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 24px; border-bottom: 1px solid #e3e5ea; padding-bottom: 24px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
  h2 { margin: 28px 0 8px; font-size: 13px; font-weight: 600; color: #5b6170; }
  p { margin: 0 0 6px; }
  .muted { color: #5b6170; font-size: 13px; }
  .status { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; background: #eef0f4; }
  .status.paid { background: #e3f4ea; color: #1d6b3f; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  td { padding: 10px 0; border-bottom: 1px solid #eceef2; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; padding-left: 16px; }
  tfoot td { border-bottom: 0; font-weight: 700; font-size: 17px; }
  .pre { white-space: pre-line; background: #f6f7f9; border-radius: 8px; padding: 12px; }
  footer { margin-top: 28px; border-top: 1px solid #e3e5ea; padding-top: 16px; }
  button { margin-top: 20px; font: inherit; padding: 9px 16px; border-radius: 999px; border: 1px solid #c9ccd4; background: #fff; cursor: pointer; }
  @media print { body { background: #fff; } main { margin: 0; border: 0; padding: 0; } button { display: none; } }
  @media (max-width: 560px) { main { margin: 0; border-radius: 0; padding: 24px; } }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>${esc(BRAND.name)}</h1>
      <p class="muted">${esc(seller === BRAND.name ? BRAND.tagline : seller)}</p>
      ${contact ? `<p class="muted">${esc(contact)}</p>` : ""}
    </div>
    <div>
      <p class="muted">${p.status === "paid" ? "Bukti pembayaran" : "Tagihan"}</p>
      <p><strong>${esc(p.reference)}</strong></p>
      <p class="muted">Dibuat ${day(p.createdAt)}</p>
      <span class="status${p.status === "paid" ? " paid" : ""}">${esc(state)}</span>
    </div>
  </header>
  <h2>Ditagihkan kepada</h2>
  ${buyerLines.map((l) => `<p>${esc(l)}</p>`).join("")}
  <h2>Rincian</h2>
  <table>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${rupiah(p.amount)}</td></tr></tfoot>
  </table>
  ${howToPay}
  <footer>
    <p class="muted">Langganan dibayar di muka dan tidak diperpanjang otomatis. Dokumen ini bukan faktur pajak.</p>
    <button type="button" onclick="window.print()">Cetak atau simpan PDF</button>
  </footer>
</main>
</body>
</html>`;
}
