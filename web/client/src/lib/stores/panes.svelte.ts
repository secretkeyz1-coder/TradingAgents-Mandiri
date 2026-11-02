// Sizes of the workspace panes the user dragged, in pixels, remembered per
// browser. null means "the default": the layout's own size until the user
// moves that splitter. The shell clamps them to the window it actually has.

const STORAGE_KEY = 'tradingagents.panes';

export const PANE_LIMITS = {
  // 360 so TradingView's quote list has room for the % change column, the figure traders scan first.
  market: { min: 200, max: 480, initial: 360 },
  ai: { min: 280, max: 640, initial: 352 },
  dock: { min: 120 },
  /** The chart never gets narrower or shorter than this. */
  chartWidth: 360,
  chartHeight: 200,
} as const;

type Sizes = { market: number | null; ai: number | null; dock: number | null };

function load(): Sizes {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
    return { market: num(saved.market), ai: num(saved.ai), dock: num(saved.dock) };
  } catch {
    return { market: null, ai: null, dock: null };
  }
}

class Panes {
  sizes = $state<Sizes>(load());

  set(pane: keyof Sizes, px: number | null) {
    this.sizes[pane] = px == null ? null : Math.round(px);
  }

  /** Called when a drag or key press ends, so storage is written once per move, not per frame. */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sizes));
    } catch {
      /* remembering the layout is a convenience */
    }
  }
}

export const panes = new Panes();
