# 0001. Monolit modular dengan Postgres sebagai sumber kebenaran

Status: Diterima · 2026-11-01 (mencatat bentuk yang sudah berjalan)

## Konteks

Satu tim kecil membangun satu produk yang fiturnya saling terkait: akun dan paket, analisa, notifikasi, pembayaran, situs publik. Kebutuhan enterprise (lebih dari satu instance, worker terpisah) datang belakangan, setelah produknya berjalan.

## Keputusan

- Satu server Bun + Hono dengan satu router per fitur (`export const fooApi = new Hono<AppEnv>()`), dipasang di `app.ts`.
- Postgres menyimpan data sekaligus mengoordinasikan proses: klaim kerja lewat update bersyarat, idempotensi lewat indeks unik, lock, lease, batas laju, dan antrean.
- Dipecah hanya di sambungan yang sudah alami: worker analisa (proses `runner.ts`) dan engine Python (subprocess).

## Konsekuensi

- Deploy dan pengembangan sederhana: satu image, satu database, satu bahasa di server.
- Skala horizontal lewat instance app dan proses worker, karena state bersama ada di Postgres ([0004](0004-state-bersama-di-postgres.md)).
- Batas modul dijaga disiplin, bukan jaringan. Modul besar (`auth.ts`, `DecisionChart.svelte`, `chart_agent.py`) perlu dipecah per tanggung jawab seiring tumbuhnya.
