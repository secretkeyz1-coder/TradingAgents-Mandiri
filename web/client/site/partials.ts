// The public site's shared pieces (header, footer, pricing, the plan table),
// written into the pages at build time from shared/brand.ts and shared/plans.ts,
// so the site, the app and the server always state the same prices and limits.
import { BRAND } from '../../shared/brand.ts';
import { FOUNDING, PLANS, PLAN_IDS, TRIAL_DAYS, rupiah, type PlanLimits } from '../../shared/plans.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** {{NAME}} in a page is replaced by this text, escaped. */
export const VALUES: Record<string, string> = {
  BRAND: BRAND.name,
  TAGLINE: BRAND.tagline,
  COMPANY: BRAND.company || BRAND.name,
  TRIAL_DAYS: String(TRIAL_DAYS),
  YEAR: String(new Date().getFullYear()),
  FOUNDING_PRICE: rupiah(FOUNDING.price),
  FOUNDING_SEATS: String(FOUNDING.seats),
};
export const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in VALUES ? esc(VALUES[key]) : match));

const logo = `<svg class="size-7 shrink-0" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="7" fill="var(--color-base-content)" />
  <rect x="6.5" y="12" width="5" height="9" rx="1" fill="var(--color-base-100)" />
  <path d="M9 7v18M16 5v20" stroke="var(--color-base-100)" stroke-width="1.5" stroke-linecap="round" />
  <rect x="13.5" y="9" width="5" height="10" rx="1" fill="var(--color-base-100)" />
  <path d="M23 4v15" stroke="var(--color-accent)" stroke-width="1.5" stroke-linecap="round" />
  <rect x="20.5" y="6" width="5" height="8" rx="1" fill="var(--color-accent)" />
</svg>`;

const searchIcon = `<svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <circle cx="11" cy="11" r="7" />
  <path d="m20 20-3.5-3.5" />
</svg>`;

export function header(): string {
  return `<header class="border-b border-base-300">
  <nav class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:gap-5" aria-label="Utama">
    <a href="/" class="flex shrink-0 items-center gap-2.5 text-[17px] font-semibold tracking-tight">${logo}<span class="hidden min-[380px]:inline">${esc(BRAND.name)}</span></a>
    <a href="/app" aria-label="Buka aplikasi untuk mencari simbol" class="hidden max-w-xs min-w-0 flex-1 items-center gap-2.5 rounded-full bg-base-content/5 px-4 py-2.5 text-sm text-base-content/60 transition-colors hover:bg-base-content/10 md:flex">${searchIcon}<span class="truncate">Cari simbol: BBCA, BTC, emas</span></a>
    <div class="ml-auto flex items-center gap-1">
      <a class="btn btn-ghost btn-sm hidden lg:inline-flex" href="/#produk">Produk</a>
      <a class="btn btn-ghost btn-sm hidden lg:inline-flex" href="/#pasar">Pasar</a>
      <a class="btn btn-ghost btn-sm hidden sm:inline-flex" href="/harga">Harga</a>
      <a class="btn btn-ghost btn-sm" href="/app">Masuk</a>
      <a class="btn btn-primary btn-sm rounded-full px-4 whitespace-nowrap" href="/app#/signup">Mulai gratis</a>
    </div>
  </nav>
</header>`;
}

function contact(): string {
  const lines: string[] = [];
  if (BRAND.supportEmail) lines.push(`<a class="link link-hover" href="mailto:${esc(BRAND.supportEmail)}">${esc(BRAND.supportEmail)}</a>`);
  if (BRAND.whatsapp) lines.push(`<a class="link link-hover" href="https://wa.me/${esc(BRAND.whatsapp.replace(/\D/g, ''))}">WhatsApp ${esc(BRAND.whatsapp)}</a>`);
  return lines.length ? lines.join('') : '<span class="text-base-content/70">Kontak resmi segera diumumkan.</span>';
}

/** The contact line for running text (legal pages). */
export function contactText(): string {
  const ways = [BRAND.supportEmail && `email ${esc(BRAND.supportEmail)}`, BRAND.whatsapp && `WhatsApp ${esc(BRAND.whatsapp)}`].filter(Boolean);
  return ways.length ? ways.join(' atau ') : 'kontak resmi yang kami umumkan di situs ini';
}

export function footer(): string {
  const link = (href: string, text: string) => `<a class="link link-hover text-base-content/75" href="${href}">${text}</a>`;
  return `<footer class="border-t border-base-300">
  <div class="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
    <div class="flex flex-col gap-2.5">
      <a href="/" class="flex items-center gap-2.5 font-semibold tracking-tight">${logo}<span>${esc(BRAND.name)}</span></a>
      <p class="text-sm text-base-content/70">${esc(BRAND.tagline)} Alat riset untuk trader yang ingin tahu apakah caranya benar-benar bekerja.</p>
    </div>
    <nav class="flex flex-col gap-2 text-sm" aria-label="Produk">
      <span class="font-semibold">Produk</span>
      ${link('/#produk', 'Lab strategi')}
      ${link('/#bukti', 'Buku catatan sinyal')}
      ${link('/#fitur', 'Analisa multi-agent AI')}
      ${link('/#pasar', 'Ringkasan pasar')}
    </nav>
    <nav class="flex flex-col gap-2 text-sm" aria-label="Bantuan">
      <span class="font-semibold">Bantuan</span>
      ${link('/harga', 'Harga')}
      ${link('/syarat', 'Syarat &amp; Ketentuan')}
      ${link('/privasi', 'Kebijakan Privasi')}
      ${link('/disclaimer', 'Disclaimer risiko')}
      ${link('/status', 'Status layanan')}
    </nav>
    <div class="flex flex-col gap-2 text-sm"><span class="font-semibold">Kontak</span>${contact()}</div>
  </div>
  <p class="mx-auto max-w-6xl px-4 pb-10 text-xs text-base-content/60">© ${VALUES.YEAR} ${esc(VALUES.COMPANY)}. Semua isi layanan ini adalah riset dan simulasi, bukan nasihat keuangan atau ajakan membeli atau menjual aset apa pun. Trading berisiko tinggi.</p>
</footer>`;
}

