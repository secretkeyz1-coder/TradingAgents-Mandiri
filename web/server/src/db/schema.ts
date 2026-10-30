import { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  /** argon2id, from Bun.password. */
  passwordHash: text("password_hash").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export type DrawingKind = "level" | "trendline" | "zone" | "fib" | "trade_plan" | "note";

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

/** Built-in engines, or "script:<user_scripts.id>" for a user's own script. */
export type SignalIndicator = "pob" | "scalper" | "fib" | `script:${string}`;
export type SignalStatus = "open" | "win" | "loss" | "expired" | "replaced";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("signal_alerts_user_pair_idx").on(t.userId, t.symbol, t.indicator, t.timeframe)],
);

/** Every signal an alert has seen, so each is sent once and its outcome once. */
export const signalEvents = pgTable(
  "signal_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => signalAlerts.id, { onDelete: "cascade" }),
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
  (t) => [uniqueIndex("signal_events_alert_time_idx").on(t.alertId, t.signalTime)],
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
