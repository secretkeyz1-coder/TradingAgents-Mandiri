// The standard analysis: what a member's analyses and backtests always run, and what
// the Pemula card asks for. Every analyst that has something to read, the shallowest
// depth, in Indonesian. Members never see these settings; the server applies them
// whatever a page sends (standardFor in server/src/models.ts).

export type Analyst = "market" | "social" | "news" | "fundamentals";

export const STANDARD_DEPTH = 1;
export const STANDARD_LANGUAGE = "Indonesian";

/** Assets with no company behind them: the fundamentals analyst has nothing to read. */
export function hasNoFundamentals(yahoo: string): boolean {
  const s = yahoo.trim().toUpperCase();
  return /-(USD|USDT|USDC|BTC|ETH)$/.test(s) || s.endsWith("=X") || s.endsWith("=F") || s.startsWith("^");
}

/** The analysts a standard run uses: fundamentals when at least one of the tickers has a company behind it. */
export function standardAnalysts(tickers: string[]): Analyst[] {
  const out: Analyst[] = ["market", "social", "news"];
  if (!tickers.every(hasNoFundamentals)) out.push("fundamentals");
  return out;
}
