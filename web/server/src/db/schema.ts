import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Period, PlanId } from "../../../shared/plans";
import type { ScalperSignalSettings } from "../../../shared/scalper";

export type AnalysisStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type AnalysisRequest = {
  ticker: string;
  date: string;
  analysts: string[];
  depth: number;
  provider: string;
  quickModel: string;
  deepModel: string;
  language: string;
  backendUrl?: string;
};

/** A sweep of full analyses over tickers x dates, scored later (tradingagents.backtest). */
export type BacktestRequest = Omit<AnalysisRequest, "ticker" | "date"> & {
  tickers: string[];
  start: string;
  end: string;
  everyNDays: number;
  /** Re-running with a finished sweep's run id skips the cells it already did. */
  runId?: string;
};

export type JobKind = "analysis" | "backtest";

export type BacktestCell = {
  ticker: string;
  date: string;
  rating: string;
  pending: boolean;
  return: number | null;
  alpha: number | null;
  holding: string | null;
};

export type BacktestResult = {
  runId: string;
  cells: BacktestCell[];
  summary: {
    resolved: number;
    pending: number;
    unscored: number;
    holding: string;
    byRating: Record<string, { count: number; hitRate: number | null; meanAlpha: number }>;
  } | null;
  failures: { ticker: string; date: string; error: string }[];
  settlementFailures: { ticker: string; error: string }[];
};

export type RunStats = { llmCalls: number; toolCalls: number; tokensIn: number; tokensOut: number };

export type Role = "admin" | "member";

/**
 * Accounts. The admin creates them (there is no sign-up); the first admin comes
 * from APP_USER / APP_PASSWORD at boot. Everything a user makes carries their
 * user_id; admins can also read everyone's analyses.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  /** argon2id, from Bun.password; null for an account that only signs in with Google. */
  passwordHash: text("password_hash"),
  role: text("role").$type<Role>().notNull().default("member"),
  disabled: boolean("disabled").notNull().default(false),
  /** Per-user daily caps; null means the server default (DAILY_*_LIMIT). */
  dailyAnalysisLimit: integer("daily_analysis_limit"),
  dailyChatLimit: integer("daily_chat_limit"),
  /** Where this user's watchlist summary goes, through the server's one bot. */
  telegramChatId: text("telegram_chat_id"),
  /** What the page remembers for this account across browsers: saved panel layout, indicator settings. */
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  /** In every session cookie; bumping it signs the user out everywhere. */
  sessionVersion: integer("session_version").notNull().default(1),
  /** Sign-in and mail address, lower case; null for accounts the admin made before e-mail existed. */
  email: text("email").unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** WhatsApp number in +62 form, given at sign-up; not verified yet. */
  phone: text("phone"),
  /** The Google account id, once the user signs in with Google. */
  googleSub: text("google_sub").unique(),
  /** Subscription (shared/plans.ts): held until planUntil, then the account is on Gratis; null = no end. */
  plan: text("plan").$type<PlanId>().notNull().default("free"),
  planUntil: timestamp("plan_until", { withTimezone: true }),
  /** When the one Pro trial started; null = not used yet. */
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  /** When the user accepted the terms and privacy policy at sign-up. */
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  /**
   * Two-step sign-in (totp.ts): the authenticator secret, a secret being set up, since when it is on,
   * the last code step used (each code works once), and the hashes of the unused recovery codes.
   */
  totpSecret: text("totp_secret"),
  totpPending: text("totp_pending"),
  totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
  totpLastStep: integer("totp_last_step"),
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().notNull().default([]),
  /** A Creator's public track record page at /c/<username> (creators.ts): on or off, and what it says about them. */
  publicProfile: boolean("public_profile").notNull().default(false),
  displayName: text("display_name"),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time links sent by e-mail: verify an address, or set a new password. Only the token's hash is kept. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"verify" | "reset">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** The address the link went to: the one a verify link confirms. */
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);

