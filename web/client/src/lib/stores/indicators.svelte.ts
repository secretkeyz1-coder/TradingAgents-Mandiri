// Indicators drawn on the AI chart, and their inputs. Which ones an account may
// draw is the admin's catalog (GET /api/indicators, server/src/indicators.ts):
// the built-in engines and the scripts the admin published. The choices are
// remembered per browser at once and per account on the server, like the panel
// layout; an account that never chose starts with the admin's defaults.
import { api, type CatalogIndicator } from '../api';
import { auth } from '../auth.svelte';
import { SCALPER_DEFAULTS, type ScalperSettings } from '../indicators/scalper';

const STORAGE_KEY = 'tradingagents.indicators';

/** Stored settings over the defaults, keeping only known keys of the right type. */
function merge(raw: unknown): ScalperSettings {
  const out = { ...SCALPER_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const k = key as keyof ScalperSettings;
    if (k in out && typeof value === typeof out[k] && (typeof value !== 'number' || Number.isFinite(value))) {
      (out as Record<string, unknown>)[k] = value;
    }
  }
  return out;
}

class Indicators {
  scalperOn = $state(false);
  scalper = $state<ScalperSettings>({ ...SCALPER_DEFAULTS });
  /** PoB BYSTRA setups (indicators/pob.ts), with the spec's default parameters. */
  pobOn = $state(false);
  /** Fibonacci golden zone pullbacks (indicators/fib.ts). */
  fibOn = $state(false);
  /** The user's own scripts drawn on the AI chart, by id. */
  scriptIds = $state<string[]>([]);
  /** Scripts the admin published, drawn on the AI chart, by key ("catalog:<id>"). */
  catalogIds = $state<string[]>([]);
  /** What this account may draw, in the menu's order; empty until loaded. */
  catalog = $state<CatalogIndicator[]>([]);
  loaded = $state(false);
  failed = $state(false);
  settingsOpen = $state(false);
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** Whether the admin opens this indicator to the account. */
  has(key: string) {
    return this.catalog.some((c) => c.key === key);
  }
  get showScalper() {
    return this.scalperOn && this.has('scalper');
  }
  get showPob() {
    return this.pobOn && this.has('pob');
  }
  get showFib() {
    return this.fibOn && this.has('fib');
  }
  /** Published scripts this account turned on and may still draw. */
  get published() {
    return this.catalog.filter((c) => !c.builtin && c.code && this.catalogIds.includes(c.key));
  }

  /** The catalog for this account, after adopt(): an account that never chose gets the admin's defaults. */
  async load() {
    try {
      this.catalog = (await api.indicators()).items;
      this.loaded = true;
      this.failed = false;
    } catch {
      this.failed = true; // the menu says so and the chart draws no indicator
      return;
    }
    if (auth.user && !auth.user.preferences?.indicators) {
      const on = (key: string) => this.catalog.some((c) => c.key === key && c.defaultOn);
      this.scalperOn = on('scalper');
      this.pobOn = on('pob');
      this.fibOn = on('fib');
      this.catalogIds = this.catalog.filter((c) => !c.builtin && c.defaultOn).map((c) => c.key);
    }
  }

  constructor() {
    try {
      this.#apply(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    } catch {
      /* defaults */
    }
  }

  /** Once the account is known: its settings win over this browser's. */
  adopt() {
    const saved = auth.user?.preferences?.indicators;
    if (saved) this.#apply(saved);
  }

  toggle() {
    this.scalperOn = !this.scalperOn;
    if (!this.scalperOn) this.settingsOpen = false;
    this.save();
  }

  togglePob() {
    this.pobOn = !this.pobOn;
    this.save();
  }

  toggleFib() {
    this.fibOn = !this.fibOn;
    this.save();
  }

  toggleScript(id: string, on = !this.scriptIds.includes(id)) {
    this.scriptIds = on ? [...new Set([...this.scriptIds, id])] : this.scriptIds.filter((x) => x !== id);
    this.save();
  }

  toggleCatalog(key: string, on = !this.catalogIds.includes(key)) {
    this.catalogIds = on ? [...new Set([...this.catalogIds, key])] : this.catalogIds.filter((x) => x !== key);
    this.save();
  }

  resetScalper() {
    this.scalper = { ...SCALPER_DEFAULTS };
    this.save();
  }

  save() {
    const value = {
      scalperOn: this.scalperOn,
      scalper: { ...this.scalper },
      pobOn: this.pobOn,
      fibOn: this.fibOn,
      scriptIds: [...this.scriptIds],
      catalogIds: [...this.catalogIds],
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* a convenience */
    }
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (!auth.user) return;
      api
        .updatePreferences({ indicators: value })
        .then((user) => (auth.user = user))
        .catch(() => {
          /* this browser still has it */
        });
    }, 1200);
  }

  #apply(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as { scalperOn?: unknown; scalper?: unknown; pobOn?: unknown; fibOn?: unknown; scriptIds?: unknown; catalogIds?: unknown };
    const ids = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 20) : []);
    this.scalperOn = r.scalperOn === true;
    this.pobOn = r.pobOn === true;
    this.fibOn = r.fibOn === true;
    this.scriptIds = ids(r.scriptIds);
    this.catalogIds = ids(r.catalogIds);
    this.scalper = merge(r.scalper);
  }
}

export const indicators = new Indicators();
