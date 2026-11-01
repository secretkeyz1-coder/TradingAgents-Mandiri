# Runbook: deploy

Bagaimana rilis sampai ke produksi, dan cara membatalkannya. Latar belakangnya: [ADR 0007](../adr/0007-migrasi-langkah-deploy.md) dan [ADR 0008](../adr/0008-deploy-rilis-berdampingan.md). `<user>`, `<host>`, dan `<APP_PORT>` adalah milik VPS-mu; jangan tulis nilainya di repositori ini.

## Menyiapkan deploy dari GitHub Actions (sekali)

1. Buat pasangan kunci khusus deploy di laptop, tanpa passphrase, hanya untuk CI:
   ```bash
   ssh-keygen -t ed25519 -f ta-deploy -C deploy@github-actions -N ""
   ```
2. Pasang perintah penerima di VPS, dari checkout atau rilis yang ada di sana:
   ```bash
   sudo install -m 0755 ~/tradingagents/src/web/deploy/receive-release.sh /usr/local/bin/tradingagents-deploy
   ```
3. Tambahkan kunci publik (`ta-deploy.pub`) ke `~/.ssh/authorized_keys` user VPS, dibatasi ke satu perintah:
   ```
   command="/usr/local/bin/tradingagents-deploy",restrict ssh-ed25519 AAAA... deploy@github-actions
   ```
4. Di GitHub, Settings, Secrets and variables, Actions (atau secret milik environment `production`):
   - `DEPLOY_HOST`: alamat VPS
   - `DEPLOY_USER`: user VPS
   - `DEPLOY_SSH_KEY`: isi berkas `ta-deploy` (kunci privat)
   - `DEPLOY_KNOWN_HOSTS`: hasil `ssh-keyscan -t ed25519 <host>`; pastikan sidiknya sama dengan milik server

   Hapus `ta-deploy` dari laptop setelah tersimpan sebagai secret.
5. Opsional: Settings, Environments, `production`, wajibkan persetujuan reviewer sebelum deploy berjalan.

## Sebelum deploy pertama Fase 1 dan Fase 2

- `SESSION_SECRET` wajib ada di `.env` produksi; tanpa itu server baru menolak start. Buat langsung di VPS tanpa menampilkannya, setelah mem-backup `.env`:
  ```bash
  cd ~/tradingagents/src/web/deploy
  cp -p .env ~/tradingagents/env-backups/.env.$(date +%Y%m%d-%H%M%S)
  printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
  ```
  Efeknya: semua orang keluar sekali, dan tautan tagihan lama tidak berlaku.
- Deploy pertama lewat `deploy.sh` mengubah `~/tradingagents/src` dari direktori biasa menjadi symlink ke rilis; direktori lama disimpan sebagai `releases/<waktu>-before-releases`. Cron backup tetap memakai `src/web/deploy/backup.sh` lewat symlink itu.
- Compose baru menambah service `migrate` dan `worker`; app tidak lagi menjalankan analisa.

## Menjalankan deploy

Actions, Deploy, Run workflow, pilih cabang, ketik `deploy`. Urutannya:
1. cek web di commit itu (sekitar 2 menit);
2. dikemas dengan `git archive` lalu dikirim lewat SSH;
3. `deploy.sh` di VPS: build image (beberapa menit), migrasi, ganti app dan worker, tunggu `/healthz`.

Baris terakhir log job "deploy to production" berbunyi `deploy: ok: <commit> runs on port ...` atau `deploy: FAILED: <sebab>; bringing the previous release back`.

Tanpa Actions, dari laptop dengan akses SSH biasa:
```bash
git archive --format=tar.gz HEAD | ssh <user>@<host> /usr/local/bin/tradingagents-deploy "$(git rev-parse HEAD)"
```

## Setelah deploy

```bash
cd ~/tradingagents/src/web/deploy
curl -s http://127.0.0.1:<APP_PORT>/healthz                 # ok
sudo docker compose ps                                       # app dan worker running; migrate exited (0)
sudo docker compose logs migrate | tail -1                   # migrations_applied, total N
sudo docker compose logs app --since 10m | grep '"level":"error"'   # kosong
cat ~/tradingagents/src/REVISION                             # commit yang berjalan
```

## Rollback

Otomatis: `deploy.sh` memulihkan image `:previous` dan rilis sebelumnya kalau build, migrasi, kesehatan app, atau worker gagal.

Manual, kalau rilis baru berjalan tetapi ternyata salah:
```bash
cd ~/tradingagents
ls -1t releases/                                   # rilis terbaru di atas; pilih yang sebelumnya
ln -sfn ~/tradingagents/releases/<rilis-sebelumnya> src
sudo docker tag tradingagents-web:previous tradingagents-web:latest
cd src/web/deploy && sudo docker compose up -d --no-build
```
Migrasi tidak di-rollback: skema baru tetap ada, dan versi lama tetap berjalan di atasnya karena migrasi hanya menambah ([ADR 0007](../adr/0007-migrasi-langkah-deploy.md)). Image `:previous` hanya satu langkah ke belakang; rilis yang lebih tua perlu di-build ulang (`sudo docker compose build` dari direktori rilisnya).
