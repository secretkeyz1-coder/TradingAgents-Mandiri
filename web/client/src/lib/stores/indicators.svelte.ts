// Indicators drawn on the AI chart, and their inputs. Only Scalper Pro+ for
// now. Remembered per browser at once and per account on the server, like the
// panel layout.
import { api } from '../api';
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
  settingsOpen = $state(false);
  #timer: ReturnType<typeof setTimeout> | undefined;

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

  resetScalper() {
    this.scalper = { ...SCALPER_DEFAULTS };
    this.save();
  }

  save() {
    const value = { scalperOn: this.scalperOn, scalper: { ...this.scalper } };
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
    const r = raw as { scalperOn?: unknown; scalper?: unknown };
    this.scalperOn = r.scalperOn === true;
    this.scalper = merge(r.scalper);
  }
}

export const indicators = new Indicators();
