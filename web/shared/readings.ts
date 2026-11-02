// Indicators the AI reads in an analysis or an Uji saran AI (ADR 0017): which timeframes a
// reading may use and how many one request may carry. The form (client AnalysisForm), the
// server's check (server/src/readings.ts) and the worker (web/worker/readings.py) agree on these.

/** The candles a reading is computed on: the timeframes the worker's engines and the script sandbox all have. */
export const READING_TIMEFRAMES = ['15m', '1h', '1d'] as const;
export type ReadingTimeframe = (typeof READING_TIMEFRAMES)[number];

/** Each reading adds to the Market Analyst's prompt and to the run's time, so a request carries a few at most. */
export const MAX_READINGS = 3;

/** What a request stores per indicator; the source and the Scalper inputs stay on the server (publicRequest). */
export type IndicatorReading = {
  /** "scalper" | "pob" | "fib", "catalog:<id>" or "script:<id>", as the chart and the alerts name them. */
  key: string;
  name: string;
  timeframe: ReadingTimeframe;
  /** A built-in engine's name; absent for a script. */
  engine?: 'pob' | 'scalper' | 'fib';
  /** A script's source as it was when the request was made. */
  code?: string;
  /** Scalper Pro+: the account's own chart inputs (shared/scalper.ts names); null for the defaults. */
  settings?: Record<string, number | boolean> | null;
};

/** The timeframe an indicator is read on: PoB BYSTRA has no daily setups, so its daily reading is hourly. */
export function readingTimeframe(key: string, wanted: ReadingTimeframe): ReadingTimeframe {
  return key === 'pob' && wanted === '1d' ? '1h' : wanted;
}