export type PaymentStatus = "pending" | "claimed" | "paid" | "rejected" | "cancelled";

/**
 * Subscription payments, confirmed by an admin for now (bank transfer or QRIS).
 * An admin's grant without payment is recorded here too, at amount 0.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Shown to the payer and on the receipt, e.g. TA-7K3Q9P. */
    reference: text("reference").notNull().unique(),
    plan: text("plan").$type<PlanId>().notNull(),
    period: text("period").$type<Period>().notNull(),
    founding: boolean("founding").notNull().default(false),
    /** Rupiah to pay: the price less any coupon, plus a unique code, so one bank statement line matches one order. */
    amount: integer("amount").notNull(),
    uniqueCode: integer("unique_code").notNull().default(0),
    /** The coupon used (coupons.code) and the rupiah it took off the price. */
    couponCode: text("coupon_code"),
    discount: integer("discount").notNull().default(0),
    status: text("status").$type<PaymentStatus>().notNull().default("pending"),
    /** What the payer wrote when saying it is paid: bank, sender name. */
    note: text("note"),
    adminNote: text("admin_note"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** The plan period this payment bought, set when it is confirmed. */
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_user_idx").on(t.userId), index("payments_status_idx").on(t.status)],
);

/** The owner column every user's data carries. Nullable only so old rows can be given to the first admin at boot. */
const owner = () => uuid("user_id").references(() => users.id, { onDelete: "cascade" });

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    kind: text("kind").$type<JobKind>().notNull().default("analysis"),
    /** For a backtest: its tickers joined with commas. */
    ticker: text("ticker").notNull(),
    assetType: text("asset_type"),
    /** For a backtest: the first grid date. */
    tradeDate: text("trade_date").notNull(),
    request: jsonb("request").$type<AnalysisRequest | BacktestRequest>().notNull(),
    progress: jsonb("progress").$type<{ done: number; total: number; ticker: string | null; date: string | null }>(),
    result: jsonb("result").$type<BacktestResult>(),
    status: text("status").$type<AnalysisStatus>().notNull().default("queued"),
    rating: text("rating"),
    error: text("error"),
    agents: jsonb("agents").$type<Record<string, string>>().notNull().default({}),
    reports: jsonb("reports").$type<Record<string, string>>().notNull().default({}),
    stats: jsonb("stats").$type<RunStats>(),
    reportHtml: text("report_html"),
    reportDir: text("report_dir"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Refreshed by the server instance running the job; a running row whose heartbeat is stale has lost its server. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  },
  (t) => [
    index("analyses_created_at_idx").on(t.createdAt),
    index("analyses_kind_ticker_idx").on(t.kind, t.ticker),
    index("analyses_user_idx").on(t.userId, t.createdAt),
    // The runners' queue (jobs.ts claimNext): the oldest queued row, without reading the finished ones.
    index("analyses_queued_idx").on(t.createdAt).where(sql`${t.status} = 'queued'`),
  ],
);

/** A chat with the chart agent about one symbol (Yahoo spelling, e.g. BBCA.JK). */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    symbol: text("symbol").notNull(),
    title: text("title"),
    /** Running summary of the turns folded out of the prompt. */
    summary: text("summary"),
    /** The last message id the summary covers. */
    summarizedThrough: bigint("summarized_through", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_sessions_symbol_idx").on(t.symbol, t.updatedAt)],
);

export type AgentToolCall = { name: string; args: Record<string, unknown>; summary?: string };

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<AgentToolCall[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_messages_session_idx").on(t.sessionId, t.id)],
);

