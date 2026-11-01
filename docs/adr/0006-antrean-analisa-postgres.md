# 0006. Antrean analisa di Postgres (SKIP LOCKED dan NOTIFY), bukan pg-boss

Status: Diterima · 2026-11-01

## Konteks

Antrean analisa ada di memori proses app, dan setiap analisa berjalan sebagai anak proses instance yang menerimanya: engine yang berat memakan CPU app, batal hanya berfungsi di instance yang memegangnya, dan stream langsung hanya mendengar event dari prosesnya sendiri. Roadmap menyebut pg-boss. Pola yang sudah ada (baris `analyses` sebagai antrean, klaim bersyarat, heartbeat, sapuan yatim) sudah tahan restart.

## Keputusan

- Baris `analyses` berstatus `queued` adalah antreannya. Worker (`runner.ts`) mengambil yang tertua dengan `FOR UPDATE SKIP LOCKED`, dibantu partial index pada baris `queued`.
- Event disimpan di `analysis_events` dan diumumkan lewat `NOTIFY ta_jobs`; `subscribe()` di proses mana pun membaca event baru dan membaca ulang tiap 15 detik untuk pengumuman yang terlewat saat reconnect.
- Batal ditandai di database lalu diumumkan; worker yang memegang analisa itu membunuh prosesnya. Heartbeat tetap menjadi cadangan.
- Tanpa pg-boss: tidak ada dependensi baru, dan fitur andalannya (retry otomatis, cron) tidak diinginkan di sini. Analisa yang gagal sengaja tidak diulang otomatis, karena setiap percobaan memakan biaya LLM.

## Konsekuensi

- App dan worker bisa diskalakan terpisah (`--scale worker=N`).
- Analisa yang sedang berjalan tidak bisa dilanjutkan di worker lain: worker yang berhenti saat deploy menandainya gagal dengan alasannya, dan pengguna menjalankannya lagi.
- Chat agen, Lab, pemindaian sinyal, dan ringkasan AI masih berjalan di proses app; memindahkannya ke worker adalah langkah berikutnya bila bebannya menuntut.
