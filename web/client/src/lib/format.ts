import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AnalysisStatus } from './api';

/** Agent reports are model-written markdown: render, then sanitize. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }));
}

export const SECTION_LABELS: Record<string, string> = {
  market_report: 'Analisa Pasar',
  sentiment_report: 'Sentimen',
  news_report: 'Berita',
  fundamentals_report: 'Fundamental',
  investment_plan: 'Keputusan Tim Riset',
  trader_investment_plan: 'Rencana Trader',
  final_trade_decision: 'Keputusan Portfolio Manager',
};

export const SECTION_ORDER = Object.keys(SECTION_LABELS);

export const TEAMS: { name: string; agents: string[] }[] = [
  { name: 'Tim Analis', agents: ['Market Analyst', 'Sentiment Analyst', 'News Analyst', 'Fundamentals Analyst'] },
  { name: 'Tim Riset', agents: ['Bull Researcher', 'Bear Researcher', 'Research Manager'] },
  { name: 'Trader', agents: ['Trader'] },
  { name: 'Manajemen Risiko', agents: ['Aggressive Analyst', 'Neutral Analyst', 'Conservative Analyst'] },
  { name: 'Portfolio', agents: ['Portfolio Manager'] },
];

export const STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: 'Antre',
  running: 'Berjalan',
  completed: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};

/** Colour carries price direction only: up green, down red; Hold and the rest stay neutral. */
export function ratingBadge(rating: string | null): string {
  const direction = RATING_DIRECTION[rating ?? ''] ?? 0;
  return direction > 0 ? 'badge-success badge-soft' : direction < 0 ? 'badge-error badge-soft' : 'badge-ghost';
}

/** The same rule for a rating set as text. */
export function ratingTone(rating: string | null): string {
  const direction = RATING_DIRECTION[rating ?? ''] ?? 0;
  return direction > 0 ? 'text-success' : direction < 0 ? 'text-error' : '';
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDuration(fromIso: string | null, toIso: string | null): string {
  if (!fromIso) return '–';
  const ms = (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime();
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} mnt ${s} dtk` : `${s} dtk`;
}

export function formatPercent(fraction: number | null | undefined, signed = true): string {
  if (fraction == null || Number.isNaN(fraction)) return '–';
  const text = (fraction * 100).toLocaleString('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return signed && fraction > 0 ? `+${text}%` : `${text}%`;
}

/** What a rating claims will happen (as in tradingagents.backtest): up, down, or no direction. */
export const RATING_DIRECTION: Record<string, number> = { Buy: 1, Overweight: 1, Hold: 0, Underweight: -1, Sell: -1 };

export function formatNumber(n: number | undefined): string {
  return (n ?? 0).toLocaleString('id-ID');
}

/** The dates a backtest runs (tradingagents.backtest.iter_grid): start, every n days, never past today. */
export function gridDates(start: string, end: string, everyNDays: number): string[] {
  if (!start || !end || everyNDays < 1) return [];
  const last = end < today() ? end : today();
  const dates: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + everyNDays)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export function today(): string {
  return new Date().toLocaleDateString('en-CA');
}
