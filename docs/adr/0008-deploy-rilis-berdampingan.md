# 0008. Deploy rilis berdampingan dengan rollback otomatis; CD manual sampai staging ada

Status: Diterima · 2026-11-01

## Konteks

Deploy berupa beberapa perintah yang diketik tangan dari laptop, menimpa direktori kode yang sedang berjalan, tanpa cara cepat untuk membatalkan rilis yang buruk. Pemilik memilih deploy otomatis lewat GitHub Actions, tetapi belum membuat staging.

## Keputusan

- Kunci deploy khusus CI hanya boleh menjalankan satu perintah (forced command di `authorized_keys`): `receive-release.sh`. Skrip itu membongkar rilis yang dikirim (git archive) ke `~/tradingagents/releases/<waktu>-<commit>` dan menjalankan `deploy.sh` milik rilis itu, sehingga langkah deploy selalu ikut versi kodenya.
- `deploy.sh` membawa `.env`, menandai image yang berjalan `:previous`, build, `docker compose up -d` (migrasi dulu), lalu menunggu `/healthz` dan worker. Kalau gagal, image dan rilis sebelumnya dipulihkan. Kalau berhasil, `~/tradingagents/src` menjadi symlink ke rilis baru, tiga rilis terakhir disimpan, dan image lama proyek ini dibersihkan berdasarkan label.
- Workflow Deploy dijalankan manual dan menjalankan ulang semua cek web di commit yang dikirim (`workflow_call`), jadi tidak ada commit yang terkirim tanpa lolos cek.
- Begitu staging ada, workflow mendapat job otomatis untuk staging; produksi tetap lewat tombol.

## Konsekuensi

- Rollback otomatis untuk build, migrasi, kesehatan app, dan worker yang gagal; rollback manual hanya mengganti symlink dan tag image (runbook deploy).
- Belum tanpa jeda: container app diganti, jadi ada beberapa detik koneksi terputus saat deploy.
- Kunci CI tidak bisa membuka shell di VPS, tetapi tetap bisa men-deploy kode apa pun dari repositori, jadi akses ke secret GitHub harus dijaga seperti akses ke server.
