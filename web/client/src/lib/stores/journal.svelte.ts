// Pantau → Jurnal's data for the period picked (server/src/journal.ts). Pantau's head (PantauHead) shows how many
// trades are open and the period's result, and keeps it fresh each minute while the page is open.
import { api, type Journal } from '../api';

class JournalStore {
  days = $state(30);
  value = $state<Journal | null>(null);
  error = $state('');

  async load() {
    try {
      this.value = await api.journal(this.days);
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  setDays(days: number) {
    this.days = days;
    this.load();
  }
}

export const journal = new JournalStore();
