export type ModelOption = { label: string; value: string };

export type Provider = {
  key: string;
  label: string;
  defaultUrl: string | null;
  apiKeyEnv: string | null;
  hasKey: boolean;
  needsUrl: boolean;
  models: { quick: ModelOption[]; deep: ModelOption[] };
};

export type Catalog = {
  providers: Provider[];
  analysts: { value: string; label: string }[];
  depths: { value: number; label: string; description: string }[];
  languages: string[];
  /** From the server's .env when set; `backendUrl` belongs to `provider` and the server fills it in itself. */
  defaults: { provider: string; quickModel: string; deepModel: string; backendUrl: string | null };
};

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

export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type RunStats = { llmCalls: number; toolCalls: number; tokensIn: number; tokensOut: number };

export type BacktestRequest = Omit<AnalysisRequest, 'ticker' | 'date'> & {
  tickers: string[];
  start: string;
  end: string;
  everyNDays: number;
  runId?: string;
};

export type BacktestProgress = { done: number; total: number; ticker: string | null; date: string | null };

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

export type AnalysisSummary = {
  id: string;
  kind: 'analysis' | 'backtest';
  ticker: string;
  tradeDate: string;
  status: AnalysisStatus;
  rating: string | null;
  request: AnalysisRequest;
  progress: BacktestProgress | null;
  createdAt: string;
  finishedAt: string | null;
  /** Who started it; filled in when an admin lists everyone's. */
  owner?: string | null;
};

/** An account as the page sees it (no password hash). */
export type Account = {
  id: string;
  username: string;
  role: 'admin' | 'member';
  disabled: boolean;
  /** null = the server default. */
  dailyAnalysisLimit: number | null;
  dailyChatLimit: number | null;
  telegramChatId: string | null;
  /** The page's own per-account settings: saved layout, indicator inputs, and Pemula or Pro (no `ui` = Pro). */
  preferences: { layout?: Record<string, unknown>; indicators?: Record<string, unknown>; ui?: { mode?: 'pemula' | 'pro' } };
  email: string | null;
  emailVerified: boolean;
  /** WhatsApp number in +62 form. */
  phone: string | null;
  /** Signs in with Google. */
  google: boolean;
  /** False for an account that only signs in with Google. */
  hasPassword: boolean;
  /** Two-step sign-in with an authenticator app is on. */
  twoFactor: boolean;
  /** The public track record at /c/<username> (Creator): on or off, and the name and bio above it. */
  publicProfile: boolean;
  displayName: string | null;
  bio: string | null;
  /** The plan in force (shared/plans.ts), its end (null = none) and what it allows. */
  plan: PlanId;
  planUntil: string | null;
  onTrial: boolean;
  trialUsed: boolean;
  limits: PlanLimits;
  createdAt: string;
};

export type BacktestSummary = Omit<AnalysisSummary, 'request'> & { request: BacktestRequest };

export type Backtest = BacktestSummary & {
  error: string | null;
  result: BacktestResult | null;
  startedAt: string | null;
};

import type { PlanId, PlanLimits } from '../../../shared/plans';
import { auth } from './auth.svelte';

export type { PlanId, PlanLimits };

