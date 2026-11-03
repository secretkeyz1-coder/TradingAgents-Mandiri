// The user's own indicator scripts, the editor's open state, and the bars the
// chart currently shows (the editor tests a script on them).
import { api, type UserScript, type UserScripts } from '../api';
import type { ScriptBar } from '../../../../shared/script';
import type { SandboxContext } from '../indicators/script-host';

class Scripts {
  items = $state<UserScript[]>([]);
  templates = $state<{ name: string; code: string }[]>([]);
  reference = $state('');
  /** The editor's Panduan tab (shared/script-guide.ts). */
  guide = $state.raw<UserScripts['guide']>([]);
  dictionary = $state.raw<UserScripts['dictionary']>([]);
  max = $state(20);
  error = $state('');
  editorOpen = $state(false);
  /** The script the editor opens on; null = a new one. */
  editing = $state<string | null>(null);
  /** The tab it opens on: the code, Pine to paste TradingView code for the AI to translate, a prompt for the AI to write from, or the guide. */
  startTab = $state<'code' | 'pine' | 'prompt' | 'help'>('code');
  /** The AI chart's bars, as the sandbox reads them. */
  bars = $state.raw<ScriptBar[]>([]);
  /** Their timeframe and the zone their times are written in, which a script's timeframe and sessions read. */
  context = $state.raw<SandboxContext>({});
  #loaded = false;

  async load(force = false) {
    if (this.#loaded && !force) return;
    this.#loaded = true;
    try {
      const data = await api.scripts();
      this.items = data.items;
      this.templates = data.templates;
      this.reference = data.reference;
      this.guide = data.guide;
      this.dictionary = data.dictionary;
      this.max = data.max;
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
      this.#loaded = false;
    }
  }

  open(id: string | null = null, tab: 'code' | 'pine' | 'prompt' | 'help' = 'code') {
    this.editing = id;
    this.startTab = tab;
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
