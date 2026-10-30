// Today's use of the daily caps the server enforces (web/server/src/usage.ts),
// shown next to the buttons that spend it. The server has the last word; this
// only lets the page say so before the user clicks.
import { api, type Usage } from '../api';

class UsageStore {
  value = $state<Usage | null>(null);

  async refresh() {
    this.value = await api.usage().catch(() => this.value);
  }

  /** How many more of `kind` fit today; Infinity when that cap is off. */
  left(kind: 'analyses' | 'chat'): number {
    const u = this.value?.[kind];
    if (!u || !u.limit) return Infinity;
    return Math.max(0, u.limit - u.used);
  }
}

export const usage = new UsageStore();
