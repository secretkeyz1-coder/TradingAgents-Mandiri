// The status page's checks (client/status). Every five minutes the server looks
// at what members rely on: the database, the two price feeds, the analysis
// engine, the signal scanner, the AI brief, Telegram and e-mail. It keeps the
// latest result and counts each day's checks and failures per part for the
// 90-day bars. A part that is not set up ("off") counts neither way. A server
// that is down cannot report itself, so the page says when it last checked.
import { desc, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { scanHealth } from "./alerts";
import { BINANCE_HOSTS } from "./binance";
import { db } from "./db";
import { marketBriefs, statusDays } from "./db/schema";
import { recordError } from "./errors";
import { mailEnabled } from "./mail";
import { telegramHealth } from "./watch";
import { catalogHealth } from "./worker";

type State = "ok" | "degraded" | "down" | "off";
type Part = { key: string; name: string; state: State; detail: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const HISTORY_DAYS = 90;
/** Until the first scan after a restart, the scanner's quiet time counts from the restart. */
const STARTED = Date.now();
const ago = (ms: number) => (ms < HOUR ? `${Math.max(1, Math.round(ms / MINUTE))} menit lalu` : `${Math.round(ms / HOUR)} jam lalu`);
const wibDay = (t = Date.now()) => new Date(t + 7 * HOUR).toISOString().slice(0, 10);

async function reachable(url: string, headers?: Record<string, string>): Promise<boolean> {
  try {
    return (await fetch(url, { headers, signal: AbortSignal.timeout(8_000) })).ok;
  } catch {
    return false;
  }
}

async function check(): Promise<Part[]> {
  const parts: Part[] = [];

  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    const ms = Date.now() - started;
    parts.push({ key: "database", name: "Database", state: ms > 2_000 ? "degraded" : "ok", detail: `Menjawab dalam ${ms} ms` });
  } catch {
    parts.push({ key: "database", name: "Database", state: "down", detail: "Tidak menjawab" });
  }

  let binance = false;
  for (const host of BINANCE_HOSTS) if (!binance) binance = await reachable(`${host}/api/v3/ping`);
  parts.push({
    key: "crypto",
    name: "Harga kripto (Binance)",
    state: binance ? "ok" : "down",
    detail: binance ? "Terhubung, real-time" : "Tidak bisa dihubungi; harga kripto dan sinyalnya bisa tertinggal",
  });

  const yahoo = await reachable("https://query2.finance.yahoo.com/v8/finance/chart/GC=F?range=1d&interval=1d", { "User-Agent": "Mozilla/5.0" });
  parts.push({
    key: "markets",
    name: "Emas, saham, indeks, dan kurs",
    state: yahoo ? "ok" : "degraded",
    detail: yahoo ? "Terhubung; data dari sumber publik, tertunda" : "Sumber data publik tidak menjawab; harga bisa tertinggal",
  });

  const engine = catalogHealth();
  parts.push({
    key: "engine",
    name: "Mesin analisa AI",
    state: !engine ? "degraded" : engine.ok ? "ok" : "down",
    detail: !engine ? "Belum dimuat sejak server menyala" : engine.ok ? "Siap menerima analisa" : "Gagal dimuat; analisa dan agent chart tidak bisa berjalan",
  });

  const scan = scanHealth();
  const sinceScan = Date.now() - (scan?.at ?? STARTED);
  const stuck = sinceScan > 20 * MINUTE;
  parts.push({
    key: "scanner",
    name: "Pemindai sinyal dan notifikasi",
    // Scans run every five minutes; a quarter of an hour without one means it is stuck.
    state: scan && !scan.ok ? "down" : stuck ? "degraded" : "ok",
    detail: scan
      ? `${scan.ok ? "Pindaian terakhir" : "Pindaian terakhir gagal"} ${ago(sinceScan)}`
      : stuck
        ? "Belum memindai sejak server menyala"
        : "Server baru menyala; pindaian pertama sedang berjalan",
  });

  if (process.env.SITE_BRIEF === "off") {
    parts.push({ key: "brief", name: "Ringkasan pasar AI", state: "off", detail: "Dimatikan di server ini" });
  } else {
    const [brief] = await db.select({ at: marketBriefs.createdAt }).from(marketBriefs).orderBy(desc(marketBriefs.createdAt)).limit(1);
    const age = brief ? Date.now() - brief.at.getTime() : Infinity;
    parts.push({
      key: "brief",
      name: "Ringkasan pasar AI",
      // Written every six hours: one missed round is late, two are down.
      state: age <= 7 * HOUR ? "ok" : age <= 13 * HOUR ? "degraded" : "down",
      detail: brief ? `Ditulis ${ago(age)}; diperbarui tiap 6 jam` : "Belum ada ringkasan",
    });
  }

  const telegram = telegramHealth();
  const failedLately = telegram.last && !telegram.last.ok && Date.now() - telegram.last.at < HOUR;
  parts.push({
    key: "telegram",
    name: "Notifikasi Telegram",
    state: !telegram.configured ? "off" : failedLately ? "degraded" : "ok",
    detail: !telegram.configured ? "Belum diatur di server ini" : failedLately ? "Pengiriman terakhir gagal; dicoba lagi otomatis" : "Aktif",
  });

  parts.push({ key: "mail", name: "Email", state: mailEnabled() ? "ok" : "off", detail: mailEnabled() ? "Aktif" : "Belum diatur di server ini" });
  return parts;
}

let latest: { at: number; parts: Part[] } | null = null;

/** One round of checks, kept as the latest and added to today's tally. */
async function sample() {
  const parts = await check();
  latest = { at: Date.now(), parts };
  const day = wibDay();
  for (const p of parts) {
    if (p.state === "off") continue;
    const failed = p.state === "down" ? 1 : 0;
    await db
      .insert(statusDays)
      .values({ day, component: p.key, checks: 1, failures: failed })
      .onConflictDoUpdate({
        target: [statusDays.day, statusDays.component],
        set: { checks: sql`${statusDays.checks} + 1`, failures: sql`${statusDays.failures} + ${failed}` },
      });
  }
}

export function startStatusChecks() {
  const run = () => sample().catch((err) => recordError("status", err));
  // After boot settles: the engine catalog and the first scan need a moment.
  setTimeout(run, 90_000);
  setInterval(run, 5 * MINUTE);
}

let answer: { at: number; body: unknown } | null = null;
let inflight: Promise<unknown> | null = null;

async function load() {
  if (!latest) latest = { at: Date.now(), parts: await check() };
  const since = wibDay(Date.now() - (HISTORY_DAYS - 1) * 24 * HOUR);
  const rows = await db.select().from(statusDays).where(gte(statusDays.day, since));
  const history: Record<string, Record<string, number>> = {};
  for (const r of rows) (history[r.component] ??= {})[r.day] = r.checks ? 1 - r.failures / r.checks : 1;
  const counted = latest.parts.filter((p) => p.state !== "off");
  return {
    checkedAt: new Date(latest.at).toISOString(),
    overall: counted.some((p) => p.state === "down") ? "down" : counted.some((p) => p.state === "degraded") ? "degraded" : "ok",
    days: HISTORY_DAYS,
    parts: latest.parts.map((p) => ({ ...p, history: history[p.key] ?? {} })),
  };
}

export const statusApi = new Hono();

statusApi.get("/public/status", async (c) => {
  if (!answer || Date.now() - answer.at > 30_000) {
    inflight ??= load()
      .then((body) => (answer = { at: Date.now(), body }))
      .finally(() => (inflight = null));
    await inflight;
  }
  c.header("Cache-Control", "public, max-age=30");
  return c.json(answer!.body);
});
