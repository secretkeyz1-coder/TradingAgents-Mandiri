// Pantau → Alert's data: the price levels (server/src/price-alerts.ts) and signal alerts (server/src/alerts.ts) on
// the account. Pantau's head (PantauHead) counts them and keeps them fresh each minute while the page is open.
import { api, type PriceLevels, type SignalAlerts } from '../api';

class AlertsStore {
  levels = $state<PriceLevels | null>(null);
  signals = $state<SignalAlerts | null>(null);
  error = $state('');

  async load() {
    try {
      [this.levels, this.signals] = await Promise.all([api.priceLevels(), api.alerts()]);
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
}

export const alerts = new AlertsStore();
