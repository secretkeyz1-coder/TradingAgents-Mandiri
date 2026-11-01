# Runbook: masuk dengan Google

Tombol "Daftar dengan Google" dan "Masuk dengan Google" muncul sendiri begitu server punya `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` (`web/server/src/auth.ts`). Tanpa keduanya tombol itu tersembunyi dan pendaftaran tetap jalan lewat email. `<domain>` adalah alamat publik aplikasi, sama dengan `PUBLIC_URL`; jangan tulis nilainya di repositori ini.

## Yang terjadi saat seseorang masuk dengan Google

- Akun baru hanya dibuat bila `SIGNUP=open`. Emailnya dianggap terverifikasi karena Google sudah memeriksanya, jadi trial Pro langsung aktif.
- Akun email yang sudah ada dengan alamat yang sama ditautkan ke Google. Bila alamat itu belum pernah diverifikasi, kata sandinya dihapus dan semua sesinya berakhir, supaya hanya pemilik kotak masuk yang bisa masuk.
- Sebelum aplikasi terbuka, akun Google wajib mengisi nomor WhatsApp di layar "Satu langkah lagi" (`web/client/src/lib/PhoneStep.svelte`). Sampai terisi, server menolak analisa AI dan chat agent, dan setelahnya akun Google tidak bisa menghapus nomornya dari Profil (`needsPhone` di `web/server/src/plans.ts`). Admin tidak terkena aturan ini.

## Membuat kunci di Google Cloud

1. Di Google Cloud Console, buat atau pilih project untuk aplikasi ini.
2. **APIs & Services → OAuth consent screen**: tipe *External*. Isi nama aplikasi, email dukungan, domain yang diizinkan (domain dari `<domain>`), kebijakan privasi `https://<domain>/privasi`, dan syarat `https://<domain>/syarat`. Scope cukup `openid`, `email`, dan `profile`.
3. Selama status aplikasinya *Testing*, hanya akun di daftar *Test users* yang bisa masuk. Tekan **Publish app** agar semua orang bisa.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, tipe *Web application*:
   - *Authorized JavaScript origins*: `https://<domain>`
   - *Authorized redirect URIs*: `https://<domain>/api/auth/google/callback`
5. Salin *Client ID* dan *Client secret*.

## Memasang di server

Di VPS, dari `~/tradingagents/src/web/deploy` (rilis yang berjalan; deploy berikutnya membawa `.env` ini):

```bash
cp -p .env ~/tradingagents/env-backups/env-$(date -u +%Y%m%d-%H%M%S)-before-google
nano .env                                # tambahkan GOOGLE_CLIENT_ID=... dan GOOGLE_CLIENT_SECRET=...
grep -c '^PUBLIC_URL=https://' .env      # harus 1: alamat callback dibentuk dari PUBLIC_URL
sudo docker compose up -d app worker </dev/null
```

## Memeriksa

- `curl -s https://<domain>/api/auth/config` membalas `"google":true`.
- Halaman masuk dan daftar menampilkan tombol Google. Coba dengan akun Google sendiri: setelah memilih akun, layar "Satu langkah lagi" meminta nomor WhatsApp, lalu aplikasi terbuka. Di Konsol admin → Pengguna, nomornya tampil di samping email akun itu.
- Bila gagal, aplikasi terbuka dengan pesan dari `?notice=`:
  - `google-failed`: biasanya *redirect URI* tidak persis `https://<domain>/api/auth/google/callback`, `PUBLIC_URL` salah, atau secret salah.
  - `signup-closed`: akun baru ditolak karena `SIGNUP` bukan `open`.
  - `google-cancelled`: pengguna membatalkan di layar Google.
- Google sendiri menampilkan `redirect_uri_mismatch` bila alamat callback belum didaftarkan di langkah 4.

## Mematikan

Hapus kedua baris `GOOGLE_*` dari `.env`, lalu `sudo docker compose up -d app worker </dev/null`. Akun yang dibuat lewat Google tetap ada tetapi tidak punya kata sandi: minta mereka membuatnya dulu di Profil → Keamanan ("Buat kata sandi") agar tetap bisa masuk dengan email.
