// Subscription plans, shared by the server (what each account may use) and the
// site and app (what it costs). The tiers differ in capacity; which chart
// indicators each one opens is the admin's catalog (server/src/indicators.ts),
// changed at run time rather than fixed here. The prices are the starting
// hypothesis, tested with founding members before they are final.

export const PLAN_IDS = ["free", "pro", "creator"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type Period = "month" | "year";

/** Daily caps reset at 00:00 WIB; the others count what an account holds at once. */
export type PlanLimits = {
  /** Multi-agent analyses a day (a backtest counts each of its cells). */
  analyses: number;
  /** Chart-agent chat turns a day. */
  chat: number;
  /** Strategy lab runs a day. */
  labRuns: number;
  /** Signal notifications switched on. */
  alerts: number;
  /** Symbols on the scheduled watchlist. */
  watchlist: number;
  /** Saved scripts. */
  scripts: number;
};

export type Plan = { id: PlanId; name: string; blurb: string; price: Record<Period, number>; limits: PlanLimits; highlights: string[] };

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Gratis",
    blurb: "Coba uji jujur untuk indikatormu.",
    price: { month: 0, year: 0 },
    limits: { analyses: 2, chat: 30, labRuns: 5, alerts: 3, watchlist: 3, scripts: 3 },
    highlights: ["Uji Lab 5 kali sehari", "2 analisa AI sehari", "3 notifikasi sinyal Telegram", "3 skrip tersimpan", "Harga kripto real-time dari 9 bursa"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    blurb: "Untuk pengoprek indikator dan trader sistematis.",
    price: { month: 149_000, year: 1_490_000 },
    limits: { analyses: 30, chat: 300, labRuns: 60, alerts: 15, watchlist: 10, scripts: 20 },
    highlights: ["Uji Lab 60 kali sehari", "30 analisa AI sehari", "15 notifikasi sinyal", "Analisa terjadwal 10 simbol", "20 skrip tersimpan"],
  },
  creator: {
    id: "creator",
    name: "Creator",
    blurb: "Untuk pemilik grup sinyal dan mentor.",
    price: { month: 399_000, year: 3_990_000 },
    limits: { analyses: 60, chat: 600, labRuns: 120, alerts: 50, watchlist: 30, scripts: 50 },
    highlights: ["Kapasitas dua kali Pro", "Uji Lab 120 kali sehari", "60 analisa AI sehari", "50 notifikasi sinyal", "Halaman rekam jejak publik"],
  },
};

/** A new account tries Pro this many days once its e-mail is verified. */
export const TRIAL_DAYS = 7;
/** Founding members: the first seats pay this for Pro monthly, kept while they stay subscribed. */
export const FOUNDING = { price: 79_000, seats: 100 };

export const PERIOD_LABEL: Record<Period, string> = { month: "bulan", year: "tahun" };

/** "Rp149.000". */
export const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;
