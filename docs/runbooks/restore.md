# Runbook: pemulihan

Backup harian (`web/deploy/backup.sh`, cron 02.30 WIB) menyimpan dump database dan arsip volume data engine di `~/tradingagents/backups`, dan dengan `BACKUP_REMOTE` juga di penyimpanan lain. Detail pengaturannya ada di `web/README.md`, bagian Backup. `<user>` adalah user VPS.

## Uji restore (mingguan)

```bash
sudo BACKUP_DIR=/home/<user>/tradingagents/backups sh ~/tradingagents/src/web/deploy/restore-check.sh
```

Hasil yang baik: setiap tabel terhitung, arsip data terbaca sampai habis, dan baris terakhirnya `restore check ok`. Tabel dengan "-" di kolom backup dibuat oleh migrasi setelah backup itu. Kalau gagal: jalankan `backup.sh` sekarang, uji lagi, dan cek ruang disk (`df -h`) serta log backup (`/var/log/tradingagents-backup.log`).

## Memulihkan database dari dump lokal

1. Hentikan yang menulis ke database:
   ```bash
   cd ~/tradingagents/src/web/deploy && sudo docker compose stop app worker
   ```
2. Pulihkan dump yang dipilih (yang terbaru: `ls -1t ~/tradingagents/backups/db-*.dump | head -1`):
   ```bash
   sudo docker exec -i tradingagents-db-1 pg_restore -U tradingagents -d tradingagents --clean --if-exists < /home/<user>/tradingagents/backups/db-<waktu>.dump
   ```
3. Nyalakan lagi: `sudo docker compose up -d app worker`
4. Cek: `/healthz`, masuk sebagai admin, riwayat analisa, Konsol admin, Status layanan.

Data yang ditulis setelah dump itu hilang. Analisa yang sedang berjalan saat dump dibuat tercatat `running`; sapuan yatim menandainya gagal dalam beberapa menit.

## Dari salinan di luar VPS

```bash
sudo rclone copy <remote-crypt>:tradingagents/db-<waktu>.dump /tmp/
```
Lalu langkah di atas dengan `/tmp/db-<waktu>.dump`. Tanpa kata sandi remote crypt (disimpan di password manager), salinan itu tidak bisa dibuka.

## Memulihkan volume data engine

Volume `tradingagents_data` berisi laporan, memori keputusan, dan cache engine. Langkah kedua mengosongkan isi volume itu sebelum mengisinya dari arsip, jadi pastikan arsipnya yang benar.
```bash
cd ~/tradingagents/src/web/deploy && sudo docker compose stop app worker
sudo docker run --rm -v tradingagents_data:/data -v /home/<user>/tradingagents/backups:/in:ro postgres:16-alpine \
  sh -c 'find /data -mindepth 1 -delete && tar -xzf /in/data-<waktu>.tar.gz -C /data'
sudo docker compose up -d app worker
```

## Server baru (VPS hilang)

1. Pasang Docker. Salin rilis (`git archive`) ke `~/tradingagents/src`, lalu buat `web/deploy/.env` dari salinan aman (password manager), termasuk `POSTGRES_PASSWORD` yang sama.
2. `sudo docker compose up -d db`, ambil dump dari salinan di luar VPS, lalu pulihkan seperti di atas.
3. `sudo docker compose up -d --build`, pasang nginx dan TLS, lalu arahkan DNS.
4. Pasang lagi cron backup dan uji restore, `rclone config` (remote dan crypt), serta perintah deploy ([deploy.md](deploy.md)).
