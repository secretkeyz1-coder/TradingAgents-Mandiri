import { api, type Catalog } from '../api';

/** Form options from the engine, fetched once and shared by every form. */
class CatalogStore {
  value = $state<Catalog | null>(null);
  error = $state('');
  #loading: Promise<void> | null = null;

  load(): Promise<void> {
    this.#loading ??= api
      .options()
      .then((c) => {
        this.value = c;
        this.error = '';
      })
      .catch((e) => {
        this.error = (e as Error).message;
        this.#loading = null; // a later call may retry
      });
    return this.#loading;
  }
}

export const catalog = new CatalogStore();