const CTA: Record<string, string> = { free: 'Mulai gratis', pro: `Coba Pro gratis ${TRIAL_DAYS} hari`, creator: 'Pilih Creator' };

export function pricing(): string {
  const card = (id: (typeof PLAN_IDS)[number]) => {
    const p = PLANS[id];
    const featured = id === 'pro';
    return `<section class="flex flex-col gap-5 rounded-[1.25rem] border ${featured ? 'border-accent' : 'border-base-300'} bg-base-100 p-7">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-xl font-semibold">${esc(p.name)}</h3>
      <p class="text-sm text-base-content/70">${esc(p.blurb)}</p>
    </div>
    <div class="flex flex-col gap-1">
      <p><span class="text-4xl font-semibold tracking-tight tabular-nums">${rupiah(p.price.month)}</span><span class="text-sm text-base-content/70">/bulan</span></p>
      <p class="text-xs text-base-content/70">${p.price.year ? `atau ${rupiah(p.price.year)}/tahun, hemat 2 bulan` : 'Selamanya, tanpa kartu.'}</p>
    </div>
    <ul class="flex flex-col gap-2.5 text-sm text-base-content/80">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    <a class="btn ${featured ? 'btn-primary' : 'btn-ghost border-base-300'} mt-auto rounded-full whitespace-nowrap" href="/app#/signup">${CTA[id]}</a>
  </section>`;
  };
  return `<div class="grid gap-4 md:grid-cols-3">${PLAN_IDS.map(card).join('')}</div>
<div class="mt-4 flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-5 sm:flex-row sm:items-center sm:justify-between">
  <div class="flex flex-col gap-0.5">
    <h3 class="font-semibold">Founding member: Pro ${rupiah(FOUNDING.price)}/bulan</h3>
    <p class="text-sm text-base-content/70">Untuk ${FOUNDING.seats} pelanggan pertama. Harganya terkunci selama kamu tetap berlangganan.</p>
  </div>
  <a class="btn btn-ghost btn-sm self-start rounded-full border-base-300 whitespace-nowrap sm:self-auto" href="/app#/signup">Ambil kursi founding</a>
</div>
<p class="mt-3 text-xs text-base-content/70">Akun baru mencoba Pro ${TRIAL_DAYS} hari setelah emailnya terverifikasi. Bayar lewat transfer bank atau QRIS; paket tidak diperpanjang otomatis. Harga dalam rupiah.</p>`;
}

const LIMIT_ROWS: [keyof PlanLimits, string][] = [
  ['analyses', 'Analisa multi-agent AI per hari'],
  ['chat', 'Pesan agent chart per hari'],
  ['labRuns', 'Uji Lab per hari'],
  ['alerts', 'Notifikasi sinyal aktif'],
  ['watchlist', 'Simbol di analisa terjadwal'],
  ['scripts', 'Skrip tersimpan'],
];

export function limits(): string {
  const head = PLAN_IDS.map((id) => `<th class="text-right">${esc(PLANS[id].name)}</th>`).join('');
  const rows = LIMIT_ROWS.map(
    ([key, label]) => `<tr><td>${label}</td>${PLAN_IDS.map((id) => `<td class="text-right tabular-nums">${PLANS[id].limits[key]}</td>`).join('')}</tr>`,
  ).join('');
  // The one thing a plan adds besides capacity (server/src/creators.ts).
  const page = `<tr><td>Halaman rekam jejak publik</td>${PLAN_IDS.map((id) => `<td class="text-right">${id === 'creator' ? 'Ya' : '–'}</td>`).join('')}</tr>`;
  const shared = ['Lab strategi dengan data uji terkunci dan biaya', 'Buku catatan sinyal live', 'Harga kripto real-time dari 9 bursa', 'Skrip sendiri dan impor Pine Script', 'Notifikasi Telegram'];
  return `<div class="overflow-x-auto rounded-box border border-base-300">
  <table class="table">
    <thead><tr><th>Kapasitas</th>${head}</tr></thead>
    <tbody>${rows}${page}</tbody>
  </table>
</div>
<p class="mt-3 text-sm text-base-content/70">Semua paket memakai alat riset yang sama: ${shared.map(esc).join(', ')}. Bedanya kapasitas, dan Creator juga bisa membagikan rekam jejak sinyalnya di halaman publik; indikator chart yang terbuka untuk tiap paket ada di bawah. Kuota harian kembali penuh pukul 00.00 WIB.</p>`;
}

export const PARTS: Record<string, () => string> = { header, footer, pricing, limits, contact: contactText };
