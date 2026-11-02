// Connecting Telegram in one tap (telegram.ts): the app hands out a one-time link to the bot,
// and the bot's "/start <token>" gives that chat to the account. The bot is a stand-in name
// (useTelegramBot) and its messages are handed to handleUpdate directly, so nothing reaches
// Telegram; the bot's replies fail quietly without a token, as they should.
import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { telegramLinks, users } from "../src/db/schema";
import { handleUpdate, useTelegramBot } from "../src/telegram";
import { call, member } from "./helpers";

afterAll(() => useTelegramBot());

const chatOf = async (id: string) => (await db.select({ chat: users.telegramChatId }).from(users).where(eq(users.id, id)))[0].chat;
const tokenOf = (url: string) => new URL(url).searchParams.get("start")!;

test("a link to the bot connects the chat that presses Start, once", async () => {
  useTelegramBot("tes_bot");
  const m = await member();
  const first = await call("/api/me/telegram/link", { method: "POST", cookie: m.cookie });
  expect(first.status).toBe(200);
  expect(first.body.url).toMatch(/^https:\/\/t\.me\/tes_bot\?start=[\w-]{20,}$/);
  // A new link replaces the previous one.
  const second = await call("/api/me/telegram/link", { method: "POST", cookie: m.cookie });
  expect(await db.$count(telegramLinks, eq(telegramLinks.userId, m.id))).toBe(1);
  await handleUpdate({ update_id: 1, message: { text: `/start ${tokenOf(first.body.url)}`, chat: { id: 111 } } });
  expect(await chatOf(m.id)).toBeNull();

  await handleUpdate({ update_id: 2, message: { text: `/start ${tokenOf(second.body.url)}`, chat: { id: 222 } } });
  expect(await chatOf(m.id)).toBe("222");
  expect(await db.$count(telegramLinks, eq(telegramLinks.userId, m.id))).toBe(0);

  // Used once: the same link from another chat changes nothing.
  await handleUpdate({ update_id: 3, message: { text: `/start ${tokenOf(second.body.url)}`, chat: { id: 333 } } });
  expect(await chatOf(m.id)).toBe("222");
});

test("an expired link connects nothing, and without a bot there is no link", async () => {
  useTelegramBot("tes_bot");
  const m = await member();
  await db.insert(telegramLinks).values({ token: "kedaluwarsa-tes-0000000000", userId: m.id, expiresAt: new Date(Date.now() - 1000) });
  await handleUpdate({ update_id: 4, message: { text: "/start kedaluwarsa-tes-0000000000", chat: { id: 444 } } });
  expect(await chatOf(m.id)).toBeNull();
  await handleUpdate({ update_id: 5, message: { text: "halo", chat: { id: 444 } } });
  expect(await chatOf(m.id)).toBeNull();

  useTelegramBot(null);
  const r = await call("/api/me/telegram/link", { method: "POST", cookie: m.cookie });
  expect(r.status).toBe(400);
  expect(r.body.error).toContain("Bot Telegram belum diatur");
});
