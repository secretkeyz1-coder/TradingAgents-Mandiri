// Which provider and models a request runs on. Members always run on the
// server's own (the catalog defaults, as the watchlist and the site brief do),
// whatever their page sends; only admins choose another provider, model or
// backend URL. A backend URL receives the server's API key, so it is an admin's
// call alone, and members are not shown which key names or URLs the server has.
import { isAdmin, type User } from "./auth";
import { getCatalog, type Catalog } from "./worker";

type ModelChoice = { provider: string; quickModel: string; deepModel: string; backendUrl?: string };

/** The request as it will run: unchanged for an admin, on the server's defaults for anyone else. */
export async function modelsFor<T extends ModelChoice>(user: User, request: T): Promise<T> {
  if (isAdmin(user)) return request;
  const { provider, quickModel, deepModel, backendUrl } = (await getCatalog()).defaults;
  return { ...request, provider, quickModel, deepModel, backendUrl: backendUrl ?? undefined };
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
