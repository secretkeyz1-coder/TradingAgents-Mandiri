# 0004. State antar-instance di Postgres, bukan Redis; cache tetap per instance

Status: Diterima · 2026-11-01

## Konteks

Fase 2 menyiapkan lebih dari satu instance app. Beberapa hal masih di memori proses: hitungan percobaan login dan kode dua langkah, batas pendaftaran dan email, penanda scheduler (scan terakhir, cek status terakhir), penjaga "satu jawaban per sesi chat" dan "satu uji Lab sekaligus", serta cache. Roadmap menyebut Redis; pemilik memilih Postgres yang sudah ada.

## Keputusan

- `rate_limits` (`limits.ts`): satu jendela tetap per kunci, diukur dengan jam database.
- `leases` (`locks.ts`): kerja satu-satu dengan batas waktu, diperbarui selama berjalan; token pemegang per lease.
- `shared_values` (`shared.ts`): nilai kecil yang dibaca semua instance.
- Cache (candle, katalog model, halaman Creator, jawaban halaman status) tetap per proses: cache yang meleset hanya berarti mengambil ulang, tidak pernah jawaban salah.
- Batas laporan CSP tetap per instance: rutenya terbuka untuk siapa pun, dan satu tulisan database per laporan akan membuat banjir laporan membebani database.

## Konsekuensi

- Tidak ada layanan baru untuk dijalankan dan di-backup.
- Batas percobaan berlaku untuk semua instance dan tidak hilang saat restart.
- Beban tulis ke database sedikit bertambah (satu upsert per percobaan login yang gagal, per kiriman Telegram).
- Redis bisa menyusul di balik antarmuka yang sama (`limits.ts`, `shared.ts`) kalau bebannya menuntut.
