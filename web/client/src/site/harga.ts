// The pricing page's live part: which chart indicators each plan opens, read from the admin's
// catalog (GET /api/public/indicators, server/src/indicators.ts) so the page never promises
// what the app would not show. The rest of the page is static and reads fine without it.
// Names and descriptions are set as text, never HTML.
import { PLAN_IDS, PLANS, type PlanId } from '../../../shared/plans';

type Indicator = { name: string; description: string; plans: PlanId[] };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function fill() {
  const section = document.querySelector<HTMLElement>('[data-indicators]');
  const note = section?.querySelector<HTMLElement>('[data-indicators-note]');
  if (!section || !note) return;
  let items: Indicator[] | null = null;
  try {
    const res = await fetch('/api/public/indicators');
    items = res.ok ? ((await res.json()) as Indicator[]) : null;
  } catch {
    items = null;
  }
  if (!items) {
    note.textContent = 'Daftar indikator belum bisa dimuat. Muat ulang halaman, atau lihat menu Indikator di aplikasi.';
    return;
  }
  if (!items.length) {
    note.textContent = 'Belum ada indikator chart yang dibuka untuk paket mana pun.';
    return;
  }

  const head = el('tr');
  head.append(el('th', '', 'Indikator'), ...PLAN_IDS.map((id) => el('th', 'text-right', PLANS[id].name)));
  const body = el('tbody');
  for (const item of items) {
    const row = el('tr');
    const what = el('td');
    what.append(el('span', 'font-medium', item.name));
    if (item.description) what.append(el('span', 'block text-sm text-base-content/70', item.description));
    row.append(what);
    for (const id of PLAN_IDS) {
      const cell = el('td', 'text-right');
      if (item.plans.includes(id)) {
        cell.textContent = 'Ya';
      } else {
        const dash = el('span', '', '–');
        dash.setAttribute('aria-hidden', 'true');
        cell.append(dash, el('span', 'sr-only', 'Tidak'));
      }
      row.append(cell);
    }
    body.append(row);
  }
  const thead = el('thead');
  thead.append(head);
  const table = el('table', 'table');
  table.append(thead, body);
  const frame = el('div', 'overflow-x-auto rounded-box border border-base-300');
  frame.append(table);
  note.replaceWith(frame);
}

fill();
