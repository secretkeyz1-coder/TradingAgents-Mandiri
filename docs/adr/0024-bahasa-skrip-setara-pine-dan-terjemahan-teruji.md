# 0024. Bahasa skrip setara Pine, dan terjemahan yang diuji sebelum diserahkan

Status: Diterima · 2026-11-03

## Konteks

Analisa terjemahan skrip Pine v6 "Trendline Rejection Scalper" menemukan tiga sebab terjemahan Pine tidak akurat:
- **Bahasanya kurang.** Bahasa skrip (`shared/script.ts`) belum punya:
  - order yang menunggu harganya (stop atau limit dengan masa berlaku);
  - dua target dengan tutup sebagian dan titik impas;
  - sesi dengan zona waktu, timeframe lebih tinggi tanpa repaint, serta `timeframe` dan `mintick`;
  - garis dan label.

  AI terpaksa mengakalinya. Contohnya entry `high + mintick` di candle sinyal, yang di bawah [ADR 0023](0023-uji-hanya-harga-yang-terjadi.md) tidak pernah terisi: 14 dari 14 sinyal di BTC 1 jam.
- **Penerjemah tidak memeriksa hasilnya.** Draf yang error, yang membaca candle sesudah sinyal, atau yang entry-nya tidak pernah terisi sampai ke member apa adanya.
- **Waktunya habis.** Satu panggilan model bisa makan beberapa menit. Cloudflare memutus respons yang diam lebih dari 100 detik, dan server membunuh worker di menit kelima.

## Keputusan

**Bahasa skrip:**
- **Order yang menunggu.** `signal(i, side, { entry, wait: N })` adalah order yang dipasang sesudah candle i tutup. Untuk BUY, entry di atas close adalah order stop dan di bawahnya order limit (SELL sebaliknya).
  - Order terisi di candle pertama dari i+1 sampai i+N yang menyentuhnya. Stop yang dilompati harga terisi di harga buka, limit di harganya sendiri.
  - Order yang tidak terisi hasilnya `unfilled`, dihitung di `stats.unfilled`, dengan `exitIndex = i + N`. Order yang masih menunggu berstatus `open` dengan `fillIndex = null`.
  - Tanpa `wait`, aturan ADR 0023 tetap berlaku: entry harus di dalam candle i.
- **Dua target.** `tp: [tp1, tp2]`, dengan `size` sebagai bagian yang ditutup di tp1 (bawaan 0,5) dan `breakeven` (bawaan true) yang memindahkan SL ke harga isi mulai candle sesudah tp1.
  - Hasilnya `win` (tp2), `partial` (tp1 lalu SL atau titik impas), atau `loss` (SL sebelum tp1).
  - R = size × R tp1 + (1 − size) × R sisanya, diukur dari harga isi.
- **Candle pengisi order.** SL tetap didahulukan (ADR 0023). TP yang tersentuh di candle pengisi order stop ikut dihitung, karena harga pasti melewati entry dulu. TP di candle pengisi order limit tidak dihitung, karena harga bisa sampai TP sebelum turun ke entry. Simulasi Pine di skrip Trendline Rejection juga menghitungnya begitu.
- **Satu posisi sekaligus.** Dengan `exclusive`, sinyal di candle tempat posisi sebelumnya ditutup boleh masuk. Order yang masih menunggu menahan sinyal baru sampai terisi atau kedaluwarsa.
- **Waktu.** Skrip membaca `timeframe` (menit), `epoch`, `mintick`, `hour/minute/dayofweek(i, tz)`, dan `session("HHMM-HHMM[:hari]", tz)` dengan jam akhir tidak termasuk.
  - Sandbox mengenal zona tetap dan aturan DST Amerika Serikat dan Eropa.
  - Pemanggil mengirim zona bursa candle (`exchangeTimezone`).
- **Timeframe lebih tinggi.** `htf(menit)` membangun candle tinggi dari candle chart menurut jam bursa.
  - `closed()` sama dengan `request.security(..., expr[1], lookahead_on)`.
  - `value()` berganti di candle chart yang menutup candle tinggi.
