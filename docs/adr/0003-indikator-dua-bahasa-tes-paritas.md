# 0003. Mesin indikator ditulis dua kali, dijaga tes paritas

Status: Diterima · 2026-11-01

## Konteks

PoB, Fib Golden Zone, dan Scalper Pro+ digambar di grafik (TypeScript, di browser) dan dipindai untuk notifikasi Telegram (Python, di server). Kalau keduanya berbeda, notifikasi menunjuk sinyal yang tidak ada di grafik.

## Keputusan

- Kedua implementasi dipertahankan: grafik tetap menghitung di browser, notifikasi di server.
- Tes paritas (`web/client/test`, `bun run test` di `web/client`) menjalankan keduanya pada delapan potongan candle asli dan membandingkan setiap sinyal: bar, arah, entry, stop, target, hasil. Tes juga mengunci pengaturan bawaan kedua sisi agar sama.
- Perubahan pada satu mesin dilakukan di commit yang sama dengan mesin satunya, dan tes harus tetap lolos.

## Konsekuensi

- Selisih langsung ketahuan di CI. Pertama kali dijalankan, 706 sinyal per sisi identik, dan pekerjaan ini menemukan bug tanggal candle harian emas dan forex (`market.ts`).
- Alternatifnya (menghitung di server dan mengirim hasilnya ke grafik) ditunda: grafik butuh hitungan instan saat pengguna mengubah pengaturan.
- Celah yang tercatat: pengaturan Scalper milik pengguna hanya dipakai grafik; notifikasi memakai pengaturan bawaan.
