import { bigint, bigserial, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
  },
  (t) => [index("analyses_created_at_idx").on(t.createdAt), index("analyses_kind_ticker_idx").on(t.kind, t.ticker)],
);

/** A chat with the chart agent about one symbol (Yahoo spelling, e.g. BBCA.JK). */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
