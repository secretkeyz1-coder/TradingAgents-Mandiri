// Which provider and models a request runs on. Members always run on the
// server's own (the catalog defaults, as the watchlist and the site brief do),
// whatever their page sends; only admins choose another provider, model or
// backend URL. A backend URL receives the server's API key, so it is an admin's
// call alone, and members are not shown which key names or URLs the server has.
// Members' analyses and backtests also run the standard analysis (analysts, depth,
// language: shared/analysis.ts), which their form does not even show.
import { STANDARD_DEPTH, STANDARD_LANGUAGE, standardAnalysts, type Analyst } from "../../shared/analysis";
import { isAdmin, type User } from "./auth";
import { getCatalog, type Catalog } from "./worker";

type ModelChoice = { provider: string; quickModel: string; deepModel: string; backendUrl?: string };

/** The request as it will run: unchanged for an admin, on the server's defaults for anyone else. */
export async function modelsFor<T extends ModelChoice>(user: User, request: T): Promise<T> {
  if (isAdmin(user)) return request;
  const { provider, quickModel, deepModel, backendUrl } = (await getCatalog()).defaults;
  return { ...request, provider, quickModel, deepModel, backendUrl: backendUrl ?? undefined };
}

type AnalysisChoice = { analysts: Analyst[]; depth: 1 | 3 | 5; language: string };

/** The request as it will run: unchanged for an admin, the standard analysis of these tickers for anyone else. */
export function standardFor<T extends AnalysisChoice>(user: User, request: T, tickers: string[]): T {
  if (isAdmin(user)) return request;
  return { ...request, analysts: standardAnalysts(tickers), depth: STANDARD_DEPTH, language: STANDARD_LANGUAGE };
}

/**
 * A worker's message as this user may read it. A provider error names where it called, and for a member that is the
 * server's backend URL, which receives the server's API key: it is replaced, with its host, by "server".
 */
export async function shownTo(user: User, text: string): Promise<string> {
  return isAdmin(user) ? text : hideUrl(text, (await getCatalog()).defaults.backendUrl);
}

/** The text with `url` in it, written whole, without its trailing slash, or as its host, replaced by "server". */
export function hideUrl(text: string, url: string | null | undefined): string {
  if (!url) return text;
  const names = [url, url.replace(/\/+$/, "")];
  try {
    names.push(new URL(url).host);
  } catch {
    // not a URL: only the text as given is replaced
  }
  return names.filter(Boolean).reduce((out, name) => out.split(name).join("server"), text);
}

/** The form options a user may see: members get no key names or default URLs. */
export function catalogFor(user: User, catalog: Catalog): Catalog {
  if (isAdmin(user)) return catalog;
  return {
    ...catalog,
    providers: catalog.providers.map((p) => ({ ...p, apiKeyEnv: null, defaultUrl: null })),
    defaults: { ...catalog.defaults, backendUrl: null },
  };
}
