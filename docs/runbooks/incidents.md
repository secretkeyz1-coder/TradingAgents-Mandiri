# Runbook: insiden

Peringatan server datang lewat Telegram (`web/server/src/monitor.ts`) ke `ALERT_CHAT_ID` atau ke admin yang mengisi chat ID. Setiap kondisi dikirim sekali saat mulai dan sekali saat pulih. Perintah di bawah dijalankan di VPS dari `~/tradingagents/src/web/deploy`; `<APP_PORT>` milik VPS-mu.

## Tempat melihat

- Konsol admin, Status layanan: error server 30 hari terakhir, dengan kode, sumber, pesan, dan stack.
- Log JSON, satu objek per baris:
  ```bash
  sudo docker compose logs app --since 30m | grep '"level":"error"'
  sudo docker compose logs worker --since 30m | grep '"level":"error"'
  ```
- Kode error yang dilaporkan pengguna (8 karakter) sama dengan `X-Request-Id`: cari `"code":"<kode>"` di log, atau di Konsol admin.
- Metrik (dengan `METRICS_TOKEN`): `curl -s -H "Authorization: Bearer <token>" http://127.0.0.1:<APP_PORT>/metrics | grep '^ta_'`
- Instance pemegang scheduler: baris log `scheduler_leader`, atau `ta_scheduler_leader 1` di metrik.

## Per peringatan

### "N error server dalam 10 menit terakhir"

Pesan menyebut sumbernya. `request` berarti rute yang error (bug, atau database bermasalah); buka pesan dan stack-nya di Konsol admin. `scan`, `prices`, `brief`, `watchlist`, dan sejenisnya adalah kerja latar, biasanya karena sumber data atau LLM; lihat bagian yang terkait di halaman status.

### "Antrean analisa tidak berjalan"

```bash
sudo docker compose ps worker
sudo docker compose logs worker --since 30m | tail -50
sudo docker compose up -d worker              # nyalakan lagi
sudo docker compose up -d --scale worker=2    # tambah kalau antrean memang panjang
```
Kalau worker jalan tetapi tidak mengambil antrean: cek error koneksi database di lognya, dan pastikan `MAX_CONCURRENT_ANALYSES` di `.env` minimal 1. App sendiri sengaja tidak menjalankan analisa (`MAX_CONCURRENT_ANALYSES=0` di compose).

### "N analisa gagal dalam 30 menit terakhir"

Pesan gagal tiap analisa ada di riwayat analisa. Yang umum:
- backend LLM menolak (kunci habis, kuota, alamat berubah);
- engine gagal memuat setelah upgrade (log worker);
- "Worker berhenti karena restart atau deploy": wajar sesaat setelah deploy, pengguna perlu menjalankannya lagi.

### "Pemindai sinyal tidak berjalan"

- Apakah ada pemegang scheduler? Cari `scheduler_leader` di log app. Kalau tidak ada, cek koneksi app ke database.
- Apakah Binance terjangkau dari VPS? Lihat bagian Harga kripto di halaman status.
- Log app: `grep -E 'signals_|signal_scan_exit'`.

### "Cek status menemukan bagian yang mati"

- Database: `sudo docker compose ps db`, `sudo docker compose logs db --since 30m`.
- Harga kripto: `curl -s https://api.binance.com/api/v3/ping` dari VPS.
- Mesin analisa AI: katalog model gagal dimuat; cari `catalog` di log app.
- Email dan Telegram: pengaturan `.env` (Konsol admin, Pengaturan server).

## Setelah insiden

Tulis singkat di Catatan di bawah: tanggal, gejala, penyebab, perbaikan, dan apa yang mencegahnya terulang (tes, peringatan, atau langkah runbook). Kalau perbaikannya mengubah keputusan arsitektur, tulis ADR baru.

## Catatan

Belum ada insiden yang dicatat.
