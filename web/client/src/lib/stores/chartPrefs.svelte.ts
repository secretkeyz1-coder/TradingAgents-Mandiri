// Per-browser choices about the AI chart's own furniture, kept across symbols (the chart is
// rebuilt for each one) and reloads. Only the navigator strip so far: it starts hidden, because
// on a laptop every row under the candles is taken from the candles, and dragging or scrolling the
// chart moves through time as well.
const STORAGE_KEY = 'tradingagents.chart';

function stored(): { navigator?: unknown } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

class ChartPrefs {
  /** The strip under the chart with every close and a box for the visible window. */
  navigator = $state(stored().navigator === true);

  toggleNavigator() {
    this.navigator = !this.navigator;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ navigator: this.navigator }));
    } catch {
      /* remembering is a convenience */
    }
  }
}

export const chartPrefs = new ChartPrefs();
