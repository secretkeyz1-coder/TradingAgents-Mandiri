// The user's own indicator scripts, the editor's open state, and the bars the
// chart currently shows (the editor tests a script on them).
import { api, type UserScript } from '../api';
import type { ScriptBar } from '../../../../shared/script';

class Scripts {
  items = $state<UserScript[]>([]);
  templates = $state<{ name: string; code: string }[]>([]);
  reference = $state('');
  max = $state(20);
  error = $state('');
  editorOpen = $state(false);
  /** The script the editor opens on; null = a new one. */
  editing = $state<string | null>(null);
  /** The AI chart's bars, as the sandbox reads them. */
  bars = $state.raw<ScriptBar[]>([]);
  #loaded = false;

  async load(force = false) {
    if (this.#loaded && !force) return;
    this.#loaded = true;
    try {
      const data = await api.scripts();
      this.items = data.items;
      this.templates = data.templates;
      this.reference = data.reference;
      this.max = data.max;
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
      this.#loaded = false;
    }
  }

  open(id: string | null = null) {
    this.editing = id;
    this.editorOpen = true;
  }

  async save(id: string | null, body: { name: string; code: string; pine?: string | null }): Promise<UserScript> {
    const saved = id ? await api.updateScript(id, body) : await api.createScript(body);
    await this.load(true);
    return saved;
  }

  async remove(id: string) {
    await api.deleteScript(id);
    await this.load(true);
  }
}

export const scripts = new Scripts();
