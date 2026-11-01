// A Creator's public track record (/c/<username>, server/src/creators.ts): who
// they are, their record after costs overall and per strategy, and their latest
// signals. The name and bio are the owner's own words, so they are set as text,
// never HTML.
import { BRAND } from '../../../shared/brand';

type Tally = { closed: number; open: number; winRate: number | null; avgR: number | null; totalR: number };
type Signal = {
  at: string;
  symbol: string;
  strategy: string;
  timeframe: string;
  side: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  status: string;
  netR: number | null;
};
type Page = {
  username: string;
  name: string;
  bio: string;
  since: string | null;
  record: Tally;
  strategies: (Tally & { strategy: string; timeframe: string })[];
  signals: Signal[];
};

const STATUS: Record<string, string> = { open: 'berjalan', win: 'kena TP', loss: 'kena SL', exit: 'keluar', expired: 'kedaluwarsa', replaced: 'diganti' };
const TF: Record<string, string> = { '15m': '15m', '1h': '1j', '4h': '4j', '1d': 'harian' };

const pick = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const price = (v: number) => v.toLocaleString('id-ID', { maximumFractionDigits: v >= 10_000 ? 0 : v >= 1000 ? 1 : v >= 1 ? 2 : 8 });
const r = (x: number | null) => (x == null ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R`);
const tone = (x: number | null) => (x == null ? 'text-base-content/60' : x >= 0 ? 'text-success' : 'text-error');
const share = (x: number | null) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const when = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' });

/** A table's only row, for when it has nothing to list. */
function empty(columns: number, text: string) {
  const tr = el('tr');
  tr.append(Object.assign(el('td', 'text-base-content/60', text), { colSpan: columns }));
  return tr;
}

function render(p: Page) {
  document.title = `Rekam jejak ${p.name} · ${BRAND.name}`;
  pick('[data-name]').textContent = p.name;
  pick('[data-handle]').textContent = `@${p.username}`;
  pick('[data-since]').textContent = p.since ? `Mencatat sejak ${day(p.since)}` : 'Belum ada sinyal tercatat';
  const bio = pick('[data-bio]');
  bio.textContent = p.bio;
  bio.hidden = !p.bio;

  const figures: [string, string, string][] = [
    ['Selesai', String(p.record.closed), ''],
    // The share of closed signals that won after costs, not a profit figure.
    ['Menang bersih', share(p.record.winRate), ''],
    ['Rata-rata per sinyal', r(p.record.avgR), tone(p.record.avgR)],
    ['Total', p.record.closed ? r(p.record.totalR) : '–', p.record.closed ? tone(p.record.totalR) : ''],
    ['Masih berjalan', String(p.record.open), ''],
  ];
  pick('[data-record]').replaceChildren(
    ...figures.map(([label, value, cls], i) => {
      // Five cells in two columns on a phone: the last one takes the whole row.
      const cell = el('div', `flex flex-col gap-1 bg-base-100 p-4 ${i === figures.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`);
      cell.append(el('dt', 'text-xs text-base-content/60', label), el('dd', `text-2xl font-semibold tabular-nums ${cls}`, value));
      return cell;
    }),
  );
  pick('[data-sample]').hidden = p.record.closed >= 30;

  const strategies = pick('[data-strategies]');
  if (!p.strategies.length) strategies.replaceChildren(empty(7, 'Belum ada sinyal tercatat.'));
  else
    strategies.replaceChildren(
      ...p.strategies.map((s) => {
        const tr = el('tr');
        tr.append(
          el('td', 'font-semibold', s.strategy),
          el('td', 'whitespace-nowrap', TF[s.timeframe] ?? s.timeframe),
          el('td', 'text-right tabular-nums', String(s.closed)),
          el('td', 'text-right tabular-nums', share(s.winRate)),
          el('td', `text-right tabular-nums ${tone(s.avgR)}`, r(s.avgR)),
          el('td', `text-right tabular-nums ${s.closed ? tone(s.totalR) : 'text-base-content/60'}`, s.closed ? r(s.totalR) : '–'),
          el('td', 'text-right tabular-nums', String(s.open)),
        );
        return tr;
      }),
    );

  const signals = pick('[data-signals]');
  if (!p.signals.length) signals.replaceChildren(empty(9, 'Belum ada sinyal tercatat. Sinyal muncul di sini begitu alert publiknya menangkap sinyal baru.'));
  else
    signals.replaceChildren(
      ...p.signals.map((s) => {
        const tr = el('tr');
        const side = el('td');
        const buy = s.side === 'BUY';
        side.append(el('span', `badge badge-sm badge-soft font-semibold ${buy ? 'badge-success' : 'badge-error'}`, buy ? 'Beli' : 'Jual'));
        tr.append(
          el('td', 'whitespace-nowrap tabular-nums text-base-content/75', when(s.at)),
          el('td', 'font-mono whitespace-nowrap', s.symbol),
          el('td', 'whitespace-nowrap', `${s.strategy} ${TF[s.timeframe] ?? s.timeframe}`),
          side,
          el('td', 'text-right tabular-nums', price(s.entry)),
          el('td', 'text-right tabular-nums text-base-content/75', price(s.stopLoss)),
          el('td', 'text-right tabular-nums text-base-content/75', price(s.takeProfit)),
          el('td', 'whitespace-nowrap text-base-content/75', STATUS[s.status] ?? s.status),
          el('td', `text-right tabular-nums ${tone(s.netR)}`, r(s.netR)),
        );
        return tr;
      }),
    );
}

async function load() {
  const loading = pick('[data-loading]');
  const name = decodeURIComponent(location.pathname.split('/')[2] ?? '').toLowerCase();
  // The server's rule for usernames; anything else has no page.
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) {
    loading.hidden = true;
    pick('[data-missing]').hidden = false;
    return;
  }
  try {
    const res = await fetch(`/api/public/creators/${encodeURIComponent(name)}`);
    if (res.status === 404) {
      loading.hidden = true;
      pick('[data-missing]').hidden = false;
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render((await res.json()) as Page);
    loading.hidden = true;
    pick('[data-page]').hidden = false;
  } catch {
    loading.textContent = 'Rekam jejak tidak bisa dimuat. Server mungkin sedang bermasalah; coba lagi sebentar lagi.';
  }
}

load();
