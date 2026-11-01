// Alerts for whoever runs the server, on Telegram: server errors piling up,
// analyses waiting with no runner taking them, analyses failing one after
// another, the signal scanner gone quiet, a status check finding a part down.
// The instance that runs the schedulers (locks.ts) checks every minute. Each
// condition sends one message when it starts and one when it clears; its state
// lives in shared_values, so a new leader neither repeats nor forgets it.
// Messages go to ALERT_CHAT_ID (a group or channel) when set, else to every
// active admin who has a Telegram chat id.
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { analyses, serverErrors, users } from "./db/schema";
import { recordError } from "./errors";
import { leaderOnly } from "./locks";
import { log } from "./log";
import { readShared, writeShared } from "./shared";
import { escape, sendTelegram } from "./watch";

const MINUTE = 60_000;
const STARTED = Date.now();
const ago = (ms: number) => (ms < 90 * MINUTE ? `${Math.max(1, Math.round(ms / MINUTE))} menit` : `${Math.round(ms / (60 * MINUTE))} jam`);

type Check = {
  key: string;
  /** The problem in a sentence while it lasts; null when all is well. */
  problem: () => Promise<string | null>;
  /** What the all-clear says. */
  cleared: string;
};

const CHECKS: Check[] = [
  {
    key: "errors",
    cleared: "error server kembali normal",
    problem: async () => {
      const bySource = await db
        .select({ source: serverErrors.source, n: count() })
        .from(serverErrors)
        .where(gte(serverErrors.createdAt, new Date(Date.now() - 10 * MINUTE)))
        .groupBy(serverErrors.source)
        .orderBy(desc(count()));
      const total = bySource.reduce((sum, row) => sum + row.n, 0);
      if (total < 5) return null;
      const top = bySource.slice(0, 3).map((row) => `${row.source} ×${row.n}`).join(", ");
      return `${total} error server dalam 10 menit terakhir (${top}). Rinciannya ada di Konsol admin, Status layanan.`;
    },
  },
  {
    key: "queue",
    cleared: "antrean analisa berjalan lagi",
    problem: async () => {
      const [row] = await db
        .select({
          queued: sql<number>`(count(*) filter (where ${analyses.status} = 'queued'))::int`,
          running: sql<number>`(count(*) filter (where ${analyses.status} = 'running'))::int`,
          wait: sql<string | null>`extract(epoch from now() - min(${analyses.createdAt}) filter (where ${analyses.status} = 'queued'))`,
        })
        .from(analyses);
      if (!row?.queued) return null;
      const minutes = Math.floor(Number(row.wait ?? 0) / 60);
      // A busy queue moves slowly; one that no worker takes from does not move at all.
      const stuck = (minutes >= 10 && row.running === 0) || minutes >= 60;
      if (!stuck) return null;
      return `Antrean analisa tidak berjalan: ${row.queued} antre, yang tertua menunggu ${minutes} menit${row.running ? "" : ", dan tidak ada yang sedang jalan"}. Cek service worker.`;
    },
  },
  {
    key: "failing",
    cleared: "analisa tidak lagi gagal beruntun",
    problem: async () => {
      const [row] = await db
        .select({ n: count() })
        .from(analyses)
        .where(and(eq(analyses.status, "failed"), gte(analyses.finishedAt, new Date(Date.now() - 30 * MINUTE))));
      if ((row?.n ?? 0) < 3) return null;
      return `${row.n} analisa gagal dalam 30 menit terakhir. Alasannya ada di riwayat analisa dan log worker.`;
    },
  },
  {
    key: "scanner",
    cleared: "pemindai sinyal berjalan lagi",
    problem: async () => {
      // A server just started has not had its first scan yet.
      if (Date.now() - STARTED < 20 * MINUTE) return null;
      const scan = await readShared<{ at: number; ok: boolean }>("scan:last");
      const quiet = Date.now() - (scan?.at ?? STARTED);
      if (quiet < 20 * MINUTE) return null;
      return `Pemindai sinyal tidak berjalan selama ${ago(quiet)}; notifikasi sinyal tertunda.`;
    },
  },
  {
    key: "status",
    cleared: "semua bagian layanan menjawab lagi",
    problem: async () => {
      const latest = await readShared<{ parts: { name: string; state: string }[] }>("status:latest");
      const down = (latest?.parts ?? []).filter((part) => part.state === "down").map((part) => part.name);
      return down.length ? `Cek status menemukan bagian yang mati: ${down.join(", ")}.` : null;
    },
  },
];

let send = sendTelegram;
/** Tests catch the messages instead of sending them; called without one, Telegram is back. */
export function useOpsSender(sender: typeof sendTelegram = sendTelegram) {
  send = sender;
}

async function notify(title: string, text: string) {
  log.warn("ops_alert", { title, text });
  const to = process.env.ALERT_CHAT_ID
    ? [process.env.ALERT_CHAT_ID]
    : (
        await db
          .select({ chat: users.telegramChatId })
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.disabled, false), isNotNull(users.telegramChatId)))
      ).map((row) => row.chat!);
  if (!to.length) return log.warn("ops_alert_unsent", { reason: "no ALERT_CHAT_ID and no admin with a Telegram chat id" });
  for (const chat of to) {
    const sent = await send(chat, `<b>${title}</b>\n${escape(text)}`);
    if (!sent.ok) log.warn("ops_alert_not_sent", { error: sent.error });
  }
}

/** One round: a message for each condition that started or cleared since the last; `only` limits it to some (tests). */
export async function runOpsChecks(only?: string[]) {
  for (const check of CHECKS) {
    if (only && !only.includes(check.key)) continue;
    let problem: string | null;
    try {
      problem = await check.problem();
    } catch (err) {
      // The check itself failed: its state stays as it was.
      await recordError("ops", err);
      continue;
    }
    const state = (await readShared<{ active: boolean; since: number }>(`ops:${check.key}`)) ?? { active: false, since: 0 };
    if (problem && !state.active) {
      await writeShared(`ops:${check.key}`, { active: true, since: Date.now() });
      await notify("⚠️ Peringatan server", problem);
    } else if (!problem && state.active) {
      await writeShared(`ops:${check.key}`, { active: false, since: Date.now() });
      await notify("✅ Pulih", `${check.cleared}, setelah ${ago(Date.now() - state.since)}.`);
    }
  }
}

/** Checks every minute on the instance that runs the schedulers, from two minutes after start. */
export function startOpsAlerts() {
  const tick = leaderOnly(() => runOpsChecks().catch((err) => recordError("ops", err)));
  setTimeout(tick, 2 * MINUTE);
  setInterval(tick, MINUTE);
}
