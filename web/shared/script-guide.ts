// How to write an indicator script, for the people who write one and for the AI that translates Pine Script: the
// guide the editor's Panduan tab shows, and a dictionary from Pine to this language (script.ts) that the tab shows
// and the translator reads (server/src/scripts.ts sends it with every translation). One source, so what the AI is
// told and what a member reads never drift apart. Indonesian, as everything a member reads.

export type PineRow = { pine: string; script: string; note?: string };
export type GuideSection = { id: string; title: string; body: string[]; steps?: string[]; code?: string; template?: string };

/** The template the guide's full example opens (script-templates.ts). */
export const GUIDE_EXAMPLE = 'Trendline Rejection (dari Pine)';

export const SCRIPT_GUIDE: GuideSection[] = [
  {
    id: 'cara-kerja',
    title: 'Cara skrip berjalan',
    body: [
      'Skrip menerima semua candle sekaligus sebagai array: close[0] candle tertua, close[n - 1] candle terbaru, yang masih berjalan. Pine menjalankan skrip sekali per candle; di sini skrip berjalan sekali, jadi keputusan per candle ditulis di dalam satu loop for.',
      'Skrip yang sama dipakai di chart, notifikasi Telegram, agent AI dan Lab, jadi sinyalnya sama di mana pun. Sinyal hanya dari candle yang sudah tutup: sinyal di candle terakhir diabaikan sampai candle itu tutup.',
    ],
    code: `const len = input("Periode EMA", 20);       // 1. pengaturan
const ema = ta.ema(close, len);             // 2. indikator, array sepanjang n
const atr = ta.atr(14);
plot(ema, "EMA");
for (let i = 1; i < n; i++) {               // 3. keputusan per candle, dari candle 0..i saja
  if (close[i - 1] < ema[i - 1] && close[i] > ema[i])
    signal(i, "BUY", { sl: close[i] - 1.5 * atr[i], tp: close[i] + 3 * atr[i] });
}`,
  },
  {
    id: 'langkah',
    title: 'Langkah membuat indikator',
    body: ['Urutan yang paling jarang salah:'],
    steps: [
      'Tulis input() untuk setiap angka yang ingin bisa diubah tanpa menyentuh kode.',
      'Hitung indikator dengan ta.* di luar loop. Hasilnya array, NaN selama pemanasan.',
      'Di dalam loop, putuskan sinyal di candle i hanya dari candle 0 sampai i. Jangan baca close[i + 1] atau candle sesudahnya: itu melihat masa depan, dan hasil ujinya jadi terlalu bagus.',
      'Panggil signal() dengan SL dan TP. Entry yang menunggu harga (order stop atau limit) memakai wait.',
      'Uji di chart, lalu "Bandingkan dengan server", lalu uji di Lab dengan biaya trading sebelum memasang notifikasi.',
    ],
  },
  {
    id: 'order',
    title: 'Entry, order dan target',
    body: [
      'Tanpa entry, posisi dibuka di close candle sinyal. entry tanpa wait berarti terisi di dalam candle sinyal itu sendiri, jadi harganya harus di antara low dan high candle itu.',
      'Order yang dipasang sesudah candle tutup dan menunggu harga ditulis dengan wait: N. Untuk BUY, entry di atas close adalah order stop, di bawah close order limit (SELL sebaliknya). Order terisi di candle pertama sesudah sinyal yang menyentuh entry, paling lama N candle; kalau tidak, hasilnya "tidak terisi" dan tidak dihitung sebagai trade.',
      'Dua target: tp: [tp1, tp2]. size adalah bagian posisi yang ditutup di tp1 (bawaan 0,5). breakeven (bawaan true) memindahkan SL ke harga isi mulai candle sesudah tp1 kena. Hasilnya win (tp2), partial (tp1 lalu SL atau titik impas) atau loss (SL sebelum tp1).',
      'exclusive: true menahan sinyal baru selama posisi atau order sebelumnya masih jalan, seperti satu posisi sekaligus di Pine. maxBars menutup posisi di close sesudah sekian candle (bawaan 96); exit menutupnya saat kondisimu true.',
    ],
    code: `// Order stop di atas high candle rejection, berlaku 3 candle, TP1 1R (tutup separuh), TP2 2R.
const entry = high[i] + mintick;
const sl = low[i];
const risk = entry - sl;
signal(i, "BUY", { entry, wait: 3, sl, tp: [entry + risk, entry + 2 * risk], size: 0.5, exclusive: true });`,
  },
  {
    id: 'harga',
    title: 'Hanya harga yang benar-benar terjadi',
    body: [
      'Hasil uji dihitung di harga yang diperdagangkan pasar. Order stop yang dilompati harga terisi di harga buka; SL yang dilompati juga tercatat di harga buka. Candle yang mengisi order sekaligus menyentuh SL dihitung rugi, karena urutan di dalam candle tidak diketahui.',
      'TP yang tersentuh di candle pengisi order stop ikut dihitung, karena harga pasti lewat entry dulu. Di candle pengisi order limit tidak, karena harga bisa sampai TP sebelum kembali ke entry. TP tidak pernah terisi lebih baik dari harganya sendiri. R dihitung dari harga isi.',
    ],
  },
  {
    id: 'waktu',
    title: 'Timeframe, sesi dan timeframe lebih tinggi',
    body: [
      'timeframe berisi menit per candle (15, 60, 240, 1440). Waktu candle (time) ditulis dalam jam bursa; epoch dalam milidetik UTC. session("1500-1900", "Asia/Jakarta") memberi array true/false per candle, dengan jam akhir tidak termasuk.',
      'htf(240) membangun candle 4 jam dari candle chart. Hitung indikatornya di h.close, h.high dan seterusnya, lalu bawa ke chart dengan h.closed(series) (candle tinggi yang sudah tutup, tidak repaint) atau h.value(series).',
    ],
    code: `const h = htf(240);
const emaH = ta.ema(h.close, 50);
const trendUp = h.closed(h.close.map((c, k) => c > emaH[k]));   // true/false per candle chart
const inLondon = session("1500-1900", "Asia/Jakarta");`,
  },
  {
    id: 'gambar',
    title: 'Garis dan label',
    body: [
      'line(x1, y1, x2, y2, { extend: "right" }) menggambar garis dari candle x1 ke x2 (nomor candle, boleh lewat candle terakhir). lineSet mengubahnya, lineDelete menghapusnya. label(i, harga, teks, { position: "below" }) menaruh label di bawah atau di atas candle; "\\n" untuk baris baru.',
      'Lebih dari 500 garis atau label, yang paling lama dihapus, seperti max_lines_count di Pine.',
    ],
  },
  {
    id: 'contoh',
    title: 'Contoh lengkap: Trendline Rejection',
    body: [
      'Terjemahan penuh dari skrip Pine "Trendline Rejection Scalper": trendline dari pivot, sentuhan ke-3, pola rejection, skor 0–8, bias HTF tanpa repaint, sesi London dan New York, order stop yang berlaku 3 candle, TP1 dan TP2 dengan titik impas, satu posisi sekaligus, trendline dan label di chart.',
      'Diuji terhadap jalannya skrip Pine candle demi candle di BTC, ETH dan PAXG 15 menit serta BTC 1 jam: sinyal, skor, nomor sentuhan, entry, SL, TP, candle isi dan candle keluar sama persis. R hanya berbeda saat harga melompat (gap), karena di sini dihitung dari harga yang benar-benar terjadi.',
    ],
    template: GUIDE_EXAMPLE,
  },
];

