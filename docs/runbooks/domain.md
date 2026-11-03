# Runbook: domain baru atau pindah domain

Cara memasang domain baru untuk aplikasi dan mengalihkan domain lama ke sana, seperti perpindahan ke tradermedan.com ([ADR 0022](../adr/0022-merek-tradermedan-horas.md)). Setiap perubahan di server (nginx, sertifikat, `.env`) butuh persetujuan pemilik, satu per satu.

Latarnya:
- nginx di VPS melayani banyak situs di port 80 dan 443.
- Port 443 masuk lewat blok `stream` (`/etc/nginx/streams-enabled/`). Blok itu membaca nama host (SNI) dan meneruskan semua nama, kecuali server TURN, ke `127.0.0.1:4443` dengan proxy protocol. Tiap situs punya blok `server` sendiri di 4443, jadi domain baru tidak perlu mengubah blok `stream`.
- Host yang tidak dikenal ditolak oleh `00-default-reject.conf`: koneksi HTTP ditutup (444) dan handshake TLS ditolak. Di balik proksi Cloudflare, itu tampil sebagai galat 520 dan 525.
- Sertifikat berasal dari Let's Encrypt lewat certbot dengan metode webroot dan kunci ECDSA, lalu diperpanjang oleh `certbot.timer`.

## 1. DNS (pemilik domain)

1. Arahkan nama domain ke VPS:
   - Record A `@` ke IP VPS.
   - Record A `www` ke IP yang sama, atau CNAME `www` ke `<domain>`.
2. Pakai status proksi **DNS only** (awan abu-abu), setidaknya untuk `@`. Alasannya:
   - Aplikasi mengenali pengunjung dari `X-Real-IP`, yang diisi nginx dengan alamat koneksi. Alamat itu dipakai untuk mengunci tebakan kata sandi (10 kali per alamat), membatasi pendaftaran (5 per jam), dan membatasi kiriman email (5 per jam). Di balik proksi Cloudflare, semua member tampak datang dari beberapa IP Cloudflare, jadi pengaman itu ikut mengunci member lain.
   - Cloudflare memutus respons yang diam lebih dari 100 detik. Stream analisa aman karena mengirim ping tiap 15 detik, tapi stream chat AI belum punya ping.
   - `www` yang tetap diproksikan tidak masalah, karena ia hanya mengalihkan ke domain utama.
3. Hapus record A atau AAAA lain untuk `@` dan `www`, kecuali yang di atas.
4. Tunggu sampai `nslookup <domain>` menjawab IP VPS. Resolver publik bisa menyimpan jawaban lama selama TTL-nya, biasanya 5 menit.

Proksi Cloudflare bisa dinyalakan belakangan, dengan tiga syarat:
- nginx membaca IP asli dari `CF-Connecting-IP`, dan hanya mempercayainya dari daftar IP resmi Cloudflare.
- Stream chat AI diberi ping.
- SSL Cloudflare diatur ke "Full (strict)".

## 2. Sertifikat

Sebelum mengubah apa pun, simpan cadangan berkas situs yang akan disentuh, misalnya `sudo cp /etc/nginx/sites-available/<domain-lama>.conf ~/nginx-backups/`.

Pasang situs port 80 saja dulu: ia melayani tantangan ACME dan mengalihkan sisanya ke HTTPS. Blok HTTPS belum bisa dipasang, karena sertifikatnya belum ada dan `nginx -t` akan gagal.

```sh
sudo mkdir -p /var/www/<domain>
sudo tee /etc/nginx/sites-available/<domain>.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name <domain> www.<domain>;
    location /.well-known/acme-challenge/ { root /var/www/<domain>; }
    location / { return 301 https://<domain>$request_uri; }
}
EOF
sudo ln -s /etc/nginx/sites-available/<domain>.conf /etc/nginx/sites-enabled/<domain>.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --account <id> --webroot -w /var/www/<domain> -d <domain> -d www.<domain> --key-type ecdsa --non-interactive
```