export type PaymentStatus = 'pending' | 'claimed' | 'paid' | 'rejected' | 'cancelled';
/** A subscription order (server/src/billing.ts): rupiah, the unique code included in the amount. */
export type Payment = {
  id: string;
  reference: string;
  plan: PlanId;
  period: 'month' | 'year';
  founding: boolean;
  amount: number;
  uniqueCode: number;
  /** The coupon used and the rupiah it took off the price. */
  couponCode: string | null;
  discount: number;
  status: PaymentStatus;
  note: string | null;
  adminNote: string | null;
  createdAt: string;
  claimedAt: string | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** The invoice page's signed path (server/src/invoice.ts); it opens without signing in. */
  invoiceUrl: string;
};
export type Billing = {
  /** False until the server has PAYMENT_INSTRUCTIONS. */
  open: boolean;
  instructions: string;
  orderDays: number;
  founding: { price: number; left: number; mine: boolean };
  orders: Payment[];
};
export type AdminPayment = Payment & { user: { username: string; email: string | null; phone: string | null } };
export type AdminOverview = {
  members: number;
  newWeek: number;
  verified: number;
  pro: number;
  creator: number;
  trials: number;
  revenue: { month: number; last30: number };
  orders: { open: number; claimed: number };
};
/** What a coupon takes off each plan for one period, or why it does not apply (server/src/billing.ts). */
export type CouponQuote = { code: string; plans: Partial<Record<'pro' | 'creator', { discount: number; total: number } | { error: string }>> };
/** A discount code, with how often it was used (server/src/coupons.ts). */
export type Coupon = {
  id: string;
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  plans: PlanId[];
  periods: ('month' | 'year')[];
  maxUses: number | null;
  expiresAt: string | null;
  active: boolean;
  note: string | null;
  createdAt: string;
  paid: number;
  open: number;
  discountGiven: number;
};
export type NewCoupon = {
  code: string;
  kind: Coupon['kind'];
  value: number;
  plans: ('pro' | 'creator')[];
  periods: ('month' | 'year')[];
  maxUses: number | null;
  /** "2026-12-31": the code works through the end of that day, WIB. */
  lastDay: string | null;
  note: string | null;
};
type Tokens = { input: number; output: number; cost: number | null };
/** The admin's business dashboard (server/src/business.ts); rupiah without unique codes. */
export type BusinessReport = {
  subscribers: { paid: Record<'pro' | 'creator', Record<'month' | 'year', number>>; trials: number; granted: number };
  mrr: number;
  revenue: { month: string; amount: number; orders: number }[];
  conversion: { trials: number; converted: number };
  renewals: { week: number; month: number; soon: { username: string; plan: PlanId; until: string }[] };
  lapsed: number;
  coupons: { code: string; uses: number; discount: number }[];
  tokens: {
    total: Tokens;
    days: { day: string; input: number; output: number }[];
    kinds: (Tokens & { kind: string })[];
    models: (Tokens & { model: string })[];
    users: (Tokens & { username: string; plan: PlanId })[];
    priced: boolean;
  };
};

/** A user's own indicator script (web/shared/script.ts). */
export type UserScript = { id: string; name: string; code: string; pine: string | null; updatedAt: string };
export type UserScripts = {
  items: UserScript[];
  max: number;
  templates: { name: string; code: string }[];
  reference: string;
  limits: { timeMs: number; maxCode: number };
};

/** GET /api/admin/config: what is switched on and set up, for the console's settings page. */
export type AdminConfig = {
  signup: boolean;
  publicSite: boolean;
  publicUrl: string | null;
  google: boolean;
  telegram: boolean;
  mail: boolean;
  reminders: boolean;
  payments: boolean;
  siteBrief: boolean;
  tokenCost: boolean;
  /** How many backend URLs the server's API key may go to; 0 = any. */
  backendLimit: number;
  models: { provider: string; quick: string; deep: string } | null;
};

export type ServiceState = 'ok' | 'degraded' | 'down' | 'off';
/** A request that ended in a 500, or a background job that broke (server/src/errors.ts); kept 30 days. */
export type ServerError = {
  id: string;
  code: string;
  source: string;
  method: string | null;
  path: string | null;
  userId: string | null;
  message: string;
  stack: string | null;
  createdAt: string;
};

export type ServiceStatus = {
  checkedAt: string;
  overall: Exclude<ServiceState, 'off'>;
  days: number;
  parts: { key: string; name: string; state: ServiceState; detail: string; history: Record<string, number> }[];
};

/** A Telegram notification for new signals of one indicator on one symbol and timeframe. */
export type SignalAlert = {
  id: string;
  symbol: string;
  tvSymbol: string;
  /** A built-in engine, or `script:<id>` for a user's script. */
  indicator: string;
  timeframe: '15m' | '1h' | '4h' | '1d';
  /** The crypto venue whose bars it watches; "" = the default source (Binance, or Yahoo). */
  venue: string;
  primed: boolean;
  /** Its live signals go on the owner's public track record (Creator). */
  public: boolean;
  last: { signalTime: string; label: string; status: 'open' | 'win' | 'loss' | 'exit' | 'expired' | 'replaced' } | null;
};
export type SignalAlerts = {
  items: SignalAlert[];
  max: number;
  /** Signal alerts plus active price levels: they share the plan's allowance. */
  used: number;
  combos: { indicator: SignalAlert['indicator']; timeframe: SignalAlert['timeframe']; label: string }[];
  telegram: { bot: boolean; chat: boolean; configured: boolean };
};