export const PINE_DICTIONARY: { topic: string; rows: PineRow[] }[] = [
  {
    topic: 'Struktur skrip',
    rows: [
      { pine: '//@version, indicator(...), strategy(...)', script: '(tidak perlu)', note: 'Nama skrip diisi di kolom nama editor.' },
      { pine: 'Skrip berjalan sekali per candle', script: 'for (let i = 0; i < n; i++) { … }', note: 'Di sini data berupa array; ta.* di luar loop, keputusan per candle di dalam loop.' },
      { pine: 'var x = 0', script: 'let x = 0 sebelum loop, diubah di dalam loop' },
      { pine: 'x[1], x[k]', script: 'x[i - 1], x[i - k]', note: 'Untuk nilai yang dihitung di loop, simpan nilai candle sebelumnya di variabel.' },
      { pine: 'bar_index · last_bar_index · barstate.islast', script: 'i · n - 1 · i === n - 1' },
      { pine: 'barstate.isconfirmed', script: '(tidak perlu)', note: 'Sinyal di candle terakhir yang masih berjalan sudah diabaikan.' },
      { pine: 'na · na(x) · nz(x, y)', script: 'NaN · na(x) · nz(x, y)', note: 'Perbandingan dengan NaN selalu false, seperti na di Pine.' },
      { pine: 'type, method (objek buatan sendiri)', script: 'objek JavaScript dan function', note: 'const t = { b1: NaN, active: false }; function valueAt(t, b) { … }' },
      { pine: 'f(x) => …', script: 'function f(x) { … }', note: 'Fungsi Pine yang memanggil ta.* atau memakai var ditulis ulang dengan array.' },
      { pine: 'array.new<float>(), array.push / shift / size / get', script: '[], push, shift, length, a[k]' },
      { pine: 'for k = 0 to 10 · for v in arr', script: 'for (let k = 0; k <= 10; k++) · for (const v of arr)', note: 'Batas to di Pine ikut dihitung.' },
      { pine: 'and, or, not, :=', script: '&&, ||, !, =' },
      { pine: 'math.abs / max / min / round / floor / ceil / pow / sqrt / log', script: 'Math.abs / max / min / round / floor / ceil / pow / sqrt / log' },
      { pine: 'math.round_to_mintick(x) · str.tostring(x, "#.##")', script: 'Math.round(x / mintick) * mintick · x.toFixed(2)' },
    ],
  },
  {
    topic: 'Input',
    rows: [
      { pine: 'input.int(14, "RSI") · input.float · input.bool', script: 'input("RSI", 14) · input("Faktor", 0.5) · input("Pakai filter", true)', note: 'Nama dulu, lalu nilai bawaan.' },
      { pine: 'input.string("Auto", "Mode", options = [...])', script: 'input("Mode (Auto/Manual)", "Auto")', note: 'Tidak ada daftar pilihan: tulis pilihannya di nama input.' },
      { pine: 'input.source(close, "Sumber")', script: 'const src = { close, open, high, low, hl2, hlc3, ohlc4 }[input("Sumber", "close")]' },
      { pine: 'input.timeframe("60") · input.session("0930-1600")', script: 'input("TF tinggi (menit)", 60) · input("Sesi", "0930-1600")', note: 'Lalu htf(menit) dan session(sesi, tz).' },
    ],
  },
  {
    topic: 'Data dan waktu',
    rows: [
      { pine: 'open, high, low, close, volume, hl2, hlc3, ohlc4', script: 'open[i], high[i], …', note: 'Array sepanjang n.' },
      { pine: 'time · time_close', script: 'epoch[i] · epoch[i] + timeframe * 60000', note: 'Milidetik UTC.' },
      { pine: 'hour(time, tz), minute, dayofweek', script: 'hour(i, tz), minute(i, tz), dayofweek(i, tz)', note: '1 = Minggu, seperti Pine. Tanpa tz = jam bursa.' },
      { pine: 'not na(time(timeframe.period, "1500-1900", "Asia/Bangkok"))', script: 'session("1500-1900", "Asia/Bangkok")[i]', note: 'Jam akhir tidak termasuk. Boleh ":23456" untuk hari.' },
      { pine: 'timeframe.in_seconds() / 60 · timeframe.multiplier', script: 'timeframe', note: 'Menit per candle.' },
      { pine: 'syminfo.mintick', script: 'mintick' },
      { pine: 'syminfo.ticker, request.security dengan simbol lain', script: '(tidak ada)', note: 'Skrip hanya membaca candle simbol yang sedang dibuka.' },
    ],
  },
  {
    topic: 'Indikator ta.*',
    rows: [
      {
        pine: 'ta.sma, ema, rma, wma, vwma, hma, rsi, atr, tr, stdev, dev, highest, lowest, change, mom, roc',
        script: 'ta.sma(close, 20) …',
        note: 'Nama sama, hasilnya array. Hitungannya sama dengan Pine: rma, atr dan rsi diawali SMA, ema dari nilai pertamanya.',
      },
      { pine: 'ta.crossover(a, b) · crossunder · cross', script: 'ta.crossover(a, b)[i]', note: 'b boleh angka.' },
      { pine: '[m, s, h] = ta.macd(close, 12, 26, 9)', script: 'const { macd, signal, hist } = ta.macd(close, 12, 26, 9)' },
      { pine: '[mid, up, lo] = ta.bb(close, 20, 2)', script: 'const { mid, upper, lower } = ta.bb(close, 20, 2)' },
      { pine: '[plus, minus, adx] = ta.dmi(14, 14)', script: 'const { plus, minus, adx } = ta.dmi(14, 14)' },
      { pine: '[st, dir] = ta.supertrend(3, 10)', script: 'const { line, direction } = ta.supertrend(3, 10)', note: 'direction -1 = naik, 1 = turun, sama dengan Pine.' },
      { pine: 'ta.pivothigh(high, 5, 5) · ta.pivotlow(low, 5, 5)', script: 'ta.pivothigh(high, 5, 5)[i]', note: 'Nilainya muncul di candle konfirmasi; candle pivotnya i - 5.' },
      { pine: 'ta.barssince(c) · ta.valuewhen(c, src, 0) · ta.cum(src)', script: 'ta.barssince(c) · ta.valuewhen(c, src, 0) · ta.cum(src)' },
      { pine: 'ta.stoch, cci, linreg, obv, vwap, rising, falling, fixnan', script: 'nama sama, hasilnya array' },
      { pine: 'ta.* di dalam if atau loop', script: 'hitung sekali di luar loop', note: 'Di sini ta.* selalu dihitung di semua candle.' },
    ],
  },
  {
    topic: 'Timeframe lebih tinggi',
    rows: [
      { pine: 'request.security(syminfo.tickerid, "240", expr[1], lookahead = barmerge.lookahead_on)', script: 'const h = htf(240); h.closed(series)', note: 'Candle tinggi yang sudah tutup: tidak repaint.' },
      { pine: 'request.security(syminfo.tickerid, "240", expr)', script: 'h.value(series)', note: 'Berganti di candle yang menutup candle tinggi.' },
      { pine: 'expr berupa fungsi, mis. htfBias()', script: 'hitung di h.close, h.high, …', note: 'ta.ema(h.close, 20), lalu h.closed(...).' },
    ],
  },
  {
    topic: 'Sinyal dan order',
    rows: [
      { pine: 'strategy.entry("L", strategy.long), plotshape BUY, alertcondition', script: 'signal(i, "BUY", { sl, tp })', note: 'Masuk di close candle i. Strategy Pine mengisi di harga buka candle berikutnya; di pasar 24 jam biasanya sama.' },
      { pine: 'strategy.entry(..., stop = harga) · limit = harga', script: 'signal(i, side, { entry: harga, wait: N, sl, tp })', note: 'N = berapa candle order menunggu, dari strategy.cancel atau batas kedaluwarsanya.' },
      { pine: 'entry di luar candle sinyal (mis. high + mintick)', script: 'pakai wait', note: 'Tanpa wait, entry harus di dalam candle i; kalau tidak, ordernya tidak terisi.' },
      { pine: 'strategy.exit(stop = sl, limit = tp)', script: '{ sl, tp }' },
      { pine: 'dua strategy.exit qty_percent = 50 (TP1, TP2)', script: '{ tp: [tp1, tp2], size: 0.5 }' },
      { pine: 'SL ke harga entry sesudah TP1', script: '{ breakeven: true } (bawaan)', note: 'Mulai candle sesudah TP1.' },
      { pine: 'strategy.close(...) saat kondisi', script: '{ exit: kondisi }', note: 'Array true/false; ditutup di close candle pertama yang true.' },
      { pine: 'strategy.position_size == 0 (satu posisi)', script: '{ exclusive: true }' },
      { pine: 'posisi tanpa batas waktu', script: '{ maxBars: 2000 }', note: 'Bawaan 96 candle.' },
      { pine: 'trail_points, trail_offset', script: '(tidak ada)', note: 'Ganti dengan SL tetap atau kondisi exit, dan sebut di laporan.' },
      { pine: 'strategy.risk.*, default_qty, commission', script: '(dibuang)', note: 'Ukuran posisi di kartu rencana, biaya di Lab.' },
    ],
  },
  {
    topic: 'Gambar',
    rows: [
      { pine: 'plot(series, "Judul", color) · hline(harga, "Judul")', script: 'plot(series, "Judul", warna) · hline(harga, "Judul")', note: 'Maks 8 plot; NaN memutus garis.' },
      { pine: 'line.new(x1, y1, x2, y2, extend = extend.right, style = line.style_dashed, width = 2)', script: 'line(x1, y1, x2, y2, { extend: "right", style: "dashed", width: 2 })' },
      { pine: 'line.set_xy2, set_extend, set_color, set_style · line.delete', script: 'lineSet(id, { x2, y2, extend, color, style }) · lineDelete(id)' },
      { pine: 'label.new(bar_index, low, "BUY", style = label.style_label_up)', script: 'label(i, low[i], "BUY", { position: "below" })', note: 'style_label_down = position "above"; "\\n" untuk baris baru.' },
      { pine: 'label.set_text, set_xy · label.delete', script: 'labelSet(id, { text, index, price }) · labelDelete(id)' },
      { pine: 'color.red, color.new(color.red, 50)', script: '"#FF5252", "rgba(255, 82, 82, 0.5)"', note: 'Transparansi 50 = alpha 0,5.' },
      { pine: 'max_lines_count, max_labels_count', script: '(otomatis 500)', note: 'Yang paling lama dihapus.' },
      { pine: 'table.*, box.*, bgcolor, fill, barcolor, plotcandle', script: '(dibuang)', note: 'Statistik dihitung aplikasi dari sinyal: kartu skrip dan Lab.' },
      { pine: 'alert(), alertcondition()', script: 'signal()', note: 'Notifikasi aplikasi dikirim dari sinyal.' },
    ],
  },
];

/** The dictionary as plain lines, for the translator's prompt. */
export function pineDictionaryText(): string {
  return PINE_DICTIONARY.map(
    (g) => `${g.topic}:\n${g.rows.map((r) => `  Pine: ${r.pine}  =>  ${r.script}${r.note ? `  (${r.note})` : ''}`).join('\n')}`,
  ).join('\n');
}