VPS ini punya lebih dari satu akun certbot, dan tanpa `--account` certbot berhenti untuk bertanya. Pakai akun yang sama dengan sertifikat yang sudah ada, yaitu nilai `account =` di `/etc/letsencrypt/renewal/<domain-lama>.conf`.

Sertifikat juga bisa diambil saat record masih diproksikan, selama Cloudflare meneruskan HTTP biasa ke VPS (pengaturan "Always Use HTTPS" mati). Cara mengujinya: taruh berkas di `/var/www/<domain>/.well-known/acme-challenge/`, buka lewat `http://<domain>/...`, lalu hapus lagi.

## 3. Situs HTTPS

Tambahkan dua blok 4443 ke `/etc/nginx/sites-available/<domain>.conf`:
- **Blok aplikasi:** salin dari situs aplikasi yang sedang jalan, dengan pengaturan proxy yang sama (`proxy_buffering off` dan batas waktu 3600 detik untuk stream). Yang berbeda hanya `server_name` dan sertifikatnya.
- **Blok `www`:** cukup mengalihkan ke domain utama.

```nginx
server {
    listen 127.0.0.1:4443 ssl proxy_protocol;
    listen [::1]:4443 ssl proxy_protocol;
    http2 on;
    server_name <domain>;
    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    # ...pengaturan proxy, gzip, dan client_max_body_size dari situs aplikasi yang sedang jalan...
    location / { proxy_pass http://127.0.0.1:8410; }
}
server {
    listen 127.0.0.1:4443 ssl proxy_protocol;
    listen [::1]:4443 ssl proxy_protocol;
    http2 on;
    server_name www.<domain>;
    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://<domain>$request_uri;
}
```

Lalu jalankan `sudo nginx -t && sudo systemctl reload nginx`. Sejak saat ini aplikasi bisa dibuka di kedua domain.

## 4. PUBLIC_URL

`PUBLIC_URL` dipakai untuk tautan di email, tagihan, dan pesan Telegram. Telegram memakai long polling, jadi tidak ada webhook yang perlu diganti.

1. Simpan cadangan `.env` ke `~/tradingagents/env-backups/`.
2. Ubah `PUBLIC_URL=https://<domain>` di `src/web/deploy/.env`.
3. Jalankan `sudo docker compose up -d app worker </dev/null`, atau biarkan deploy berikutnya membawanya, karena `deploy.sh` menyalin `.env` dari rilis yang sedang jalan.

## 5. Domain lama

Ubah kedua blok situs lama:
- **Blok port 80:** tetap melayani `/.well-known/acme-challenge/`, supaya sertifikat lamanya terus diperpanjang selama pengalihan dipakai. Selain itu, ia mengembalikan `return 301 https://<domain>$request_uri;`.
- **Blok 4443:** tetap memakai sertifikat lama, dan isinya hanya `return 301 https://<domain>$request_uri;`.

Hash di alamat (`#/...`) tidak dikirim ke server, tapi browser membawanya ke alamat tujuan. `client/public/legacy-hash.js` lalu meneruskan `/#/...` ke `/app`.

Jalankan `sudo nginx -t && sudo systemctl reload nginx`.

## 6. Cek

- `curl -sI https://<domain>/` menjawab 200, dan `curl -s https://<domain>/healthz` menjawab sehat.
- `https://www.<domain>/x?y=1` dan `https://<domain-lama>/x?y=1` menjawab 301 ke `https://<domain>/x?y=1`.
- `https://<domain>/api/public/status` menunjukkan semua bagian berjalan.
- Member perlu masuk ulang sekali, karena cookie sesi terikat ke domain.

## Rollback

1. Kembalikan berkas situs lama dari cadangan.
2. Hapus symlink situs baru di `sites-enabled`.
3. Jalankan `sudo nginx -t && sudo systemctl reload nginx`.
4. Kembalikan `.env` dari cadangannya, lalu `sudo docker compose up -d app worker </dev/null`.

Sertifikat domain baru boleh tetap ada; certbot hanya akan gagal memperpanjangnya kalau DNS-nya tidak lagi menunjuk ke VPS.
