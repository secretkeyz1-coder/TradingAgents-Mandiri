// The landing page's live parts, all from the public API (server/src/site.ts): the hero
// landscape and the market summary (30 daily closes per market), the BTC chart with the
// levels the AI brief watches, the AI's read with its bull and bear case, the crypto map,
// and the signal record. The page reads fine without them: each part fills in when its data
// arrives, and prices refresh every minute while the tab is open. Model text is set as text,
// never HTML.

type Quote = { symbol: string; label: string; price: number; change: number | null; currency: string | null; delayed: boolean; time: string; spark: number[] };
type Lean = 'naik' | 'turun' | 'netral';
type BriefAsset = { symbol: string; bias: Lean; bull: string; bear: string; watch: string };
type Brief = {
  createdAt: string;
  content: { headline: string; summary: string; assets: BriefAsset[]; risk: string };
  data: { aset?: Record<string, string | number | boolean | null>[] };
} | null;
type Tile = { symbol: string; price: number; change: number; volume: number };
type Record_ = { closed: number; open: number; winRate: number | null; expectancy: number | null; totalR: number };
type Ledger = {
  days: number;
  latest: { time: string; symbol: string; source: string; timeframe: string; side: 'BUY' | 'SELL'; entry: number; status: string; netR: number | null }[];
  record: { lab: Record_; engines: Record_ };
};
type Level = { value: number | null; label: string; line: string; tag: string; dashed: boolean };

/** The hero's ridges, farthest first: BTC is the front one. */
const RIDGES = ['USD/IDR', 'S&P 500', 'IHSG', 'Emas', 'SOL', 'ETH', 'BTC'];
/** The rows beside the BTC chart. */
const WATCH = ['BTC', 'ETH', 'SOL', 'Emas', 'IHSG'];
const LEAN: Record<Lean, [string, string]> = {
  naik: ['condong naik', 'text-success'],
  turun: ['condong turun', 'text-error'],
  netral: ['netral', 'text-base-content/70'],
};
const STATUS: Record<string, string> = { open: 'berjalan', win: 'kena TP', loss: 'kena SL', exit: 'keluar', expired: 'kedaluwarsa', replaced: 'diganti' };
const TF: Record<string, string> = { '15m': '15m', '1h': '1j', '4h': '4j', '1d': 'harian' };