- **ta.\*** dihitung seperti Pine: rma, atr dan rsi diawali SMA; ema dari nilai pertamanya; pivot ketat di kedua sisi.
- **Gambar.** `line()` dan `label()`, diubah lewat `lineSet`/`labelSet` dan dihapus lewat `lineDelete`/`labelDelete`. Lewat 500, yang paling lama dihapus, seperti `max_lines_count` di Pine.

**Penerjemah:**
- **Bahan AI.** AI membaca tiga hal:
  - referensi bahasa;
  - kamus Pine ke skrip (`shared/script-guide.ts`, sumber yang sama dengan tab Panduan di editor);
  - satu terjemahan penuh, yaitu Trendline Rejection.

  AI lalu menjawab dengan kode dan laporan: apa yang dibawa, diubah, dan dibuang.
- **Uji di server.** Server menjalankan draf di candle chart yang terbuka (`server/src/script-check.ts`). Draf harus:
  - jalan dalam waktu yang diizinkan chart;
  - menghasilkan sesuatu;
  - tidak menaruh sebagian besar entry di luar candle sinyal tanpa `wait`;
  - tidak membaca candle sesudahnya.

  Syarat terakhir diuji dengan menjalankan ulang skrip pada candle sampai beberapa sinyalnya (dan beberapa titik lain). Candle berikutnya diganti candle datar di close terakhir, seperti candle yang baru buka. Sinyal dan nilai plot di candle yang sudah tutup harus tetap sama.
- **Perbaikan.** Draf yang gagal dikembalikan ke AI bersama daftar masalahnya, paling banyak 2 kali. Member menerima draf terakhir beserta hasil ujinya.
- **Stream.** Ketiga rute AI di editor (`/api/scripts/translate`, `/plan`, `/compose`) menjawab dengan server-sent events: langkah demi langkah, ping tiap 15 detik, lalu hasil atau error.
- **Batas waktu.** Satu panggilan model paling lama `TA_TRANSLATE_LLM_TIMEOUT` (bawaan 300 detik) dengan satu kali ulang. Server menunggu satu langkah selama dua kali itu ditambah satu menit.

## Akibat

- **Terjemahan Trendline Rejection** diuji terhadap jalannya skrip Pine candle demi candle, di BTC, ETH dan PAXG 15 menit serta BTC 1 jam:
  - sinyal, skor, nomor sentuhan, entry, SL, TP, candle isi, dan candle keluar sama persis di 39 trade;
  - R berbeda hanya di 3 trade yang harganya melompat, karena di sini dihitung dari harga yang benar-benar terjadi.

  Terjemahan itu menjadi template dan contoh di Panduan.
- **Field sinyal baru.** `ScriptSignal` bertambah `targets`, `order`, `wait`, `fillIndex`, `fill`, `tp1Index`, `size`, dan `breakeven`. Status sinyal tersimpan bertambah `partial` dan `unfilled`. Notifikasi menulis order dan TP1/TP2. Lab menghitung trade skrip di candle isinya.
- **R call disimpan.** Riwayat call menyimpan R dari runtime (`signal_events.r`, migrasi 0032). Call dua target tidak lagi dinilai dari TP2 saja, dan call yang hanya kena TP1 ikut dihitung selesai.
- **Rute AI jadi stream.** Klien yang membaca JSON dari rute-rute itu tidak jalan lagi; selama ini hanya editor skrip yang memakainya.
- **Alamat backend tersembunyi.** Pesan error penyedia AI tidak lagi menampilkan alamat backend server kepada member, baik di penerjemah maupun di chat agent.
- **Yang masih terbuka:**
  - Strategy Pine mengisi order pasar di harga buka candle berikutnya, sedangkan di sini di close candle sinyal.
  - Trailing stop belum ada.
  - Pemeriksaan "membaca candle sesudahnya" hanya mengambil contoh beberapa sinyal, dan hanya untuk draf AI. Skrip tulisan tangan belum diperiksa.
