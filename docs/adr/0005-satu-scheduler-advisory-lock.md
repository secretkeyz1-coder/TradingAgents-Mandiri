# 0005. Satu scheduler lewat advisory lock pada koneksi sendiri

Status: Diterima · 2026-11-01

## Konteks

Setiap proses app menyalakan delapan timer: pemindaian sinyal, cek harga, watchlist, rekap, pengingat, ringkasan AI, cek status, pembersihan. Dengan dua instance, semuanya berjalan dua kali: kerja dobel, dan pesan dobel di tempat yang tidak dijaga indeks unik.

## Keputusan

- Instance yang memegang `pg_try_advisory_lock(hashtext('tradingagents:scheduler'))` menjadi pemimpin. Setiap tick timer dibungkus `leaderOnly`, yang tidak mengerjakan apa pun di instance lain.
- Lock dipegang di klien postgres.js tersendiri dengan satu koneksi, tanpa `max_lifetime` dan tanpa batas idle. Saat koneksi itu tertutup, `onclose` langsung mencabut status pemimpin; percobaan berikutnya (tiap 15 detik) membuka sesi baru dan mengambil lock kalau bebas.
- `docker stop` melepas lock saat itu juga (SIGTERM), sehingga instance lain langsung mengambil alih.

## Konsekuensi

- Failover dalam 15 detik, tanpa layanan koordinasi tambahan.
- Saat koneksi pemimpin putus diam-diam, dua instance bisa memimpin beberapa detik; kerja bersama mereka idempoten di database.
- Pelajaran: versi pertama memegang lock di koneksi yang dipinjam dari pool (`reserve()`). Setelah koneksi itu tertutup (database restart, atau rotasi `max_lifetime` 30 sampai 60 menit), handle lama menunjuk ke koneksi yang sudah dipakai pool lagi, dan query berikutnya bisa membuat postgres.js crash. Tes yang memutus koneksi pemimpin menangkapnya sebelum produksi.
