// A filled price band between two bar times, drawn on the candle series' pane.
// Lightweight Charts has no box drawing of its own; this is the smallest
// series primitive that paints one (the Scalper Pro+ entry zone).
import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

// fancy-canvas is lightweight-charts' own dependency, not ours; take its type from the renderer API.
type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];

export type Band ={ from: Time; to: Time; top: number; bottom: number; fill: string; stroke: string };

class BandRenderer implements IPrimitivePaneRenderer {
  constructor(private box: { x1: number; x2: number; y1: number; y2: number; fill: string; stroke: string } | null) {}

  draw(target: CanvasRenderingTarget2D) {
    const b = this.box;
    if (!b) return;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const x = Math.round(Math.min(b.x1, b.x2) * hr);
      const y = Math.round(Math.min(b.y1, b.y2) * vr);
      const w = Math.round(Math.abs(b.x2 - b.x1) * hr);
      const h = Math.round(Math.abs(b.y2 - b.y1) * vr);
      context.fillStyle = b.fill;
      context.fillRect(x, y, w, h);
      context.strokeStyle = b.stroke;
      context.lineWidth = Math.max(1, Math.round(hr));
      context.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    });
  }
}

export class BandPrimitive implements ISeriesPrimitive<Time> {
  #band: Band | null = null;
  #chart: IChartApi | null = null;
  #series: ISeriesApi<SeriesType> | null = null;
  #requestUpdate: (() => void) | null = null;

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this.#chart = chart;
    this.#series = series;
    this.#requestUpdate = requestUpdate;
  }

  detached() {
    this.#chart = this.#series = this.#requestUpdate = null;
  }

  set(band: Band | null) {
    this.#band = band;
    this.#requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const b = this.#band;
    const chart = this.#chart;
    const series = this.#series;
    let box = null;
    if (b && chart && series) {
      const x1 = chart.timeScale().timeToCoordinate(b.from);
      const x2 = chart.timeScale().timeToCoordinate(b.to);
      const y1 = series.priceToCoordinate(b.top);
      const y2 = series.priceToCoordinate(b.bottom);
      if (x1 != null && x2 != null && y1 != null && y2 != null) box = { x1, x2, y1, y2, fill: b.fill, stroke: b.stroke };
    }
    const renderer = new BandRenderer(box);
    return [{ renderer: () => renderer }];
  }
}
