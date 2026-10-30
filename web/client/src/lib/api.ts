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
};

export type BacktestSummary = Omit<AnalysisSummary, 'request'> & { request: BacktestRequest };

export type Backtest = BacktestSummary & {
  error: string | null;
  result: BacktestResult | null;
  startedAt: string | null;
};

import { auth } from './auth.svelte';

export const INTERVALS = ['1h', '4h', '1d', '1wk', '1mo'] as const;
export type Interval = (typeof INTERVALS)[number];

/** `time` is YYYY-MM-DD for 1d and up, YYYY-MM-DDTHH:MM:SS in the exchange's time zone for intraday. */
export type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };

export type CandleSeries = {
  symbol: string;
  currency: string | null;
  exchangeTimezone: string | null;
  interval: Interval;
  candles: Candle[];
};

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

export type DrawingKind = 'level' | 'trendline' | 'zone' | 'fib' | 'trade_plan' | 'note';

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

export type AgentTurn = {
  message: string;
  provider: string;
  quickModel: string;
  deepModel: string;
  language: string;
  backendUrl?: string;
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
  list: () => request<AnalysisSummary[]>('/analyses'),
  get: (id: string) => request<Analysis>(`/analyses/${id}`),
  create: (body: AnalysisRequest) =>
    request<{ id: string }>('/analyses', { method: 'POST', body: JSON.stringify(body) }),
  cancel: (id: string) => request<{ ok: true }>(`/analyses/${id}/cancel`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: true }>(`/analyses/${id}`, { method: 'DELETE' }),
  eventsUrl: (id: string) => `/api/analyses/${id}/events`,
  reportUrl: (id: string) => `/api/analyses/${id}/report`,
  listBacktests: () => request<BacktestSummary[]>('/analyses?kind=backtest'),
  getBacktest: (id: string) => request<Backtest>(`/analyses/${id}`),
  createBacktest: (body: BacktestRequest) =>
    request<{ id: string; cells: number }>('/backtests', { method: 'POST', body: JSON.stringify(body) }),
  candles: (symbol: string, range: string, interval: Interval = '1d') =>
    request<CandleSeries>(`/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`),
  decisions: (ticker: string) => request<Decision[]>(`/decisions?ticker=${encodeURIComponent(ticker)}`),
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
