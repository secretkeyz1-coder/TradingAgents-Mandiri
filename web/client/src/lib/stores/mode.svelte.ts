// Pemula or Pro: the simple screen that shows one asset at a time in plain words,
// or the full workspace. Kept in the account's preferences (ui.mode), so it follows
// the user to other devices. New members start in Pemula (server/src/auth.ts); an
// account without the key (older ones, admins) opens Pro.
import { api } from '../api';
import { auth } from '../auth.svelte';

export type Mode = 'pemula' | 'pro';

class ModeStore {
  value = $derived<Mode>(auth.user?.preferences.ui?.mode === 'pemula' ? 'pemula' : 'pro');

  /** Switch at once; the account copy follows, and a failed save puts the old mode back. */
  async set(next: Mode) {
    const user = auth.user;
    if (!user || next === this.value) return;
    const ui = { ...user.preferences.ui, mode: next };
    auth.user = { ...user, preferences: { ...user.preferences, ui } };
    try {
      auth.user = await api.updatePreferences({ ui });
    } catch (e) {
      if (auth.user) auth.user = { ...auth.user, preferences: { ...auth.user.preferences, ui: user.preferences.ui } };
      auth.notice = { tone: 'error', text: `Tampilan belum tersimpan: ${(e as Error).message}` };
    }
  }
}

export const mode = new ModeStore();
