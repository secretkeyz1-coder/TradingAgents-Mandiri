// The landing page's live parts: the price tape, the research desk (prices and
// the AI's read with its bull and bear case), the crypto map, and the signal
// record, all from the public API (server/src/site.ts). The page reads fine
// without them: each part fills in when its data arrives, and prices refresh
// every minute while the tab is open. Model text is set as text, never HTML.

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

/** The desk's rows: the assets the AI reads. */
const DESK = ['BTC', 'ETH', 'Emas', 'IHSG'];
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

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/public/${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const price = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: v >= 10_000 ? 0 : v >= 1000 ? 1 : v >= 1 ? 2 : 8 });
const pct = (x: number | null) =>
  x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const r = (x: number | null) => (x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R`);
const tone = (x: number | null) => (x == null ? 'text-base-content/60' : x >= 0 ? 'text-success' : 'text-error');
const clock = (iso: string) => `${new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })} WIB`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** A 30-day line in the direction's colour. */
function spark(values: number[], up: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 20');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', `h-5 w-16 ${up ? 'text-success' : 'text-error'}`);
  svg.setAttribute('aria-hidden', 'true');
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * 64).toFixed(1)},${(18 - ((v - min) / span) * 16).toFixed(1)}`).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(line);
  return svg;
}

// --------------------------------------------------------------------------- tape and desk

let quotes: Quote[] = [];
let brief: Brief = null;
let focus = '';

function renderTape() {
  const tape = pick('[data-tape]');
  if (!tape || !quotes.length) return;
  tape.replaceChildren(
    ...quotes.map((q) => {
      const item = el('span', 'flex shrink-0 items-baseline gap-2');
      item.append(el('span', 'font-medium', q.label), el('span', 'tabular-nums', price(q.price)), el('span', `tabular-nums ${tone(q.change)}`, pct(q.change)));
      if (q.delayed) item.title = 'Data tertunda';
      return item;
    }),
  );
}

function renderDesk() {
  const list = pick('[data-desk-assets]');
  if (!list || !quotes.length) return;
  const reads = new Map((brief?.content.assets ?? []).map((a) => [a.symbol, a]));
  const rows = quotes.filter((q) => DESK.includes(q.label));
  if (!rows.some((q) => q.label === focus)) focus = rows.find((q) => reads.has(q.label))?.label ?? rows[0]?.label ?? '';
  list.replaceChildren(
    ...rows.map((q) => {
      const read = reads.get(q.label);
      const row = el('button', 'grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-2.5 text-left hover:bg-base-200 aria-pressed:bg-base-200 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_4rem_6.5rem]');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(q.label === focus));
      row.setAttribute('aria-label', `${q.label}: tampilkan bacaan AI`);
      const name = el('span', 'flex flex-col leading-tight');
      name.append(el('span', 'font-semibold', q.label));
      if (q.delayed) name.append(el('span', 'text-[11px] text-base-content/60', 'tertunda'));
      const lean = read ? LEAN[read.bias] : null;
      row.append(
        name,
        el('span', 'text-right tabular-nums', price(q.price)),
        el('span', `w-16 text-right tabular-nums ${tone(q.change)}`, pct(q.change)),
        Object.assign(el('span', 'hidden sm:block'), {}),
        el('span', `hidden text-right text-xs sm:block ${lean ? lean[1] : 'text-base-content/50'}`, lean ? lean[0] : '–'),
      );
      if (q.spark.length > 1) row.children[3].append(spark(q.spark, (q.change ?? 0) >= 0));
      row.addEventListener('click', () => {
        focus = q.label;
        renderDesk();
      });
      return row;
    }),
  );
  const stamp = pick('[data-desk-time]');
  if (stamp) stamp.textContent = `Harga ${clock(new Date().toISOString())}`;
  renderRead();
}

function renderRead() {
  const headline = pick('[data-brief-headline]');
  if (!headline) return;
  const parts = ['summary', 'case', 'watch', 'risk', 'figures', 'time'].map((p) => pick(`[data-brief-${p}]`));
  if (!brief) {
    headline.textContent = 'Ringkasan AI pertama sedang ditulis. Muat ulang halaman ini beberapa menit lagi.';
    for (const p of parts) p?.classList.add('hidden');
    return;
  }
  for (const p of parts) p?.classList.remove('hidden');
  const { content } = brief;
  headline.textContent = content.headline;
  pick('[data-brief-summary]')!.textContent = content.summary;
  pick('[data-brief-time]')!.textContent = `Ditulis AI ${clock(brief.createdAt)}.`;
  const read = content.assets.find((a) => a.symbol === focus) ?? content.assets[0];
  pick('[data-brief-asset]')!.textContent = read.symbol;
  pick('[data-brief-bull]')!.textContent = read.bull;
  pick('[data-brief-bear]')!.textContent = read.bear;
  // The model's own sentences already open with "Pantau…" or "Perhatikan…"; the risk line gets its label.
  pick('[data-brief-watch]')!.textContent = read.watch;
  pick('[data-brief-risk]')!.textContent = `Risiko: ${content.risk.replace(/^risiko:\s*/i, '')}`;
  renderFigures();
}

