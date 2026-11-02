// The assets the app lists (tv.ts MARKET_TABS), looked up the same way everywhere: by name or code
// in the top search box (SymbolSearch), Riset AI's asset picker and switcher (workspace/AssetFinder),
// and by market for the market board and Alt+↑/↓.
import { MARKET_TABS, resolveSymbol, tabSymbols } from './tv';

/** Every listed asset once, [TradingView symbol, name], in the market lists' order. */
export const LISTED: [string, string][] = (() => {
  const seen = new Map<string, string>();
  for (const tab of MARKET_TABS) for (const [symbol, name] of tabSymbols(tab)) if (!seen.has(symbol)) seen.set(symbol, name);
  return [...seen.entries()];
})();

/** The market tab that lists a symbol, or null for one the lists do not have. */
export function marketOf(tv: string): string | null {
  return MARKET_TABS.find((t) => tabSymbols(t).some(([s]) => s === tv))?.key ?? null;
}

/** A market's symbols in its list's order. */
export const symbolsOf = (market: string): string[] => tabSymbols(MARKET_TABS.find((t) => t.key === market) ?? MARKET_TABS[0]).map(([s]) => s);

/** Listed assets whose name or code contains the text, names starting with it first. */
export function matching(text: string, limit = 30): [string, string][] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const hits = LISTED.filter(([symbol, name]) => name.toLowerCase().includes(t) || symbol.toLowerCase().includes(t));
  const starts = (x: [string, string]) => x[1].toLowerCase().startsWith(t) || (x[0].split(':')[1] ?? '').toLowerCase().startsWith(t);
  return [...hits.filter(starts), ...hits.filter((x) => !starts(x))].slice(0, limit);
}

/**
 * What typed text opens: an explicit symbol as typed (BBCA.JK, IDX:BBCA, BTC-USD), else the
 * listed asset it names or whose code it is ("emas", "BBCA"), else whatever the engine makes of it.
 * A name shared by several assets ("bank") opens nothing: the suggestions show the choice.
 */
export function findAsset(text: string): string | null {
  const t = text.trim();
  if (/[:.=^-]/.test(t)) return resolveSymbol(t)?.tv ?? null;
  const lower = t.toLowerCase();
  const named = LISTED.filter(([, name]) => name.toLowerCase().includes(lower));
  const exact = named.find(([, name]) => name.toLowerCase() === lower) ?? (named.length === 1 ? named[0] : null);
  const code = LISTED.find(([symbol]) => symbol.split(':')[1] === t.toUpperCase());
  if (exact || code) return (exact ?? code)![0];
  return named.length > 1 ? null : (resolveSymbol(t)?.tv ?? null);
}