/** "Kabari saya saat harga menyentuh X" (server/src/price-alerts.ts): fires once, then stays as a record. */
export type PriceLevel = {
  id: string;
  symbol: string;
  tvSymbol: string;
  label: string | null;
  /** Set from the price when it was added: above waits for a rise, below for a fall. */
  direction: 'above' | 'below';
  price: number;
  active: boolean;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  /** The message reached Telegram or e-mail. */
  notified: boolean;
  createdAt: string;
};

export type PriceLevels = {
  items: PriceLevel[];
  used: number;
  max: number;
  telegram: { bot: boolean; chat: boolean; configured: boolean };
  mail: boolean;
};

export const INTERVALS = ['15m', '1h', '4h', '1d', '1wk', '1mo'] as const;
export type Interval = (typeof INTERVALS)[number];

/** `time` is YYYY-MM-DD for 1d and up, YYYY-MM-DDTHH:MM:SS in the exchange's time zone for intraday. */
export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

export type CandleSeries = {
  symbol: string;
  currency: string | null;
  exchangeTimezone: string | null;
  interval: Interval;
  candles: Candle[];
  /** A crypto venue (binance, bybit, okx, …) = real time; yahoo = delayed. */
  source?: string;
};

/**
 * The one answer the Pemula screen shows for a ticker (server/src/routes.ts /verdict): the user's
 * latest finished analysis, else the daily AI brief's view of the asset; null when there is neither.
 */
export type Verdict =
  | { source: 'analysis'; id: string; date: string; rating: string; at: string | null; hasReport: boolean; summary: string }
  | { source: 'brief'; at: string; symbol: string; bias: 'naik' | 'turun' | 'netral'; bull: string; bear: string; watch: string }
  | null;

export type Decision = {
  source: 'analysis' | 'backtest';
  id: string;
  date: string;
  rating: string;
  /** From a settled backtest cell: the engine's own figures over its holding window. */
  return: number | null;
  alpha: number | null;
  pending: boolean | null;
};

export type Analysis = AnalysisSummary & {
  assetType: string | null;
  error: string | null;
  agents: Record<string, string>;
  reports: Record<string, string>;
  stats: RunStats | null;
  reportDir: string | null;
  startedAt: string | null;
  hasReportHtml: boolean;
};

export type DrawingKind = 'level' | 'trendline' | 'zone' | 'box' | 'label' | 'fib' | 'trade_plan' | 'note';

/** A drawing the chart agent put on a symbol's chart (validated by the worker). */
export type Drawing = {
  id: string;
  kind: DrawingKind;
  label: string;
  data: Record<string, any>;
  sessionId?: string | null;
  createdAt?: string;
};

export type AgentToolCall = { name: string; args: Record<string, unknown>; summary?: string };

export type AgentMessage = {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: AgentToolCall[];
  createdAt?: string;
};

export type AgentSession = {
  id: string;
  symbol: string;
  title: string | null;
  summary: string | null;
  updatedAt: string;
  messages?: AgentMessage[];
  busy?: boolean;
};

export type AgentMemory = { id: string; scope: 'user' | 'symbol'; symbol: string | null; content: string; createdAt: string };

export type SkillStatus = 'draft' | 'active' | 'archived' | 'rejected' | 'disabled';

/** One version of a recipe skill the agent proposed. */
export type AgentSkill = {
  id: string;
  name: string;
  version: number;
  status: SkillStatus;
  definition: {
    name: string;
    title: string;
    description: string;
    when_to_use: string;
    instruction: string;
    params: Record<string, number | string>;
    steps: { tool: string; args: Record<string, unknown> }[];
  };
  test: { symbol: string; ok: boolean; errors: string[]; steps: { tool: string; output: string }[] } | null;
  createdAt: string;
};

