# 0017. AI membaca indikator pilihan pengguna, dipotong di tanggal analisa

Status: Diterima · 2026-11-02 · melengkapi [ADR 0016](0016-peran-member-dan-admin.md)

## Konteks

Pengguna bisa membuat dan memakai indikator di chart, notifikasi, dan Uji indikator:
- mesin bawaan (Scalper Pro+, PoB BYSTRA, Fib GZ);
- skrip yang diterbitkan admin;
- skrip buatan sendiri, termasuk terjemahan Pine.

Analisa AI (Riset AI) dan Uji saran AI tidak bisa membaca satu pun. Market Analyst engine hanya memilih dari daftar indikator stockstats bawaannya (SMA, EMA, MACD, RSI, Bollinger, ATR, VWMA). Pemilik produk meminta indikator baru juga bisa dipakai di Riset AI dan di uji saran AI.

Ada dua syarat:
- Di uji saran AI, setiap sel adalah analisa pada tanggal lampau, jadi indikatornya tidak boleh melihat candle sesudah tanggal itu.
- Kode skrip pengguna bersifat pribadi.

## Keputusan

- **Pilihan di form.** Request analisa dan uji saran AI boleh membawa sampai 3 indikator (`indicators: [{ key, timeframe }]`), dengan timeframe 15m, 1h, atau 1d (`shared/readings.ts`). PoB tidak punya setup harian, jadi bacaan hariannya memakai candle 1 jam.
- **Salinan di server saat request dibuat** (`server/src/readings.ts`):
  - Tiap indikator diperiksa terhadap hak akun (`usableRows`, skrip milik sendiri).
  - Indikator disalin ke `analyses.request`: mesin bawaan dengan pengaturan Scalper akun, atau kode skrip saat itu. Semua sel satu uji membaca kode yang sama, dan worker tidak butuh database.
  - API tidak pernah mengirim balik kode dan pengaturan itu (`publicRequest` di daftar dan detail analisa).
- **Hitungan di worker sebelum engine mulai** (`web/worker/readings.py`):
  - Candle dimuat sekali per aset dan timeframe dari loader server (`script-cli.ts`, mode `bars`), sama dengan Uji indikator.
  - Candle dipotong di tiap tanggal analisa: sampai dan termasuk tanggal itu, dengan jendela 30 hari (15m), 365 hari (1h), atau 730 hari (1d).
  - Mesin bawaan dijalankan seperti di agent chart (`chart_agent`). Skrip dijalankan di sandbox chart (`script-cli.ts`, mode `script`) pada potongan yang sama.
- **Hanya Market Analyst** yang menerima bacaan sel-nya, ditambahkan ke konteks instrumennya. Ia diminta menyebut apa kata tiap indikator per tanggal itu, apakah sejalan dengan indikatornya sendiri, dan memberi tiap indikator satu baris di tabelnya. Agen lain membaca laporannya.
  - Ini dipasang dengan membungkus `tradingagents.graph.setup.create_market_analyst` di proses worker saja; kode engine tidak berubah.
  - Request yang memakai indikator tanpa Market Analyst ditolak.
- **Kegagalan tidak menghentikan analisa.** Indikator yang tidak bisa dihitung (candle belum ada, skrip error) masuk ke prompt sebagai "tidak tersedia" beserta alasannya, dan log analisa mencatatnya.

## Konsekuensi

- Indikator yang dibuat sekali bisa dipakai di semua tempat: chart, notifikasi, Uji indikator, analisa AI, dan uji saran AI.
- Uji saran AI dengan indikator mengukur "AI + indikatorku" tanpa melihat masa depan. Yang terjamin adalah potongan candle-nya: data berita dan fundamental engine tetap mengikuti aturan engine sendiri.
- Prompt Market Analyst bertambah sekitar 1-2 ribu karakter per indikator, dan satu sel butuh beberapa detik lagi untuk memuat candle dan menghitung.
- Candle 15 menit saham hanya ada sekitar sebulan ke belakang (batas Yahoo). Tanggal yang lebih lama dibaca tanpa indikator itu, dan log menyebutnya.
- Request menyimpan salinan kode skrip. Mengubah skrip tidak mengubah analisa yang sudah dibuat.
- Pembungkus Market Analyst bergantung pada nama `create_market_analyst` di `tradingagents/graph/setup.py`. Mengganti cara engine membangun analisnya harus memperbarui `readings.install`.
- **Alternatif yang ditolak:**
  - **Tool baru untuk Market Analyst:** model belum tentu memanggilnya, dan prompt engine tetap harus diubah.
  - **Menaruh bacaan di konteks instrumen semua agen:** token berlipat di setiap agen, padahal analis lain tidak membacanya.
  - **Menyimpan kunci saja dan mengambil kode saat job mulai:** runner butuh langkah async tambahan, dan isi sel bisa berbeda bila skrip diubah di tengah uji.
  - **Menghitung di server TypeScript:** mesin bawaan untuk server ada di Python (notifikasi dan Uji indikator memakai yang sama), jadi worker tetap harus dipanggil.