/** The numbers the AI was given, so anyone can check its read against them. */
function renderFigures() {
  const body = pick('[data-brief-figures] tbody');
  const rows = brief?.data.aset ?? [];
  if (!body) return;
  const num = (v: unknown, unit = '') => (typeof v === 'number' ? `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}${unit}` : '–');
  body.replaceChildren(
    ...rows.map((a) => {
      const tr = el('tr');
      for (const text of [String(a.symbol ?? ''), num(a.perubahan_1_hari_persen, '%'), num(a.perubahan_7_hari_persen, '%'), num(a.perubahan_30_hari_persen, '%'), num(a.rsi_14_hari), num(a.rata_rata_20_hari), num(a.rata_rata_50_hari)]) {
        tr.append(el('td', 'tabular-nums', text));
      }
      return tr;
    }),
  );
}

async function loadMarket() {
  const next = await get<Quote[]>('market');
  if (!next?.length) return;
  quotes = next;
  renderTape();
  renderDesk();
}

async function loadBrief() {
  brief = await get<Brief>('brief');
  renderRead();
  renderDesk();
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
    ...tiles.map((t, i) => {
      const size = i < 2 ? 'col-span-2 row-span-2' : i < 6 ? 'col-span-2' : '';
      const tile = el('div', `flex min-w-0 flex-col justify-between rounded-field p-2 ${size} ${tileTone(t.change)}`);
      tile.setAttribute('role', 'listitem');
      tile.setAttribute('aria-label', `${t.symbol} ${t.change >= 0 ? 'naik' : 'turun'} ${pct(t.change)}`);
      tile.append(el('span', i < 2 ? 'text-lg font-semibold' : 'text-sm font-semibold', t.symbol), el('span', 'text-sm tabular-nums', pct(t.change)));
      if (i < 2) tile.append(el('span', 'truncate text-xs tabular-nums opacity-80', `$${price(t.price)}`));
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
        side.append(el('span', `badge badge-sm badge-soft ${s.side === 'BUY' ? 'badge-success' : 'badge-error'}`, s.side === 'BUY' ? 'Beli' : 'Jual'));
        tr.append(
          el('td', 'whitespace-nowrap tabular-nums', when(s.time)),
          el('td', 'font-medium', s.symbol.replace(/-USD$/, '').replace('GC=F', 'Emas')),
          el('td', 'whitespace-nowrap', `${s.source} ${TF[s.timeframe] ?? s.timeframe}`),
          side,
          el('td', 'text-right tabular-nums', price(s.entry)),
          el('td', 'whitespace-nowrap', STATUS[s.status] ?? s.status),
          el('td', `text-right tabular-nums ${tone(s.netR)}`, r(s.netR)),
        );
        return tr;
      }),
    );
  }
  const record = pick('[data-record]');
  if (!record) return;
  const block = (title: string, note: string, rec: Record_) => {
    const box = el('div', 'flex flex-col gap-2 border-t border-base-300 pt-3');
    box.append(el('dt', 'font-semibold', title), el('dd', 'text-sm text-base-content/70', note));
    if (!rec.closed) {
      box.append(el('dd', 'text-sm', `Belum ada sinyal yang selesai${rec.open ? `; ${rec.open} masih berjalan` : ''}.`));
      return box;
    }
    const figures = el('dd', 'grid grid-cols-3 gap-2');
    for (const [label, value, cls] of [
      ['Selesai', String(rec.closed), ''],
      ['Untung bersih', rec.winRate == null ? '–' : `${Math.round(rec.winRate * 100)}%`, ''],
      ['Rata-rata', r(rec.expectancy), tone(rec.expectancy)],
    ] as const) {
      const cell = el('div', 'flex flex-col');
      cell.append(el('span', 'text-xs text-base-content/60', label), el('span', `text-lg font-semibold tabular-nums ${cls}`, value));
      figures.append(cell);
    }
    box.append(figures);
    if (rec.closed < 30) box.append(el('dd', 'text-xs text-base-content/60', 'Sampel masih kecil; angka ini akan bergerak.'));
    return box;
  };
  record.replaceChildren(
    block('Lolos Lab', 'Donchian breakout harian, dicatat live sejak lolos uji.', ledger.record.lab),
    block('Mesin sinyal bawaan', 'PoB, Scalper, dan Fib di 15m, 1j, dan harian.', ledger.record.engines),
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