/** Symbols analysed automatically each trading day, and how that is set up on the server. */
export type Watchlist = {
  items: {
    symbol: string;
    tvSymbol: string;
    last: { id: string; rating: string | null; status: AnalysisStatus; tradeDate: string; createdAt: string } | null;
  }[];
  max: number;
  schedule: { time: string; days: number[]; next: string; analysts: string[]; depth: number };
  /** bot: the server has a bot token; chat: this user set their chat id. */
  telegram: { bot: boolean; chat: boolean; configured: boolean; links: boolean };
  lastRun: { day: string; analysisIds: string[]; skipped: string[]; notifiedAt: string | null } | null;
};

/** Today's use against the server's daily caps; a limit of 0 means no cap. */
export type Usage = {
  /** `left` also counts the server's total across users; null = no cap. */
  analyses: { used: number; limit: number; left: number | null };
  chat: { used: number; limit: number; left: number | null };
  resetsAt: string;
};

/** Results of a group of ledger signals (server/src/ledger.ts), R after costs unless named gross. */
export type LedgerStats = {
  key: string;
  count: number;
  closed: number;
  /** Closed with net R above zero, and the rest. */
  wins: number;
  losses: number;
  /** Closed at the target, at the stop, and any other way. */
  tp: number;
  sl: number;
  other: number;
  open: number;
  winRate: number | null;
  expectancy: number | null;
  grossExpectancy: number | null;
  avgCostR: number | null;
  profitFactor: number | null;
  totalR: number;
  maxDrawdownR: number;
};

export type LedgerItem = {
  id: string;
  source: string;
  symbol: string;
  timeframe: string;
  /** The crypto venue it was recorded on; "" = the default source. */
  venue: string;
  signalTime: string;
  signalAt: string;
  session: string;
  side: 'BUY' | 'SELL';
  label: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  status: 'open' | 'win' | 'loss' | 'exit' | 'expired' | 'replaced';
  exitTime: string | null;
  grossR: number | null;
  costR: number;
  netR: number | null;
  /** binance, yahoo or another venue's id. */
  dataSource: string;
  live: boolean;
  closedAt: string | null;
};

export type Ledger = {
  config: {
    symbols: string[];
    /** Venues crypto is recorded on (binance = the default source, which the simulated account counts), and the one shown. */
    venues: string[];
    venue: string;
    /** Round-trip cost of a crypto trade, as a fraction of price. */
    cryptoCost: number;
    startBalance: number;
    riskPct: number;
    riskUsd: number;
    staleBars: number;
    days: number;
    history: boolean;
  };
  total: LedgerStats;
  bySource: LedgerStats[];
  bySymbol: LedgerStats[];
  byTimeframe: LedgerStats[];
  bySession: LedgerStats[];
  /** The venues side by side on crypto, with the same filters. */
  byVenue: LedgerStats[];
  /** The same at each venue's base taker fee, paid in and out (a venue without a known fee is left out). */
  byVenueReal: LedgerStats[];
  /** Taker fee per side by venue; null = not known. */
  venueFees: Record<string, number | null>;
  equity: { time: string; equity: number }[];
  items: LedgerItem[];
};

/** Results of some lab trades (server/src/lab.ts), in R; net is after costs. */
export type LabStats = { n: number; win: number | null; gross: number | null; cost: number | null; net: number | null; pf: number | null; total: number; maxDrawdown: number };
export type LabConfig = {
  strategy: { kind: 'engine'; name: string } | { kind: 'script'; id: string };
  symbols: string[];
  timeframe: '15m' | '1h' | '4h' | '1d';
  days: number;
  costs: 'taker' | 'maker';
  split: number;
  expiry: number;
  /** For crypto symbols: the venue whose bars to test on (default Binance). */
  venue?: string;
};
export type LabSymbol =
  | { symbol: string; source: string; bars: number; from: string; to: string; split: string | null; is: LabStats; oos: LabStats }
  | { symbol: string; error: string };
