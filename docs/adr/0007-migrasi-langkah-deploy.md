# 0007. Migrasi sebagai langkah deploy, cocok dengan versi yang sedang berjalan

Status: Diterima · 2026-11-01

## Konteks

Server menjalankan migrasi saat start. Dua instance yang start bersamaan bisa berebut migrasi yang sama, dan migrasi yang gagal membuat app baru crash berulang menggantikan app lama yang masih sehat.

## Keputusan

- `migrate.ts` menjalankan migrasi lalu keluar. Di compose produksi ia menjadi service `migrate` sekali jalan dengan image baru; app dan worker baru diganti setelah service itu sukses (`service_completed_successfully`), dan app start dengan `MIGRATE_ON_START=0`.
- `runMigrations` mengambil advisory lock, sehingga instance yang start bersamaan bergiliran dan setiap migrasi diterapkan sekali.
- Pengembangan lokal tetap migrasi saat start (`MIGRATE_ON_START` bawaannya `1`).

## Konsekuensi

- Migrasi yang gagal menghentikan deploy, dan app lama tetap melayani.
- Selama beberapa detik app lama berjalan di atas skema baru. Karena itu setiap migrasi harus tetap cocok dengan versi yang sedang berjalan: tambahkan tabel atau kolom dulu, dan hapus yang lama di rilis berikutnya.
