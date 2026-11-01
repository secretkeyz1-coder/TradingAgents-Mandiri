// The status page (server/src/status.ts): each part's state now and its last
// 90 days, one bar per day, refreshed every minute while the tab is open.

type State = 'ok' | 'degraded' | 'down' | 'off';
type Part = { key: string; name: string; state: State; detail: string; history: Record<string, number> };
type Status = { checkedAt: string; overall: Exclude<State, 'off'>; days: number; parts: Part[] };

const STATE: Record<State, [string, string]> = {
  ok: ['Normal', 'badge-success'],
  degraded: ['Terganggu', 'badge-warning'],
  down: ['Gangguan', 'badge-error'],
  off: ['Belum diatur', 'badge-ghost'],
};
const OVERALL: Record<Status['overall'], [string, string]> = {
  ok: ['Semua layanan berjalan normal', 'bg-success'],
  degraded: ['Sebagian layanan terganggu', 'bg-warning'],
  down: ['Ada gangguan layanan', 'bg-error'],
};

const pick = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pct = (x: number) => `${(x * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const clock = (iso: string) =>
  `${new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} WIB`;

/** The last `n` days in WIB, oldest first, as the server keys them. */
function lastDays(n: number): string[] {
  const today = Date.now() + 7 * 3_600_000;
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

function bars(part: Part, days: string[]) {
  const strip = el('div', 'flex h-8 items-stretch gap-px');
  strip.setAttribute('aria-hidden', 'true');
  for (const d of days) {
    const up = part.history[d];
    const tone = up === undefined ? 'bg-base-300' : up >= 0.999 ? 'bg-success' : up >= 0.95 ? 'bg-warning' : 'bg-error';
    const bar = el('span', `min-w-0 flex-1 rounded-[1px] ${tone}`);
    bar.title = `${day(d)}: ${up === undefined ? 'belum ada data' : pct(up)}`;
    strip.append(bar);
  }
  return strip;
}

function render(s: Status) {
  const [text, tone] = OVERALL[s.overall];
  pick('[data-overall]')!.textContent = text;
  pick('[data-overall-dot]')!.className = `size-3 shrink-0 rounded-full ${tone}`;
  pick('[data-checked]')!.textContent = `Diperiksa ${clock(s.checkedAt)}`;
  const days = lastDays(s.days);
  pick('[data-parts]')!.replaceChildren(
    ...s.parts.map((p) => {
      const item = el('li', 'flex flex-col gap-2 p-4');
      const head = el('div', 'flex flex-wrap items-center justify-between gap-2');
      const [label, badge] = STATE[p.state];
      head.append(el('h3', 'font-semibold', p.name), el('span', `badge badge-sm badge-soft ${badge}`, label));
      item.append(head, el('p', 'text-sm text-base-content/70', p.detail));
      const seen = days.filter((d) => p.history[d] !== undefined);
      if (seen.length) {
        const average = seen.reduce((sum, d) => sum + p.history[d], 0) / seen.length;
        const foot = el('div', 'flex justify-between gap-2 text-xs text-base-content/60');
        foot.append(el('span', '', `${s.days} hari lalu`), el('span', '', `${pct(average)} tanpa gangguan, ${seen.length} hari tercatat`), el('span', '', 'Hari ini'));
        item.append(bars(p, days), foot);
      }
      return item;
    }),
  );
}

async function load() {
  try {
    const res = await fetch('/api/public/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render((await res.json()) as Status);
  } catch {
    pick('[data-overall]')!.textContent = 'Status tidak bisa dimuat. Server mungkin sedang bermasalah; coba lagi sebentar lagi.';
    pick('[data-overall-dot]')!.className = 'size-3 shrink-0 rounded-full bg-error';
  }
}

load();
setInterval(() => {
  if (!document.hidden) load();
}, 60_000);