export type LabRun = {
  id: string;
  name: string;
  createdAt: string;
  config: LabConfig;
  symbols: LabSymbol[];
  total: { is: LabStats; oos: LabStats };
  equity: { time: string; r: number; oos: boolean }[];
  verdict: { pass: boolean; reason: string };
  ms: number;
};
export type LabRunSummary = Pick<LabRun, 'id' | 'name' | 'createdAt' | 'config' | 'total' | 'verdict'>;

export type AgentTurn = {
  message: string;
  provider: string;
  quickModel: string;
  deepModel: string;
  language: string;
  backendUrl?: string;
  timeframe?: Interval;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) auth.expired();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  options: () => request<Catalog>('/options'),
  usage: () => request<Usage>('/usage'),
  watchlist: () => request<Watchlist>('/watchlist'),
  watchAdd: (symbol: string, tvSymbol: string) =>
    request<{ ok: true }>('/watchlist', { method: 'POST', body: JSON.stringify({ symbol, tvSymbol }) }),
  watchRemove: (symbol: string) => request<{ ok: true }>(`/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
  watchRun: () => request<{ ids: string[]; skipped: string[] }>('/watchlist/run', { method: 'POST' }),
  watchTest: () => request<{ ok: true }>('/watchlist/test', { method: 'POST' }),
  /** `everyone`: an admin's view of every user's history. */
  list: (everyone = false) => request<AnalysisSummary[]>(`/analyses${everyone ? '?scope=all' : ''}`),
  me: () => request<Account>('/me'),
  updateMe: (patch: { telegramChatId?: string | null; phone?: string | null }) => request<Account>('/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  resendVerification: () => request<{ ok: true; mailed: boolean }>('/me/verify-email', { method: 'POST' }),
  /** A new address takes effect once its verification link is opened. */
  setEmail: (email: string) => request<{ user: Account; mailed: boolean }>('/me/email', { method: 'POST', body: JSON.stringify({ email }) }),
  /** Each key replaces that preference whole; null removes it. */
  updatePreferences: (patch: Partial<Record<keyof Account['preferences'], Record<string, unknown> | null>>) =>
    request<Account>('/me/preferences', { method: 'PATCH', body: JSON.stringify(patch) }),
  /** `current` is left out when the account has no password yet (Google only). */
  changePassword: (current: string | undefined, next: string) =>
    request<{ ok: true }>('/me/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  /** Two-step sign-in (server/src/totp.ts): a pending secret, then the first code turns it on. */
  twoFactorSetup: () => request<{ secret: string; uri: string }>('/me/2fa/setup', { method: 'POST' }),
  twoFactorEnable: (code: string) => request<{ user: Account; recoveryCodes: string[] }>('/me/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFactorDisable: (code: string) => request<{ user: Account }>('/me/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFactorRecovery: (code: string) => request<{ recoveryCodes: string[] }>('/me/2fa/recovery', { method: 'POST', body: JSON.stringify({ code }) }),
  billing: () => request<Billing>('/billing'),
  order: (body: { plan: 'pro' | 'creator'; period: 'month' | 'year'; founding?: boolean; coupon?: string }) =>
    request<Payment>('/billing/orders', { method: 'POST', body: JSON.stringify(body) }),
  couponQuote: (code: string, period: 'month' | 'year') => request<CouponQuote>(`/billing/coupon?code=${encodeURIComponent(code)}&period=${period}`),
  adminCoupons: () => request<Coupon[]>('/admin/coupons'),
  createCoupon: (body: NewCoupon) => request<Coupon>('/admin/coupons', { method: 'POST', body: JSON.stringify(body) }),
  setCouponActive: (id: string, active: boolean) => request<Coupon>(`/admin/coupons/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  adminBusiness: () => request<BusinessReport>('/admin/business'),
  /** How the server is set up (switches and states, never secrets), for the admin console. */
  adminConfig: () => request<AdminConfig>('/admin/config'),
  adminErrors: () => request<{ items: ServerError[]; lastDay: number }>('/admin/errors'),
  /** The public status page's data (server/src/status.ts). */
  serviceStatus: () => request<ServiceStatus>('/public/status'),
  claimOrder: (id: string, note: string) => request<Payment>(`/billing/orders/${id}/claim`, { method: 'POST', body: JSON.stringify({ note }) }),
  cancelOrder: (id: string) => request<Payment>(`/billing/orders/${id}/cancel`, { method: 'POST' }),
  adminPayments: (status: 'open' | 'paid' | 'all') => request<AdminPayment[]>(`/admin/payments?status=${status}`),
  confirmPayment: (id: string, note = '') => request<Payment>(`/admin/payments/${id}/confirm`, { method: 'POST', body: JSON.stringify({ note }) }),
  rejectPayment: (id: string, reason: string) => request<Payment>(`/admin/payments/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  adminOverview: () => request<AdminOverview>('/admin/overview'),
  users: () => request<Account[]>('/users'),
  createUser: (body: { username: string; password: string; role: Account['role']; email?: string }) =>
    request<Account>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (
    id: string,
    patch: Partial<Pick<Account, 'role' | 'disabled' | 'dailyAnalysisLimit' | 'dailyChatLimit' | 'plan'>> & {
      password?: string;
      /** Last day of the plan, YYYY-MM-DD; null = no end. */
      planUntil?: string | null;
      emailVerified?: true;
      /** Turns two-step sign-in off, for someone who lost their phone and recovery codes. */
      twoFactor?: false;
    },
  ) => request<Account>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  get: (id: string) => request<Analysis>(`/analyses/${id}`),
  create: (body: AnalysisRequest) =>
    request<{ id: string }>('/analyses', { method: 'POST', body: JSON.stringify(body) }),
  cancel: (id: string) => request<{ ok: true }>(`/analyses/${id}/cancel`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: true }>(`/analyses/${id}`, { method: 'DELETE' }),
  eventsUrl: (id: string) => `/api/analyses/${id}/events`,
  reportUrl: (id: string) => `/api/analyses/${id}/report`,
  listBacktests: (everyone = false) => request<BacktestSummary[]>(`/analyses?kind=backtest${everyone ? '&scope=all' : ''}`),
  getBacktest: (id: string) => request<Backtest>(`/analyses/${id}`),
  createBacktest: (body: BacktestRequest) =>
    request<{ id: string; cells: number }>('/backtests', { method: 'POST', body: JSON.stringify(body) }),
  candles: (symbol: string, range: string, interval: Interval = '1d', venue?: string | null) =>
    request<CandleSeries>(`/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}${venue ? `&venue=${venue}` : ''}`),
  decisions: (ticker: string) => request<Decision[]>(`/decisions?ticker=${encodeURIComponent(ticker)}`),
  verdict: (ticker: string) => request<Verdict>(`/verdict?ticker=${encodeURIComponent(ticker)}`),
  agentSessions: (symbol: string) => request<AgentSession[]>(`/agent/sessions?symbol=${encodeURIComponent(symbol)}`),
  createAgentSession: (symbol: string) =>
    request<AgentSession>('/agent/sessions', { method: 'POST', body: JSON.stringify({ symbol }) }),
  agentSession: (id: string) => request<AgentSession>(`/agent/sessions/${id}`),
  deleteAgentSession: (id: string) => request<{ ok: true }>(`/agent/sessions/${id}`, { method: 'DELETE' }),
  memories: (symbol: string) => request<AgentMemory[]>(`/agent/memories?symbol=${encodeURIComponent(symbol)}`),
  deleteMemory: (id: string) => request<{ ok: true }>(`/agent/memories/${id}`, { method: 'DELETE' }),
  skills: () => request<AgentSkill[]>('/agent/skills'),
  skillAction: (id: string, action: 'approve' | 'reject' | 'disable' | 'enable' | 'restore') =>
    request<{ ok: true }>(`/agent/skills/${id}/${action}`, { method: 'POST' }),
  scripts: () => request<UserScripts>('/scripts'),
  createScript: (body: { name: string; code: string; pine?: string | null }) =>
    request<UserScript>('/scripts', { method: 'POST', body: JSON.stringify(body) }),
  updateScript: (id: string, body: { name?: string; code?: string; pine?: string | null }) =>
    request<UserScript>(`/scripts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteScript: (id: string) => request<{ ok: true }>(`/scripts/${id}`, { method: 'DELETE' }),
  /** The server's run of a script, to compare with the chart's. */
  runScriptOnServer: (body: { code: string; symbol: string; timeframe: string }) =>
    request<{ ok: boolean; error?: string; bars?: number; stats?: { count: number }; signals?: { time: string; label: string; entry: number }[] }>(
      '/scripts/run',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  translateScript: (body: { pine: string; provider: string; quickModel: string; deepModel: string; language: string; backendUrl?: string }) =>
    request<{ code: string }>('/scripts/translate', { method: 'POST', body: JSON.stringify(body) }),
  alerts: () => request<SignalAlerts>('/alerts'),
  priceLevels: (symbol?: string) => request<PriceLevels>(`/price-alerts${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`),
  priceLevelAdd: (body: { symbol: string; tvSymbol: string; price: number; label?: string }) =>
    request<PriceLevel>('/price-alerts', { method: 'POST', body: JSON.stringify(body) }),
  priceLevelRemove: (id: string) => request<{ ok: true }>(`/price-alerts/${id}`, { method: 'DELETE' }),
  lab: () =>
    request<{ engines: Record<string, { label: string; timeframes: string[] }>; scripts: { id: string; name: string }[]; maxDays: Record<string, number>; busy: boolean }>('/lab'),
  labRun: (config: LabConfig) => request<LabRun>('/lab/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) }),
  labRuns: () => request<LabRunSummary[]>('/lab/runs'),
  labRunGet: (id: string) => request<LabRun>(`/lab/runs/${id}`),
  labRunDelete: (id: string) => request<{ ok: true }>(`/lab/runs/${id}`, { method: 'DELETE' }),
  ledgerRecapTest: () => request<{ ok: boolean; error?: string; text: string }>('/ledger/recap-test', { method: 'POST' }),
  ledger: (q: { days: number; history: boolean; venue?: string; symbol?: string; source?: string; timeframe?: string; session?: string }) =>
    request<Ledger>(
      `/ledger?${new URLSearchParams(
        Object.entries({ ...q, history: q.history ? '1' : '' }).filter(([, v]) => v !== undefined && v !== '') as [string, string][],
      )}`,
    ),
  addAlert: (body: Pick<SignalAlert, 'symbol' | 'tvSymbol' | 'indicator' | 'timeframe'>) =>
    request<{ ok: true; id: string | null }>('/alerts', { method: 'POST', body: JSON.stringify(body) }),
  removeAlert: (id: string) => request<{ ok: true }>(`/alerts/${id}`, { method: 'DELETE' }),
  testAlert: () => request<{ ok: true }>('/alerts/test', { method: 'POST' }),
  /** Put an alert's signals on the public track record from now on, or stop; what is recorded stays. */
  setAlertPublic: (id: string, on: boolean) => request<{ id: string; public: boolean }>(`/alerts/${id}/public`, { method: 'PATCH', body: JSON.stringify({ public: on }) }),
  /** The public track record's settings; turning it on needs the Creator plan. */
  updateProfile: (patch: { publicProfile?: boolean; displayName?: string | null; bio?: string | null }) =>
    request<Account>('/me/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
  /** Add one of the app's own skills as a draft for this user to approve. */
  installSkill: (name: string) => request<{ id: string; version: number }>(`/agent/skills/builtin/${encodeURIComponent(name)}`, { method: 'POST' }),
  deleteSkill: (name: string) => request<{ ok: true }>(`/agent/skills/by-name/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  drawings: (symbol: string) => request<Drawing[]>(`/drawings?symbol=${encodeURIComponent(symbol)}`),
  deleteDrawing: (id: string) => request<{ ok: true }>(`/drawings/${id}`, { method: 'DELETE' }),
  clearDrawings: (symbol: string) => request<{ ok: true }>(`/drawings?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
  /** One agent turn; the reply is a server-sent event stream read from the POST response. */
  async sendAgentMessage(
    sessionId: string,
    turn: AgentTurn,
    onEvent: (type: string, data: any) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`/api/agent/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(turn),
      signal,
    });
    if (!res.ok || !res.body) {
      if (res.status === 401) auth.expired();
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        let type = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) onEvent(type, JSON.parse(data));
      }
    }
  },
};
