// Outgoing e-mail: verification and password links, payment notices. SMTP_URL
// (smtps://user:pass@host:465, from any provider: Resend, Brevo, Amazon SES,
// Postmark, Google Workspace) and MAIL_FROM set the sender. Without SMTP_URL
// nothing is sent: the log names the recipient and subject, and with MAIL_LOG=1
// the whole message, links included, also kept in `outbox` for the tests
// (development only: links sign people in).
import nodemailer from "nodemailer";
import { BRAND } from "../../shared/brand";
import { log } from "./log";

const SMTP_URL = process.env.SMTP_URL ?? "";
const FROM = process.env.MAIL_FROM || `${BRAND.name} <noreply@localhost>`;
const transport = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : null;
export const mailEnabled = () => Boolean(transport);

export type Mail = { to: string; subject: string; text: string; html: string };

/** With MAIL_LOG=1 and no SMTP: the last messages "sent", newest last, for the test suite to read links from. */
export const outbox: Mail[] = [];

export async function sendMail(mail: Mail): Promise<{ ok: boolean; error?: string }> {
  if (!transport) {
    log.info("mail_not_sent", { to: mail.to, subject: mail.subject, ...(process.env.MAIL_LOG === "1" ? { text: mail.text } : {}) });
    if (process.env.MAIL_LOG === "1" && outbox.push(mail) > 50) outbox.shift();
    return { ok: false, error: "Pengiriman email belum diatur" };
  }
  try {
    await transport.sendMail({ from: FROM, ...mail });
    return { ok: true };
  } catch (e) {
    log.error("mail_failed", { to: mail.to, error: (e as Error).message });
    return { ok: false, error: (e as Error).message };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A short message with paragraphs, an optional button, and the brand at the end: as text and as HTML. */
export function composeMail(to: string, subject: string, lines: string[], button?: { label: string; url: string }, after: string[] = []): Mail {
  const text = [...lines, ...(button ? ["", `${button.label}: ${button.url}`] : []), ...(after.length ? ["", ...after] : []), "", `${BRAND.name}`].join("\n");
  const p = (l: string, small = false) => `<p style="margin:0 0 14px${small ? ";font-size:13px;color:#5F5B55" : ""}">${esc(l)}</p>`;
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#121212;max-width:520px">',
    ...lines.map((l) => p(l)),
    button
      ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#FF6A13;color:#121212;font-weight:700;padding:11px 18px;border-radius:6px;text-decoration:none">${esc(button.label)}</a></p>${p(`Atau salin tautan ini: ${button.url}`, true)}`
      : "",
    ...after.map((l) => p(l, true)),
    // The wordmark as the brand sets it, Medan in Jingga tua (5.2:1 on white).
    `<p style="margin:0;font-size:15px;font-weight:800;letter-spacing:-0.02em">${esc(BRAND.wordmark[0])}<span style="color:#C2410C">${esc(BRAND.wordmark[1])}</span></p>`,
    "</div>",
  ].join("");
  return { to, subject, text, html };
}