/** What the agent remembers: about the user (symbol null) or about one symbol. */
export const agentMemories = pgTable("agent_memories", {
  id: uuid("id").primaryKey(),
  userId: owner(),
  scope: text("scope").$type<"user" | "symbol">().notNull(),
  symbol: text("symbol"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DrawingKind = "level" | "trendline" | "zone" | "box" | "label" | "fib" | "trade_plan" | "note";

/** A drawing the agent put on a symbol's chart; validated by the worker against real prices. */
export const chartDrawings = pgTable(
  "chart_drawings",
  {
    id: uuid("id").primaryKey(),
    userId: owner(),
    symbol: text("symbol").notNull(),
    sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    kind: text("kind").$type<DrawingKind>().notNull(),
    label: text("label").notNull().default(""),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chart_drawings_symbol_idx").on(t.symbol)],
);

export type SkillStatus = "draft" | "active" | "archived" | "rejected" | "disabled";

export type SkillDefinition = {
  name: string;
  title: string;
  description: string;
  when_to_use: string;
  instruction: string;
  params: Record<string, number | string>;
  steps: { tool: string; args: Record<string, unknown> }[];
};

/**
 * Recipe skills the chart agent proposed, one row per version. At most one
 * version of a name is "active"; a new proposal is a "draft" until the user
 * approves it, which archives the previous active version.
 */
export const agentSkills = pgTable(
  "agent_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    status: text("status").$type<SkillStatus>().notNull().default("draft"),
    definition: jsonb("definition").$type<SkillDefinition>().notNull(),
    /** The worker's dry run on real prices when the skill was proposed. */
    test: jsonb("test").$type<{ symbol: string; ok: boolean; errors: string[]; steps: { tool: string; output: string }[] }>(),
    sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_skills_name_idx").on(t.name, t.version)],
);

/** Symbols a user has analysed automatically on each trading day (see watch.ts). */
export const watchlist = pgTable(
  "watchlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    /** Yahoo spelling (BBCA.JK), as the engine reads it. */
    symbol: text("symbol").notNull(),
    /** TradingView spelling (IDX:BBCA), for links back to the chart. */
    tvSymbol: text("tv_symbol").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watchlist_user_symbol_idx").on(t.userId, t.symbol)],
);

/** One scheduled watchlist run per user and day (YYYY-MM-DD in WIB); the unique key lets only one server instance start it. */
export const watchRuns = pgTable(
  "watch_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    day: text("day").notNull(),
    analysisIds: jsonb("analysis_ids").$type<string[]>().notNull().default([]),
    /** Symbols left out because the daily analysis cap had no room. */
    skipped: jsonb("skipped").$type<string[]>().notNull().default([]),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watch_runs_user_day_idx").on(t.userId, t.day)],
);

/** A user's own indicator script (web/shared/script.ts runs it in a sandbox). */
export const userScripts = pgTable(
  "user_scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    /** The Pine source it was translated from, if any. */
    pine: text("pine"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_scripts_user_name_idx").on(t.userId, t.name)],
);

/**
 * The chart's indicator catalog (indicators.ts): the built-in engines and the script indicators
 * an admin publishes, with who may use each, by plan and by account (indicator_grants). An
 * admin always may; an inactive one is hidden from everyone else and its alerts pause.
 */
export const indicators = pgTable("indicators", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** "scalper", "pob" or "fib" for a built-in engine; null for a published script. */
  builtin: text("builtin").$type<"pob" | "scalper" | "fib">().unique(),
  name: text("name").notNull(),
  /** The one line the Indikator menu shows under the name. */
  description: text("description").notNull().default(""),
  /** A published script's source (shared/script.ts), copied when published, so editing the admin's own script later changes nothing here. */
  code: text("code"),
  plans: jsonb("plans").$type<PlanId[]>().notNull().default(sql`'["free","pro","creator"]'::jsonb`),
  /** Switched on for an account that has not chosen its indicators yet. */
  defaultOn: boolean("default_on").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An account an admin lets use an indicator whatever its plan. */
export const indicatorGrants = pgTable(
  "indicator_grants",
  {
    indicatorId: uuid("indicator_id")
      .notNull()
      .references(() => indicators.id, { onDelete: "cascade" }),
    userId: owner().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("indicator_grants_pair_idx").on(t.indicatorId, t.userId), index("indicator_grants_user_idx").on(t.userId)],
);

/** Built-in engines, "script:<user_scripts.id>" for a user's own script, or "catalog:<indicators.id>" for one an admin published. */
export type SignalIndicator = "pob" | "scalper" | "fib" | `script:${string}` | `catalog:${string}`;
/** win = target, loss = stop, exit = a script's exit condition, expired = time limit, replaced = a newer signal. */
export type SignalStatus = "open" | "win" | "loss" | "exit" | "expired" | "replaced";

/** A user's request to hear about new signals of one indicator on one symbol and timeframe. */
export const signalAlerts = pgTable(
  "signal_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    /** Yahoo symbol, as the engine reads it (GC=F). */
    symbol: text("symbol").notNull(),
    tvSymbol: text("tv_symbol").notNull(),
    indicator: text("indicator").$type<SignalIndicator>().notNull(),
    timeframe: text("timeframe").notNull(),
    /** Set after the first scan, which records the signals that already existed without sending them. */
    primed: boolean("primed").notNull().default(false),
    /** For crypto: the venue whose bars are scanned (bybit, okx, …, venues.ts); empty = the default source (Binance). */
    venue: text("venue").notNull().default(""),
    /** A Creator's live signals from this alert go on their public record (creator_signals). */
    public: boolean("public").notNull().default(false),
    /**
     * The Scalper Pro+ inputs this alert's signals come from, where they differ from the defaults
     * (shared/scalper.ts); null = the defaults. They follow the owner's chart settings, moving only
     * when no signal the alert announced is still running (alerts.ts).
     */
    settings: jsonb("settings").$type<ScalperSignalSettings>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("signal_alerts_user_pair_idx").on(t.userId, t.symbol, t.indicator, t.timeframe, t.venue)],
);

/**
 * Every signal an alert has seen, so each is sent once and its outcome once. It carries its
 * owner and what it was on, so removing the alert keeps the signal in the member's history
 * (Beranda, GET /api/alerts/history).
 */
export const signalEvents = pgTable(
  "signal_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null once the alert is removed. */
    alertId: uuid("alert_id").references(() => signalAlerts.id, { onDelete: "set null" }),
    /** Copied from the alert as the signal is recorded; rows older than these columns got them in migration 0025. */
    userId: owner(),
    symbol: text("symbol"),
    tvSymbol: text("tv_symbol"),
    indicator: text("indicator").$type<SignalIndicator>(),
    timeframe: text("timeframe"),
    venue: text("venue"),
    /** The signal bar's time, exchange-local, as the engines print it. */
    signalTime: text("signal_time").notNull(),
    side: text("side").notNull(),
    label: text("label").notNull(),
    entry: doublePrecision("entry").notNull(),
    stopLoss: doublePrecision("stop_loss").notNull(),
    takeProfit: doublePrecision("take_profit").notNull(),
    status: text("status").$type<SignalStatus>().notNull().default("open"),
    exitTime: text("exit_time"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    closeNotifiedAt: timestamp("close_notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("signal_events_alert_time_idx").on(t.alertId, t.signalTime), index("signal_events_user_created_idx").on(t.userId, t.createdAt)],
);

export type PriceDirection = "above" | "below";

/**
 * "Tell me when the price reaches X": one message, once, when the price crosses the level.
 * Checked every minute beside the signal scan (price-alerts.ts); a fired alert stays as a record.
 */
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    /** Yahoo symbol, as the engine reads it (GC=F). */
    symbol: text("symbol").notNull(),
    tvSymbol: text("tv_symbol").notNull(),
    /** The name the user knows the asset by ("Emas"), from the app's market list, for the message. */
    label: text("label"),
    /** For crypto: the venue whose price is read (venues.ts); empty = the default source. */
    venue: text("venue").notNull().default(""),
    direction: text("direction").$type<PriceDirection>().notNull(),
    price: doublePrecision("price").notNull(),
    active: boolean("active").notNull().default(true),
    /** The newest 15m bar when the alert was armed: highs and lows from it and before never fire it. */
    armedBar: text("armed_bar"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    triggeredPrice: doublePrecision("triggered_price"),
    /** When the message reached Telegram or e-mail; null when neither is set up or both failed. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_alerts_active_idx").on(t.active, t.symbol), index("price_alerts_user_idx").on(t.userId, t.createdAt)],
);

/**
 * The signal ledger: every signal the built-in engines fire on the tracked symbols,
 * whoever watches them, frozen at birth and scored against later bars, with the
 * simulated account's costs. One row per engine, symbol, timeframe and signal bar.
 */
export const ledgerSignals = pgTable(
  "ledger_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** pob, scalper, fib (later desk, script:<id>). */
    source: text("source").notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    /** The signal bar's time, exchange-local, as the engines print it. */
    signalTime: text("signal_time").notNull(),
    /** The same moment in UTC, for ordering and sessions across exchanges. */
    signalAt: timestamp("signal_at", { withTimezone: true }).notNull(),
    /** asia, london or newyork, from signalAt. */
    session: text("session").notNull(),
    side: text("side").notNull(),
    label: text("label").notNull(),
    entry: doublePrecision("entry").notNull(),
    stopLoss: doublePrecision("stop_loss").notNull(),
    takeProfit: doublePrecision("take_profit").notNull(),
    status: text("status").$type<SignalStatus>().notNull().default("open"),
    exitTime: text("exit_time"),
    /** Result before costs, in R (risk = entry to stop). */
    grossR: doublePrecision("gross_r"),
    /** Spread and slippage of the simulated fill, in R. */
    costR: doublePrecision("cost_r").notNull(),
    /** binance (real time) or yahoo (delayed). */
    dataSource: text("data_source").notNull(),
    /** Seen within a few bars of firing; late ones (server down, data gap) are kept out of the stats. */
    live: boolean("live").notNull(),
    /** For crypto: the venue whose bars fired it (venues.ts); empty = the default source (Binance). */
    venue: text("venue").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ledger_signals_key_idx").on(t.source, t.symbol, t.timeframe, t.venue, t.signalTime),
    index("ledger_signals_at_idx").on(t.signalAt),
  ],
);

/** A strategy lab run (lab.ts): what was tested and its scored result, kept so runs can be compared. */
export const labRuns = pgTable(
  "lab_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    /** The strategy's name as shown: an engine's or the script's. */
    name: text("name").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lab_runs_user_idx").on(t.userId, t.createdAt)],
);

/** Recaps already sent, one per kind and period, so a restart never sends one twice. */
export const ledgerRecaps = pgTable(
  "ledger_recaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** daily or weekly. */
    kind: text("kind").notNull(),
    /** The period it covers: 2026-10-31 for a day, 2026-W44 for a week. */
    period: text("period").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ledger_recaps_kind_period_idx").on(t.kind, t.period)],
);

/** The public site's AI market brief (server/src/site.ts): what the model wrote, and the numbers it was given. */
export const marketBriefs = pgTable(
  "market_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    model: text("model").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("market_briefs_created_idx").on(t.createdAt)],
);

export type CouponKind = "percent" | "amount";

/** Discount codes an admin makes (server/src/coupons.ts): a share of the plan price, or rupiah off it. */
export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** What members type, upper case. */
  code: text("code").notNull().unique(),
  kind: text("kind").$type<CouponKind>().notNull(),
  /** Percent off (1–100) or rupiah off. */
  value: integer("value").notNull(),
  /** The plans and periods it applies to; empty means all. */
  plans: jsonb("plans").$type<PlanId[]>().notNull().default([]),
  periods: jsonb("periods").$type<Period[]>().notNull().default([]),
  /** Orders that may use it in all; null means no limit. */
  maxUses: integer("max_uses"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Messages sent once per account and occasion (server/src/reminders.ts); the key names the occasion, e.g. "renew:<plan end>:3". */
export const notices = pgTable(
  "notices",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notices_user_key_idx").on(t.userId, t.key)],
);

/**
 * A Creator's public track record (server/src/creators.ts): every live signal of an alert they
 * published, frozen when it fired and scored against later bars after the simulated costs, as in
 * the signal ledger. Rows are only added and scored. Deleting an alert or making it private never
 * takes them away, so the record cannot be trimmed afterwards.
 */
export const creatorSignals = pgTable(
  "creator_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The alert event this mirrors, so its outcome reaches the record; null once the alert is gone. */
    eventId: uuid("event_id")
      .unique()
      .references(() => signalEvents.id, { onDelete: "set null" }),
    alertId: uuid("alert_id").references(() => signalAlerts.id, { onDelete: "set null" }),
    symbol: text("symbol").notNull(),
    tvSymbol: text("tv_symbol").notNull(),
    venue: text("venue").notNull().default(""),
    /** The strategy's name when it fired: the script's, or the built-in engine's. */
    strategy: text("strategy").notNull(),
    timeframe: text("timeframe").notNull(),
    /** The signal bar's time, exchange-local, as the engines print it. */
    signalTime: text("signal_time").notNull(),
    side: text("side").notNull(),
    label: text("label").notNull(),
    entry: doublePrecision("entry").notNull(),
    stopLoss: doublePrecision("stop_loss").notNull(),
    takeProfit: doublePrecision("take_profit").notNull(),
    status: text("status").$type<SignalStatus>().notNull().default("open"),
    exitTime: text("exit_time"),
    /** Result before costs, in R; and the simulated costs, in R (ledger.ts tradeCost). */
    grossR: doublePrecision("gross_r"),
    costR: doublePrecision("cost_r").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("creator_signals_user_created_idx").on(t.userId, t.createdAt)],
);

/** The status page's daily tally per part (server/src/status.ts): how many checks ran, and how many found it down. */
export const statusDays = pgTable(
  "status_days",
  {
    /** The day in WIB, "2026-11-01". */
    day: text("day").notNull(),
    component: text("component").notNull(),
    checks: integer("checks").notNull().default(0),
    failures: integer("failures").notNull().default(0),
  },
  (t) => [uniqueIndex("status_days_day_component_idx").on(t.day, t.component)],
);

export type UsageKind = "analysis" | "backtest" | "agent" | "translate" | "brief";

/** Model tokens per worker command (server/src/tokens.ts): whose work, what for, which model. */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Null for the server's own work (the market brief) or an account since deleted. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").$type<UsageKind>().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_usage_created_idx").on(t.createdAt), index("llm_usage_user_created_idx").on(t.userId, t.createdAt)],
);

export const analysisEvents = pgTable(
  "analysis_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analysis_events_analysis_seq_idx").on(t.analysisId, t.seq)],
);

/**
 * Errors the server hit, kept 30 days for the admin console (errors.ts): a failed
 * request under the code its answer showed, or a background job that broke.
 */
export const serverErrors = pgTable(
  "server_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The short code in the 500 answer and on the request's log line. */
    code: text("code").notNull(),
    /** "request", or the background job that broke ("prices", "scan", …). */
    source: text("source").notNull(),
    method: text("method"),
    path: text("path"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    stack: text("stack"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("server_errors_created_at_idx").on(t.createdAt)],
);

/**
 * Small values every server instance must agree on (shared.ts): what the schedulers last did
 * and the latest status checks, written by the instance that runs the schedulers, read by all.
 */
export const sharedValues = pgTable("shared_values", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Work one instance does at a time (locks.ts): held until `expiresAt`, renewed while the work runs. */
export const leases = pgTable("leases", {
  key: text("key").primaryKey(),
  /** The lease's own token (locks.ts holdLease): only the handle that took it renews or releases it. */
  holder: text("holder").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Attempt counters for sign-in, two-step codes, sign-ups and mails (limits.ts): one fixed window per key. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_reset_at_idx").on(t.resetAt)],
);
