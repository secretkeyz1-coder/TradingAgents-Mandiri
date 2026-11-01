# 0009. Notifikasi Scalper ikut pengaturan grafik pemiliknya

Status: Diterima · 2026-11-01

## Konteks

Pengguna bisa mengubah input Scalper Pro+ di grafik (sensitivitas, panjang ATR dan EMA, filter, risiko), dan pengaturan itu tersimpan di akun. Pemindai notifikasi selalu memakai pengaturan bawaan, jadi grafik yang sudah diatur dan pesan Telegram-nya bisa menunjuk sinyal yang berbeda; [ADR 0003](0003-indikator-dua-bahasa-tes-paritas.md) mencatatnya sebagai celah. Mengganti pengaturan di tengah jalan juga berisiko: sinyal yang sudah dikirim bisa hilang dari keluaran mesin lalu menggantung, dan sinyal pengaturan baru dari beberapa candle terakhir bisa terkirim seolah-olah baru.

## Keputusan

- Input Scalper dan nilai bawaannya ada di satu tempat, `web/shared/scalper.ts`, yang dipakai grafik dan server. Pemindai hanya meneruskan input yang mengubah sinyal dan berbeda dari bawaan; akun yang memakai bawaan berbagi satu pemindaian dengan ledger publik.
- Setiap alert menyimpan input yang menghasilkan sinyalnya (`signal_alerts.settings`). Pengaturan baru dari grafik baru dipakai setelah tidak ada lagi sinyal yang sudah diumumkan yang masih berjalan; sampai saat itu input lama mengikuti sinyal tersebut sampai selesai.
- Saat pindah, sinyal yang sudah dihasilkan input baru dicatat sebagai riwayat, tidak dikirim, dan sinyal lama yang hanya pernah dicatat ditutup sebagai `replaced`.
- Kedua mesin membulatkan panjang periode dengan cara yang sama (setengah ke atas), dan tes paritas menjalankan Scalper dengan input pengguna yang memuat pecahan.

## Konsekuensi

- Grafik dan notifikasi menunjuk sinyal yang sama untuk pengaturan apa pun, dan rekam jejak publik Creator tidak pernah punya sinyal yang menggantung karena pengaturan diubah.
- Perpindahan bisa tertunda selama sinyal yang sudah diumumkan masih berjalan, paling lama 96 candle (batas kedaluwarsa sinyal Scalper). Menu Notifikasi menandai alert yang masih menunggu.
- Alternatif yang ditolak: pindah seketika (sinyal yang sudah dikirim tidak pernah mendapat kabar hasil, dan rekam jejak publik bolong) dan pengaturan dibekukan saat alert dibuat (notifikasi berhenti mengikuti grafik tanpa langkah manual).
- Setiap kombinasi pengaturan yang berbeda menambah satu run Scalper per simbol di pemindaian.
