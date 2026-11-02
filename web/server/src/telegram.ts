// Connecting a member's Telegram chat in one tap. The app hands out a one-time link to the
// bot (t.me/<bot>?start=<token>, POST /api/me/telegram/link); pressing Start sends the bot
// "/start <token>", and the account takes that chat. The scheduler leader reads the bot's
// messages by long polling (getUpdates), so no public webhook is needed, and keeps the offset
// in shared_values so a new leader carries on where the old one stopped. A link lives 15
// minutes, works once, and a new one replaces the member's previous one. Typing the chat ID
// in Profil stays possible, for groups.
import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "./auth";
import { db } from "./db";
import { telegramLinks, users } from "./db/schema";
import { recordError } from "./errors";
import { leaderOnly } from "./locks";
import { log } from "./log";
import { readShared, writeShared } from "./shared";
import { escape, sendTelegram, telegramBot, telegramCall } from "./watch";

const LINK_MS = 15 * 60_000;

type Update = { update_id: number; message?: { text?: string; chat: { id: number } } };

let named: { at: number; name: string | null } | null = null;
let testName: string | null | undefined;
/** Tests: act as a bot with this @name, or as no bot (null); undefined asks Telegram again. */
export function useTelegramBot(name?: string | null) {
  testName = name;
  named = null;
}

/** The bot's @name for links, cached for an hour; null without a bot. */
async function botName(): Promise<string | null> {
  if (testName !== undefined) return testName;
  if (named && Date.now() - named.at < 3_600_000) return named.name;
  const me = await telegramCall<{ username?: string }>("getMe", {});
  named = { at: Date.now(), name: me?.username ?? null };
  return named.name;
}

/** A one-time link to the bot that connects this account's chat; null without a bot. */
export async function createLink(userId: string): Promise<string | null> {
  const name = await botName();
  if (!name) return null;
  const token = randomBytes(18).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
    await tx.insert(telegramLinks).values({ token, userId, expiresAt: new Date(Date.now() + LINK_MS) });
  });
  return `https://t.me/${name}?start=${token}`;
}

/** One message the bot received: "/start <token>" gives that chat to the token's account. */
export async function handleUpdate(update: Update) {
  const message = update.message;
  const text = message?.text?.trim() ?? "";
  if (!message || !text.startsWith("/start")) return;
  const chat = String(message.chat.id);
  const token = text.slice("/start".length).trim();
  // Deleting it is what uses it, so it connects once even if the message came twice.
  const [link] = token ? await db.delete(telegramLinks).where(and(eq(telegramLinks.token, token), gt(telegramLinks.expiresAt, new Date()))).returning() : [];
  if (!link) {
    await sendTelegram(chat, "Untuk menyambungkan, buka TradingAgents → menu akun → Profil → Notifikasi, lalu tekan <b>Sambungkan Telegram</b>. Tautannya berlaku 15 menit.");
    return;
  }
  const [user] = await db.update(users).set({ telegramChatId: chat }).where(eq(users.id, link.userId)).returning({ username: users.username });
  if (user) await sendTelegram(chat, `✅ Tersambung ke <b>${escape(user.username)}</b>. Notifikasi sinyal, harga, dan ringkasan harian dikirim ke chat ini.`);
}

let polling = false;
let pausedUntil = 0;
/** One long poll of the bot's messages, from the shared offset. */
async function poll() {
  const offset = (await readShared<number>("telegram:offset")) ?? 0;
  const updates = await telegramCall<Update[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }, 35_000);
  if (!updates?.length) return;
  for (const u of updates) await handleUpdate(u).catch((err) => recordError("telegram", err));
  await writeShared("telegram:offset", updates.at(-1)!.update_id + 1);
}

/** Reads the bot's messages on the scheduler leader while the server has a bot; a failure waits a minute. */
export function startTelegramLinks() {
  if (!telegramBot()) return;
  const tick = leaderOnly(() => {
    if (polling || Date.now() < pausedUntil) return;
    polling = true;
    poll()
      .catch((err) => {
        pausedUntil = Date.now() + 60_000;
        log.warn("telegram_poll_failed", { error: err });
      })
      .finally(() => (polling = false));
  });
  tick();
  setInterval(tick, 3_000);
  const sweep = leaderOnly(() => db.delete(telegramLinks).where(lt(telegramLinks.expiresAt, new Date())).catch((err) => recordError("telegram", err)));
  setInterval(sweep, 86_400_000);
}

export const telegramApi = new Hono<AppEnv>();

/** A one-time link that connects the member's Telegram chat when they press Start in the bot. */
telegramApi.post("/me/telegram/link", async (c) => {
  try {
    const url = await createLink(c.get("user").id);
    return url ? c.json({ url }) : c.json({ error: "Bot Telegram belum diatur di server ini. Hubungi admin." }, 400);
  } catch (err) {
    log.warn("telegram_link_failed", { error: err });
    return c.json({ error: "Bot Telegram tidak bisa dihubungi. Coba lagi sebentar lagi." }, 503);
  }
});
