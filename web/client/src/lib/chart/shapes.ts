// Boxes with a tag and callout labels, painted on the candle series' pane: the
// agent's draw_box / draw_zone / draw_label drawings. One primitive holds them
// all, so a redraw is one call however many the agent made.
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

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** A box from one bar to another (to: null = to the right edge), its text on a tag at the right end. */
export type BoxShape = { type: 'box'; from: Time; to: Time | null; top: number; bottom: number; color: string; fill: string; text: string };
/** A tag pointing at a bar and price. */
export type LabelShape = { type: 'label'; time: Time; price: number; color: string; text: string };
export type Shape = BoxShape | LabelShape;

type Placed =
  | { type: 'box'; x1: number; x2: number | null; y1: number; y2: number; color: string; fill: string; text: string }
  | { type: 'label'; x: number; y: number; color: string; text: string };

const PAD = 6;
const HEIGHT = 18;
const POINT = 7;

/** A filled tag whose pointer touches (x, y); it points left unless there is no room on the right. */
function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, width: number) {
  const w = ctx.measureText(text).width + PAD * 2;
  const left = x + POINT + w <= width - 2;
  const bx = left ? x + POINT : x - POINT - w;
  const top = y - HEIGHT / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (left) {
    ctx.moveTo(x, y);
    ctx.lineTo(bx, top);
    ctx.lineTo(bx + w, top);
    ctx.lineTo(bx + w, top + HEIGHT);
    ctx.lineTo(bx, top + HEIGHT);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(bx + w, top + HEIGHT);
    ctx.lineTo(bx, top + HEIGHT);
    ctx.lineTo(bx, top);
    ctx.lineTo(bx + w, top);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, bx + PAD, y + 0.5);
}

class ShapesRenderer implements IPrimitivePaneRenderer {
  constructor(
    private shapes: Placed[],
    private font: string,
  ) {}

  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = `600 11px ${this.font}`;
      ctx.textBaseline = 'middle';
      for (const s of this.shapes) {
        if (s.type !== 'box') continue;
        const x2 = s.x2 ?? mediaSize.width;
        const x = Math.min(s.x1, x2);
        const y = Math.min(s.y1, s.y2);
        const w = Math.max(1, Math.abs(x2 - s.x1));
        const h = Math.max(1, Math.abs(s.y2 - s.y1));
        ctx.fillStyle = s.fill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
      }
      // Tags last, so a box never covers another box's text.
      for (const s of this.shapes) {
        if (s.type === 'label') tag(ctx, s.x, s.y, s.text, s.color, mediaSize.width);
        else if (s.text) {
          const x2 = s.x2 ?? mediaSize.width;
          const mid = (s.y1 + s.y2) / 2;
          const w = ctx.measureText(s.text).width + PAD * 2 + POINT;
          // An open-ended box reaches the edge: its tag sits inside, against the right side.
          tag(ctx, s.x2 == null || x2 + w > mediaSize.width ? Math.max(s.x1, x2 - w - 4) : x2, mid, s.text, s.color, mediaSize.width);
        }
      }
    });
  }
}

export class ShapesPrimitive implements ISeriesPrimitive<Time> {
  #shapes: Shape[] = [];
  #font = 'sans-serif';
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

  set(shapes: Shape[], font?: string) {
    this.#shapes = shapes;
    if (font) this.#font = font;
    this.#requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    const chart = this.#chart;
    const series = this.#series;
    const placed: Placed[] = [];
    if (chart && series) {
      const ts = chart.timeScale();
      for (const s of this.#shapes) {
        if (s.type === 'box') {
          const x1 = ts.timeToCoordinate(s.from);
          const x2 = s.to == null ? null : ts.timeToCoordinate(s.to);
          const y1 = series.priceToCoordinate(s.top);
          const y2 = series.priceToCoordinate(s.bottom);
          if (x1 == null || y1 == null || y2 == null || (s.to != null && x2 == null)) continue;
          placed.push({ type: 'box', x1, x2, y1, y2, color: s.color, fill: s.fill, text: s.text });
        } else {
          const x = ts.timeToCoordinate(s.time);
          const y = series.priceToCoordinate(s.price);
          if (x == null || y == null) continue;
          placed.push({ type: 'label', x, y, color: s.color, text: s.text });
        }
      }
    }
    const renderer = new ShapesRenderer(placed, this.#font);
    return [{ renderer: () => renderer }];
  }
}