const pick = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag) as SVGElementTagNameMap[K];
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/public/${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const price = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: v >= 10_000 ? 0 : v >= 1000 ? 1 : v >= 1 ? 2 : 8 });
/** A level the AI names, to the cent: "81.117,56". */
const level = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const pct = (x: number | null) =>
  x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const r = (x: number | null) => (x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R`);
const tone = (x: number | null) => (x == null ? 'text-base-content/60' : x >= 0 ? 'text-success' : 'text-error');
const clock = (iso: string) => `${new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "x,y x,y …" for values spread evenly from x0 to x1, each placed at height y(value). */
function points(values: number[], x0: number, x1: number, y: (v: number) => number) {
  const step = (x1 - x0) / Math.max(1, values.length - 1);
  return values.map((v, i) => `${(x0 + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
}
/** The same points as a path's line segments: "Lx,y Lx,y …". */
const segments = (pts: string) => `L${pts.split(' ').join(' L')}`;

/** A 30-day line in the direction's colour. */
function spark(values: number[], up: boolean): SVGSVGElement {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const box = svg('svg', { viewBox: '0 0 120 36', preserveAspectRatio: 'none', class: `block h-10 w-full ${up ? 'text-success' : 'text-error'}`, 'aria-hidden': 'true' });
  box.append(
    svg('polyline', {
      points: points(values, 0, 120, (v) => 34 - ((v - min) / span) * 32),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  );
  return box;
}

let quotes: Quote[] = [];
let brief: Brief = null;
let focus = '';
const quote = (label: string) => quotes.find((q) => q.label === label);

// --------------------------------------------------------------------------- hero landscape

/**
 * Each market's 30 closes as one ridge on its own scale, in a 1440×440 box stretched to the
 * hero. The ridges are opaque, so the nearer ones hide the farther ones and the glow behind
 * shows only above them; their fill runs from a cobalt haze at the back to the page colour at
 * the front. The dot and tag mark the front ridge's live price.
 */
function renderLandscape() {
  const box = pick<SVGSVGElement>('[data-landscape]');
  const series = RIDGES.map(quote).filter((q): q is Quote => !!q && q.spark.length > 1);
  if (!box || !series.length) return;
  const shapes: SVGElement[] = [];
  let end = 0;
  series.forEach((q, i) => {
    const depth = series.length === 1 ? 6 : (i * 6) / (series.length - 1);
    const min = Math.min(...q.spark);
    const span = Math.max(...q.spark) - min || 1;
    const ys = q.spark.map((v) => 150 + depth * 38 - ((v - min) / span) * (60 + depth * 14));
    const last = ys[ys.length - 1];
    const line = `M0,${ys[0].toFixed(1)} ${segments(points(ys, 60, 1380, (v) => v))} L1440,${last.toFixed(1)}`;
    const fill = svg('path', { d: `${line} L1440,440 L0,440 Z` });
    fill.style.fill = `color-mix(in oklab, var(--color-accent) ${(14 * (1 - depth / 6)).toFixed(1)}%, var(--color-base-200))`;
    shapes.push(fill);
    const stroke = { d: line, fill: 'none', stroke: 'currentColor', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
    if (i < series.length - 1) {
      shapes.push(svg('path', { ...stroke, class: 'text-accent', 'stroke-opacity': (0.16 + depth * 0.05).toFixed(2), 'stroke-width': 1.2 }));
    } else {
      shapes.push(svg('path', { ...stroke, class: 'text-accent', 'stroke-opacity': 0.3, 'stroke-width': 8 }), svg('path', { ...stroke, class: 'text-base-content', 'stroke-width': 2 }));
      end = last;
    }
  });
  box.replaceChildren(...shapes);

  const now = pick('[data-landscape-now]');
  const dot = pick('[data-now-dot]');
  const tag = pick('[data-now-tag]');
  if (!now || !dot || !tag) return;
  const front = series[series.length - 1];
  const up = (front.change ?? 0) >= 0;
  now.style.top = `${((end / 440) * 100).toFixed(2)}%`;
  dot.classList.toggle('text-success', up);
  dot.classList.toggle('text-error', !up);
  tag.className = `absolute -right-2 bottom-3.5 rounded-full px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap tabular-nums ${up ? 'bg-success text-success-content' : 'bg-error text-error-content'}`;
  tag.textContent = `${front.label} ${price(front.price)}`;
  now.classList.remove('hidden');
}

// --------------------------------------------------------------------------- BTC chart

/** BTC's 30 closes against the levels the AI brief watches: its 20-day average and 30-day low. */
function renderChart() {
  const box = pick('[data-chart]');
  const q = quote('BTC');
  if (!box || !q || q.spark.length < 2) return;
  const figures = brief?.data.aset?.find((a) => a.symbol === 'BTC');
  const levels = (
    [
      { value: num(figures?.rata_rata_20_hari), label: 'Rata-rata 20 hari', line: 'text-base-content/60', tag: 'bg-base-300 text-base-content', dashed: true },
      { value: num(figures?.terendah_30_hari), label: 'Terendah 30 hari, dipantau AI', line: 'text-accent', tag: 'bg-accent text-accent-content', dashed: false },
    ] as Level[]
  ).filter((l): l is Level & { value: number } => l.value != null);
  const values = [...q.spark, ...levels.map((l) => l.value)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.06 || 1;
  const y = (v: number) => 28 + ((hi + pad - v) / (hi - lo + 2 * pad)) * 322;
  const at = (v: number) => (y(v) / 380) * 100;
  const pts = points(q.spark, 0, 1000, y);
  const up = (q.change ?? 0) >= 0;
  const last = q.spark[q.spark.length - 1];

  // The SVG is stretched to the box, so the labels and tags are HTML placed at the same heights.
  const plot = svg('svg', {
    viewBox: '0 0 1000 380',
    preserveAspectRatio: 'none',
    class: 'absolute inset-y-0 left-0 h-full w-[calc(100%-5.25rem)] overflow-visible',
    role: 'img',
    'aria-label': `Harga penutupan BTC 30 hari terakhir, kini ${price(q.price)} USDT`,
  });
  plot.append(svg('path', { d: `M0,380 ${segments(pts)} L1000,380 Z`, fill: 'currentColor', 'fill-opacity': 0.08, class: 'text-accent' }));
  for (const l of levels) {
    const at_ = y(l.value).toFixed(1);
    plot.append(
      svg('line', {
        x1: 0,
        x2: 1000,
        y1: at_,
        y2: at_,
        stroke: 'currentColor',
        class: l.line,
        'stroke-width': l.dashed ? 1 : 1.5,
        'stroke-dasharray': l.dashed ? '6 6' : 'none',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }
  plot.append(svg('polyline', { points: pts, fill: 'none', stroke: 'currentColor', class: 'text-base-content', 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));

  const parts: Element[] = [plot];
  for (const l of levels) {
    const label = el(
      'span',
      `absolute left-1 rounded-sm bg-base-100/85 px-1 text-[13px] whitespace-nowrap ${l.dashed ? '-translate-y-[calc(100%+2px)] text-base-content/75' : 'translate-y-0.5 text-accent'}`,
      l.label,
    );
    label.style.top = `${at(l.value).toFixed(2)}%`;
    parts.push(label);
  }
  // Price tags on the right edge, nudged apart when the price sits close to a level.
  const tags = [
    ...levels.map((l) => ({ top: at(l.value), text: level(l.value), cls: l.tag })),
    { top: at(last), text: price(q.price), cls: up ? 'bg-success text-success-content' : 'bg-error text-error-content' },
  ].sort((a, b) => a.top - b.top);
  tags.forEach((t, i) => {
    if (i && t.top - tags[i - 1].top < 7.5) t.top = tags[i - 1].top + 7.5;
    const tag = el('span', `absolute right-0 w-20 -translate-y-1/2 rounded-md py-0.5 text-center text-xs font-semibold tabular-nums ${t.cls}`, t.text);
    tag.style.top = `${t.top.toFixed(2)}%`;
    parts.push(tag);
  });
  const dot = el('span', `absolute right-[5.25rem] size-2.5 translate-x-1/2 -translate-y-1/2 rounded-full ${up ? 'bg-success' : 'bg-error'}`);
  dot.style.top = `${at(last).toFixed(2)}%`;
  parts.push(dot);
  box.replaceChildren(...parts);

  pick('[data-chart-price]')!.textContent = price(q.price);
  const change = pick('[data-chart-change]')!;
  change.textContent = pct(q.change);
  change.className = `tabular-nums ${tone(q.change)}`;
  pick('[data-chart-time]')!.textContent = `Harga ${clock(new Date().toISOString())}`;
}

/** The AI's lean on BTC and the levels it watches, beside the chart. */
function renderChartNote() {
  const note = pick('[data-chart-ai]');
  const stamp = pick('[data-chart-ai-time]');
  if (!note || !stamp) return;
  const read = brief?.content.assets.find((a) => a.symbol === 'BTC');
  if (!brief || !read) {
    note.textContent = 'Bacaan AI pertama sedang ditulis. Muat ulang halaman ini beberapa menit lagi.';
    return;
  }
  const lean = LEAN[read.bias][0];
  stamp.textContent = `Ditulis ${clock(brief.createdAt)}`;
  note.textContent = `${lean.charAt(0).toUpperCase()}${lean.slice(1)}. ${read.watch}`;
}

function renderWatch() {
  const list = pick('[data-watch]');
  const rows = WATCH.map(quote).filter((q): q is Quote => !!q);
  if (!list || !rows.length) return;
  list.replaceChildren(
    ...rows.map((q) => {
      const row = el('div', 'grid grid-cols-[minmax(0,1fr)_auto_4.5rem] gap-3 px-4 py-2.5 text-sm');
      const name = el('span', 'font-semibold', q.label);
      if (q.delayed) name.title = 'Data tertunda';
      row.append(name, el('span', 'text-right tabular-nums', price(q.price)), el('span', `text-right tabular-nums ${tone(q.change)}`, pct(q.change)));
      return row;
    }),
  );
}

// --------------------------------------------------------------------------- market summary

function renderMarket() {
  const grid = pick('[data-market]');
  if (!grid || !quotes.length) return;
  grid.replaceChildren(
    ...quotes.map((q) => {
      const card = el('article', 'flex min-w-0 flex-col gap-2.5 rounded-[0.875rem] border border-base-300 bg-base-100 p-4');
      card.append(el('h3', 'text-[15px] font-semibold', q.label));
      if (q.spark.length > 1) card.append(spark(q.spark, (q.change ?? 0) >= 0));
      const foot = el('p', 'flex justify-between gap-1.5 text-[13px]');
      foot.append(el('span', `tabular-nums ${tone(q.change)}`, pct(q.change)), el('span', 'text-base-content/60', q.delayed ? 'tertunda' : 'real-time'));
      card.append(el('p', 'text-xl font-semibold tracking-tight tabular-nums', price(q.price)), foot);
      return card;
    }),
  );
}

async function loadMarket() {
  const next = await get<Quote[]>('market');
  if (!next?.length) return;
  quotes = next;
  renderLandscape();
  renderChart();
  renderWatch();
  renderMarket();
}

// --------------------------------------------------------------------------- AI read

function renderBrief() {
  const headline = pick('[data-brief-headline]');
  if (!headline) return;
  const parts = ['summary', 'assets', 'case', 'watch', 'risk', 'figures'].map((p) => pick(`[data-brief-${p}]`));
  const read = brief?.content.assets.find((a) => a.symbol === focus) ?? brief?.content.assets[0];
  if (!brief || !read) {
    headline.textContent = 'Ringkasan AI pertama sedang ditulis. Muat ulang halaman ini beberapa menit lagi.';
    for (const p of parts) p?.classList.add('hidden');
    return;
  }
  for (const p of parts) p?.classList.remove('hidden');
  const { content } = brief;
  focus = read.symbol;
  headline.textContent = content.headline;
  pick('[data-brief-summary]')!.textContent = content.summary;
  pick('[data-brief-time]')!.textContent = `Ditulis ${clock(brief.createdAt)}, ${day(brief.createdAt)}`;
  pick('[data-brief-assets]')!.replaceChildren(
    ...content.assets.map((a) => {
      const on = a.symbol === focus;
      const chip = el('button', `btn btn-sm h-11 gap-2 rounded-full px-3.5 ${on ? 'border-accent bg-base-content/5' : 'border-base-300 bg-transparent'}`);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(on));
      chip.append(el('span', 'font-semibold', a.symbol), el('span', `font-normal ${LEAN[a.bias][1]}`, LEAN[a.bias][0]));
      chip.addEventListener('click', () => {
        focus = a.symbol;
        renderBrief();
      });
      return chip;
    }),
  );
  document.querySelectorAll('[data-brief-asset]').forEach((slot) => (slot.textContent = read.symbol));
  pick('[data-brief-bull]')!.textContent = read.bull;
  pick('[data-brief-bear]')!.textContent = read.bear;
  // The model's own sentences already open with "Pantau…" or "Level…"; the risk line gets its label.
  pick('[data-brief-watch]')!.textContent = read.watch;
  pick('[data-brief-risk]')!.textContent = `Risiko: ${content.risk.replace(/^risiko:\s*/i, '')}`;
  renderFigures();
}

/** The numbers the AI was given, so anyone can check its read against them. */
function renderFigures() {
  const body = pick('[data-brief-figures] tbody');
  const rows = brief?.data.aset ?? [];
  if (!body) return;
  const fig = (v: unknown, unit = '') => (typeof v === 'number' ? `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}${unit}` : '–');
  body.replaceChildren(
    ...rows.map((a) => {
      const tr = el('tr');
      tr.append(el('td', 'font-semibold', String(a.symbol ?? '')));
      for (const text of [fig(a.perubahan_1_hari_persen, '%'), fig(a.perubahan_7_hari_persen, '%'), fig(a.perubahan_30_hari_persen, '%'), fig(a.rsi_14_hari), fig(a.rata_rata_20_hari), fig(a.rata_rata_50_hari)]) {
        tr.append(el('td', 'tabular-nums', text));
      }
      return tr;
    }),
  );
}

async function loadBrief() {
  brief = await get<Brief>('brief');
  renderBrief();
  renderChart();
  renderChartNote();
}

// --------------------------------------------------------------------------- map

function tileTone(change: number) {
  const size = Math.abs(change);
  if (change >= 0) return size >= 0.03 ? 'bg-success text-success-content' : size >= 0.01 ? 'bg-success/45' : 'bg-success/20';
  return size >= 0.03 ? 'bg-error text-error-content' : size >= 0.01 ? 'bg-error/45' : 'bg-error/20';
}

async function loadMap() {
  const map = pick('[data-map]');
  const tiles = await get<Tile[]>('crypto-map');
  if (!map || !tiles?.length) return;
  map.replaceChildren(
    ...tiles.map((t) => {
      const tile = el('div', `flex min-h-13 min-w-0 flex-col justify-between rounded-md px-2 py-1.5 ${tileTone(t.change)}`);
      tile.setAttribute('role', 'listitem');
      tile.setAttribute('aria-label', `${t.symbol} ${t.change >= 0 ? 'naik' : 'turun'} ${pct(t.change)}`);
      tile.append(el('span', 'truncate text-xs font-semibold', t.symbol), el('span', 'text-[11px] tabular-nums', pct(t.change)));
      return tile;
    }),
  );
  const stamp = pick('[data-map-time]');
  if (stamp) stamp.textContent = `Binance, ${clock(new Date().toISOString())}`;
}

// --------------------------------------------------------------------------- signals and record

async function loadLedger() {
  const ledger = await get<Ledger>('signals');
  const body = pick('[data-signals]');
  if (!ledger || !body) return;
  if (!ledger.latest.length) {
    const tr = el('tr');
    tr.append(Object.assign(el('td', 'text-base-content/70', 'Belum ada sinyal live dalam 90 hari terakhir.'), { colSpan: 7 }));
    body.replaceChildren(tr);
  } else {
    body.replaceChildren(
      ...ledger.latest.map((s) => {
        const tr = el('tr');
        const side = el('td');
        side.append(el('span', `badge badge-sm badge-soft font-semibold ${s.side === 'BUY' ? 'badge-success' : 'badge-error'}`, s.side === 'BUY' ? 'Beli' : 'Jual'));
        tr.append(
          el('td', 'whitespace-nowrap tabular-nums text-base-content/75', when(s.time)),
          el('td', 'font-semibold', s.symbol.replace(/-USD$/, '').replace('GC=F', 'Emas')),
          el('td', 'whitespace-nowrap', `${s.source} ${TF[s.timeframe] ?? s.timeframe}`),
          side,
          el('td', 'text-right tabular-nums', price(s.entry)),
          el('td', 'whitespace-nowrap text-base-content/75', STATUS[s.status] ?? s.status),
          el('td', `text-right tabular-nums ${tone(s.netR)}`, r(s.netR)),
        );
        return tr;
      }),
    );
  }
  const record = pick('[data-record]');
  if (!record) return;
  const block = (title: string, note: string, rec: Record_) => {
    const box = el('div', 'flex flex-col gap-2.5 border-t border-base-300 pt-4.5');
    box.append(el('dt', 'font-semibold', title), el('dd', 'text-sm text-base-content/60', note));
    if (!rec.closed) {
      box.append(el('dd', 'text-[15px]', `Belum ada sinyal yang selesai${rec.open ? `; ${rec.open} masih berjalan` : ''}.`));
      return box;
    }
    const figures = el('dd', 'grid grid-cols-3 gap-3');
    for (const [label, value, cls] of [
      ['Selesai', String(rec.closed), ''],
      // The share of closed signals that won after costs, not a profit figure.
      ['Menang bersih', rec.winRate == null ? '–' : `${Math.round(rec.winRate * 100)}%`, ''],
      ['Rata-rata', r(rec.expectancy), tone(rec.expectancy)],
    ] as const) {
      const cell = el('div', 'flex flex-col gap-0.5');
      cell.append(el('span', 'text-xs text-base-content/60', label), el('span', `text-[22px] font-semibold tabular-nums ${cls}`, value));
      figures.append(cell);
    }
    box.append(figures);
    if (rec.closed < 30) box.append(el('dd', 'text-[13px] text-base-content/60', 'Sampel masih kecil; angka ini akan bergerak.'));
    return box;
  };
  record.replaceChildren(
    block('Mesin sinyal bawaan', 'PoB, Scalper, dan Fib di 15m, 1j, dan harian.', ledger.record.engines),
    block('Lolos Lab', 'Donchian breakout harian, dicatat live sejak lolos uji.', ledger.record.lab),
  );
}

loadMarket();
loadBrief();
loadMap();
loadLedger();
setInterval(() => {
  if (document.hidden) return;
  loadMarket();
  loadMap();
}, 60_000);
