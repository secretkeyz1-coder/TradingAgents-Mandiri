// The indicators an analysis or an Uji saran AI reads (ADR 0017). A request names up to three by
// key and timeframe; here each is checked against what the account may use (indicators.ts: the
// built-in engines and the published scripts by plan, and the account's own scripts) and copied
// into the stored request as the worker needs it: a built-in with the account's own Scalper inputs,
// or a script's source as it is now. So a sweep reads the same code in every cell, however the
// script is edited meanwhile, and the worker (web/worker/readings.py) needs no database. The
// source and the inputs never leave the server again: publicRequest drops them from every answer.
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { User } from "./auth";
import { db } from "./db";
import { users, userScripts } from "./db/schema";
import { keyOf, usableRows } from "./indicators";
import { scalperSignalSettings } from "../../shared/scalper";
import { MAX_READINGS, READING_TIMEFRAMES, readingTimeframe, type IndicatorReading } from "../../shared/readings";

const ENGINES = ["pob", "scalper", "fib"] as const;
const SCRIPT_KEY = /^script:([0-9a-f-]{36})$/;

export const readingsSchema = z
  .array(z.object({ key: z.string().trim().min(1).max(60), timeframe: z.enum(READING_TIMEFRAMES) }))
  .max(MAX_READINGS, `Maksimal ${MAX_READINGS} indikator per analisa`);

type Picks = z.infer<typeof readingsSchema>;

/** The picks as the worker reads them, or why one cannot be read; the same key twice is read once. */
export async function snapshotReadings(user: User, picks: Picks): Promise<{ readings: IndicatorReading[] } | { error: string }> {
  const wanted = [...new Map(picks.map((p) => [p.key, p])).values()];
  if (!wanted.length) return { readings: [] };
  const scriptIds = wanted.flatMap((p) => SCRIPT_KEY.exec(p.key)?.[1] ?? []);
  const [rows, own, [me]] = await Promise.all([
    usableRows(user),
    scriptIds.length
      ? db.select().from(userScripts).where(and(eq(userScripts.userId, user.id), inArray(userScripts.id, scriptIds)))
      : Promise.resolve([]),
    // Read fresh: without sign-in the request's user is a cached object (auth.ts).
    db.select({ preferences: users.preferences }).from(users).where(eq(users.id, user.id)),
  ]);
  const readings: IndicatorReading[] = [];
  for (const pick of wanted) {
    const timeframe = readingTimeframe(pick.key, pick.timeframe);
    const script = own.find((s) => `script:${s.id}` === pick.key);
    if (script) {
      readings.push({ key: pick.key, name: script.name, timeframe, code: script.code });
      continue;
    }
    const row = rows.find((r) => keyOf(r) === pick.key);
    if (!row) return { error: SCRIPT_KEY.test(pick.key) ? "Skrip indikatormu tidak ditemukan. Muat ulang halaman." : "Indikator itu tidak tersedia untuk akunmu." };
    const engine = ENGINES.find((e) => e === row.builtin);
    if (engine) {
      const settings = engine === "scalper" ? scalperSignalSettings((me?.preferences as { indicators?: { scalper?: unknown } } | null)?.indicators?.scalper) : undefined;
      readings.push({ key: pick.key, name: row.name, timeframe, engine, ...(engine === "scalper" ? { settings } : {}) });
    } else if (row.code) {
      readings.push({ key: pick.key, name: row.name, timeframe, code: row.code });
    } else {
      return { error: `Indikator ${row.name} belum punya kode.` };
    }
  }
  return { readings };
}

/** A request as the API answers it: which indicators it reads, without their source or inputs. */
export function publicRequest<T extends { indicators?: IndicatorReading[] }>(request: T): T {
  if (!request.indicators?.length) return request;
  return { ...request, indicators: request.indicators.map(({ key, name, timeframe, engine }) => ({ key, name, timeframe, ...(engine ? { engine } : {}) })) };
}
