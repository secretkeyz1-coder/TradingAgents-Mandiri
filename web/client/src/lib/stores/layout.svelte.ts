// How the workspace panels are arranged on a desktop-sized screen. Each panel
// (Pasar, Riset AI, the bottom panel) is docked to its edge, floating as a window
// over the chart, or minimised to the tray; focus mode gives the chart the
// whole screen and leaves only the floating panels. Remembered per browser at
// once, and per account on the server so another browser opens the same way.
// Phones keep their own one-panel-at-a-time layout and ignore all of this.
import { api } from '../api';
import { auth } from '../auth.svelte';

export type PanelId = 'market' | 'ai' | 'dock';
export type PanelMode = 'dock' | 'float' | 'min';
export type Rect = { x: number; y: number; w: number; h: number };
export type PresetId = 'classic' | 'focus' | 'analyst';

type Arrangement = {
  focus: boolean;
  modes: Record<PanelId, PanelMode>;
  /** Where each panel floats, in pixels from the workspace's top left; null = its default spot. */
  rects: Record<PanelId, Rect | null>;
};

export const PANELS: { id: PanelId; label: string; edge: 'left' | 'right' | 'bottom' }[] = [
  { id: 'market', label: 'Pasar', edge: 'left' },
  { id: 'ai', label: 'Riset AI', edge: 'right' },
  { id: 'dock', label: 'Panel bawah', edge: 'bottom' },
];

export const PRESETS: { id: PresetId; label: string; hint: string; arrangement: Arrangement }[] = [
  {
    id: 'classic',
    label: 'Klasik',
    hint: 'Pasar · chart · Riset AI · panel bawah',
    arrangement: { focus: false, modes: { market: 'dock', ai: 'dock', dock: 'dock' }, rects: { market: null, ai: null, dock: null } },
  },
  {
    id: 'focus',
    label: 'Fokus chart',
    hint: 'Chart penuh, Riset AI melayang',
    arrangement: { focus: true, modes: { market: 'min', ai: 'float', dock: 'min' }, rects: { market: null, ai: null, dock: null } },
  },
  {
    id: 'analyst',
    label: 'Analis',
    hint: 'Chart + laporan melayang besar',
    arrangement: { focus: false, modes: { market: 'min', ai: 'dock', dock: 'float' }, rects: { market: null, ai: null, dock: null } },
  },
];

export const MIN_SIZE = { w: 260, h: 200 };
const STORAGE_KEY = 'tradingagents.layout';
const MODES: PanelMode[] = ['dock', 'float', 'min'];

const clone = (a: Arrangement): Arrangement => ({ focus: a.focus, modes: { ...a.modes }, rects: { ...a.rects } });

/** A stored arrangement, or null when it is missing or malformed. */
function parse(raw: unknown): Arrangement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Arrangement>;
  const out = clone(PRESETS[0].arrangement);
  out.focus = r.focus === true;
  for (const { id } of PANELS) {
    const mode = r.modes?.[id];
    if (mode && MODES.includes(mode)) out.modes[id] = mode;
    const rect = r.rects?.[id];
    if (rect && [rect.x, rect.y, rect.w, rect.h].every((v) => typeof v === 'number' && Number.isFinite(v))) out.rects[id] = rect;
  }
  return out;
}

class Layout {
  focus = $state(false);
  modes = $state<Record<PanelId, PanelMode>>({ market: 'dock', ai: 'dock', dock: 'dock' });
  rects = $state<Record<PanelId, Rect | null>>({ market: null, ai: null, dock: null });
  /** Floating windows back to front. */
  order = $state<PanelId[]>(['market', 'dock', 'ai']);
  /** The user's own saved arrangement ("Layout saya"), kept on the account. */
  saved = $state<Arrangement | null>(null);
  /** The mode a minimised panel goes back to. */
  #before: Partial<Record<PanelId, PanelMode>> = {};
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    try {
      const local = parse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
      if (local) this.#apply(local);
    } catch {
      /* a fresh layout */
    }
  }

  /** Once the account is known: its saved layouts win over this browser's. */
  adopt() {
    const prefs = auth.user?.preferences?.layout as { current?: unknown; saved?: unknown } | undefined;
    const current = parse(prefs?.current);
    if (current) this.#apply(current);
    this.saved = parse(prefs?.saved);
  }

  /** What a panel actually does now: in focus mode a docked panel waits in the tray. */
  effective(id: PanelId): PanelMode {
    const mode = this.modes[id];
    return this.focus && mode === 'dock' ? 'min' : mode;
  }

  setMode(id: PanelId, mode: PanelMode) {
    if (mode === 'min' && this.modes[id] !== 'min') this.#before[id] = this.modes[id];
    this.modes[id] = mode;
    // Docking a panel in focus mode means the user wants the frame back.
    if (mode === 'dock' && this.focus) this.focus = false;
    if (mode === 'float') this.front(id);
    this.#changed();
  }

  /** Rail and tray buttons: show a hidden panel where it was, hide a shown one. */
  toggle(id: PanelId) {
    if (this.effective(id) !== 'min') this.setMode(id, 'min');
    else this.restore(id);
  }

  restore(id: PanelId) {
    const back = this.#before[id] ?? 'dock';
    this.setMode(id, this.focus && back === 'dock' ? 'float' : back);
  }

  front(id: PanelId) {
    if (this.order.at(-1) !== id) this.order = [...this.order.filter((p) => p !== id), id];
  }

  /** While dragging: no storage writes per frame. Call commit() when the drag ends. */
  move(id: PanelId, rect: Rect) {
    this.rects[id] = rect;
  }

  commit() {
    this.#changed();
  }

  toggleFocus() {
    this.focus = !this.focus;
    // Entering focus with nothing floating would leave the AI out of reach; float it.
    if (this.focus && !PANELS.some((p) => this.modes[p.id] === 'float')) this.modes.ai = 'float';
    this.#changed();
  }

  applyPreset(id: PresetId | 'saved') {
    const a = id === 'saved' ? this.saved : PRESETS.find((p) => p.id === id)?.arrangement;
    if (!a) return;
    // A preset keeps where the user last put each window.
    this.#apply({ ...clone(a), rects: { ...this.rects, ...Object.fromEntries(Object.entries(a.rects).filter(([, r]) => r)) } });
    this.#changed();
  }

  saveAsMine() {
    this.saved = this.#snapshot();
    this.#changed();
  }

  reset() {
    this.#apply(clone(PRESETS[0].arrangement));
    this.#changed();
  }

  #snapshot(): Arrangement {
    return clone({ focus: this.focus, modes: this.modes, rects: this.rects });
  }

  #apply(a: Arrangement) {
    this.focus = a.focus;
    this.modes = { ...a.modes };
    this.rects = { ...a.rects };
  }

  #changed() {
    const current = this.#snapshot();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      /* remembering the layout is a convenience */
    }
    // The account copy is written once things settle, not on every click.
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (!auth.user) return;
      api
        .updatePreferences({ layout: { current, saved: this.saved } })
        .then((user) => (auth.user = user))
        .catch(() => {
          /* this browser still has it */
        });
    }, 1200);
  }
}

export const layout = new Layout();
