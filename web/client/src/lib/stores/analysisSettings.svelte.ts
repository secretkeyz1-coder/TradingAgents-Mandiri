// The settings an admin's own analyses, backtests and chat run with: the analyst team, depth,
// language, provider, models and backend URL, kept in this browser under the key the chat agent
// also reads (stores/agent.svelte.ts). They are changed in the admin console (admin/
// AnalysisSettingsPage); the forms in the app only show a line of them. Members never use them:
// they run the standard analysis on the server's models (shared/analysis.ts, server/src/models.ts).
import type { Catalog, Provider } from '../api';
import { catalog } from './catalog.svelte';

export const FORM_KEY = 'tradingagents.form';
/** The model list's entry for an ID typed by hand. */
export const CUSTOM = 'custom';

class AnalysisSettings {
  analysts = $state<string[]>(['market', 'social', 'news', 'fundamentals']);
  depth = $state(1);
  language = $state('Indonesian');
  providerKey = $state('');
  quickChoice = $state('');
  deepChoice = $state('');
  quickCustom = $state('');
  deepCustom = $state('');
  backendUrl = $state('');
  #restored = false;

  provider = $derived<Provider | undefined>(catalog.value?.providers.find((p) => p.key === this.providerKey));
  showUrl = $derived(!!this.provider && (this.provider.needsUrl || this.provider.key === 'ollama' || this.provider.key === 'openai_compatible'));
  quickModel = $derived(this.quickChoice === CUSTOM ? this.quickCustom.trim() : this.quickChoice);
  deepModel = $derived(this.deepChoice === CUSTOM ? this.deepCustom.trim() : this.deepChoice);

  /** What was saved in this browser, once the catalog (providers and their models) is in; the server's defaults otherwise. */
  restore(c: Catalog) {
    if (this.#restored) return;
    this.#restored = true;
    let saved: Record<string, any> = {};
    try {
      saved = JSON.parse(localStorage.getItem(FORM_KEY) ?? '{}');
    } catch {
      saved = {};
    }
    if (Array.isArray(saved.analysts) && saved.analysts.length) this.analysts = saved.analysts;
    if ([1, 3, 5].includes(saved.depth)) this.depth = saved.depth;
    if (c.languages.includes(saved.language)) this.language = saved.language;
    if (c.providers.some((p) => p.key === saved.provider)) {
      this.selectProvider(saved.provider, saved.quickModel, saved.deepModel);
      if (typeof saved.backendUrl === 'string') this.backendUrl = saved.backendUrl;
    } else {
      this.selectProvider(c.defaults.provider, c.defaults.quickModel, c.defaults.deepModel);
    }
  }

  /** A provider and the models to start from: the given ones when it lists them, else its first. */
  selectProvider(key: string, quick?: string, deep?: string) {
    this.providerKey = key;
    const p = catalog.value?.providers.find((x) => x.key === key);
    if (!p) return;
    const pick = (list: { value: string }[], preferred?: string) => (preferred && list.some((o) => o.value === preferred) ? preferred : (list[0]?.value ?? CUSTOM));
    this.quickChoice = pick(p.models.quick, quick);
    this.deepChoice = pick(p.models.deep, deep);
    // A remembered model the list no longer offers is kept as a custom ID.
    this.quickCustom = quick && this.quickChoice === CUSTOM && quick !== CUSTOM ? quick : '';
    this.deepCustom = deep && this.deepChoice === CUSTOM && deep !== CUSTOM ? deep : '';
    this.backendUrl = '';
  }

  /** What an admin's request carries. */
  get value() {
    return {
      analysts: this.analysts,
      depth: this.depth,
      provider: this.providerKey,
      quickModel: this.quickModel,
      deepModel: this.deepModel,
      language: this.language,
      backendUrl: this.showUrl ? this.backendUrl.trim() : '',
    };
  }

  /** Keep them in this browser, so the forms and the chat agent use them at once. */
  save() {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(this.value));
    } catch {
      /* remembering is a convenience */
    }
  }
}

export const analysisSettings = new AnalysisSettings();
