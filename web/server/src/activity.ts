// Member activity, the recording half (analytics.ts reads it for the admin console). Two
// kinds of rows: one per minute a member is using the app, with the screen, tab and symbol
// open then (the page sends a beat while its tab is in front and someone touched it in the
// last five minutes; one row per minute however often it beats), and one per thing done that
// the server already sees: a sign-in, an analysis, a backtest, a chat message, a lab run, a
// notification, a script, a symbol added to the daily analysis. Admin accounts are not
// recorded. Rows older than KEEP_DAYS are deleted, as the privacy policy says. Nothing here
// may fail the request it rides on.
import { lt } from "drizzle-orm";
import type { User } from "./auth";
import { db } from "./db";
import { activityEvents, activityMinutes, type ActivityKind, type ActivityScreen } from "./db/schema";
import { recordError } from "./errors";
import { leaderOnly } from "./locks";

export const KEEP_DAYS = 90;
export const ACTIVITY_SCREENS = ["beranda", "pasar", "riset", "pantau", "uji", "pemula"] as const satisfies readonly ActivityScreen[];
/** The tabs a screen shows (client stores/workspace.svelte.ts DockTab). */
export const ACTIVITY_TABS = ["history", "report", "log", "backtest", "lab", "signals", "watch", "alerts", "screener"] as const;

type Who = Pick<User, "id" | "role">;

/** Records that a member did something; an admin's actions are not recorded. */
export async function track(user: Who, kind: ActivityKind, symbol?: string | null, detail?: Record<string, string | number>) {
  if (user.role === "admin") return;
  await db
    .insert(activityEvents)
    .values({ userId: user.id, kind, symbol: symbol || null, detail: detail ?? null })
    .catch((err) => recordError("activity", err));
}

/** The member is using the app this minute: one row per minute, the latest beat's place wins. */
export async function recordMinute(user: Who, place: { screen: ActivityScreen; tab?: string | null; symbol?: string | null }, at = Date.now()) {
  if (user.role === "admin") return;
  const minute = new Date(Math.floor(at / 60_000) * 60_000);
  const row = { screen: place.screen, tab: place.tab ?? null, symbol: place.symbol || null };
  await db
    .insert(activityMinutes)
    .values({ userId: user.id, minute, ...row })
    .onConflictDoUpdate({ target: [activityMinutes.userId, activityMinutes.minute], set: row });
}

/** Deletes rows older than KEEP_DAYS before `now` (tests pass their own clock). */
export async function pruneActivity(now = Date.now()) {
  const before = new Date(now - KEEP_DAYS * 86_400_000);
  await db.delete(activityMinutes).where(lt(activityMinutes.minute, before));
  await db.delete(activityEvents).where(lt(activityEvents.at, before));
}

export function startActivityPruning() {
  const prune = leaderOnly(() => pruneActivity().catch((err) => recordError("activity", err)));
  prune();
  setInterval(prune, 86_400_000);
}
