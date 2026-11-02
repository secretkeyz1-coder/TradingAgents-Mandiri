# 0013. Telegram sekali tekan: tautan /start sekali pakai, dibaca lewat long polling oleh pemimpin penjadwal

Status: Diterima · 2026-11-02

## Konteks

Notifikasi sinyal, notifikasi harga, dan rekap adalah alasan utama trader membuka aplikasi lagi, dan semuanya lewat Telegram. Sampai sekarang member harus mencari chat ID-nya sendiri (lewat bot lain), lalu menempelkannya di Profil. Langkah itu paling sering ditinggalkan, sehingga banyak notifikasi tidak pernah sampai.

Bot bisa menerima pesan dengan dua cara: webhook (Telegram memanggil URL publik aplikasi) atau long polling (`getUpdates`, aplikasi yang bertanya).

## Keputusan

- `POST /api/me/telegram/link` membuat token sekali pakai (18 byte acak, base64url) di tabel `telegram_links`, berlaku 15 menit. Token baru menggantikan token lama milik akun itu. Rutenya mengembalikan `https://t.me/<bot>?start=<token>`.
- Member menekan Start di Telegram, dan Telegram mengirim `/start <token>` ke bot.
- Instance pemimpin penjadwal ([ADR 0005](0005-satu-scheduler-advisory-lock.md)) membaca pesan bot dengan long polling `getUpdates` (timeout 25 detik, dicoba lagi tiap 3 detik). Offset-nya disimpan di `shared_values` (`telegram:offset`), jadi pemimpin baru melanjutkan dari tempat pemimpin lama berhenti. Kalau gagal, polling berhenti semenit.
- Token yang cocok dihapus (hanya berlaku sekali), `users.telegram_chat_id` diisi chat itu, dan bot membalas bahwa akun sudah terhubung. Token yang kedaluwarsa dibersihkan tiap hari.
- Halaman yang membuka tautan bertanya ke `GET /api/me` tiap 3 detik selama 3 menit, lalu menampilkan hasilnya.
- Mengisi chat ID sendiri di Profil tetap bisa, untuk grup.

## Konsekuensi

- Tidak perlu rute publik untuk Telegram: tanpa URL webhook, rahasia jalur, dan pendaftaran webhook per deployment. Dengan dua instance pun hanya satu yang membaca.
- Akun terhubung beberapa detik setelah Start ditekan.
- Satu token bot hanya boleh punya satu pembaca. Kalau bot pernah diberi webhook, atau server lain (misalnya server pengembangan) memakai token yang sama, `getUpdates` ditolak (409) dan log mencatat `telegram_poll_failed` tiap menit. Hapus webhook-nya (`deleteWebhook`) dan jangan menjalankan server lokal dengan token bot produksi.
- Alternatif yang ditolak:
  - **Webhook:** butuh rute publik, header rahasia, dan pengaturan di tiap deployment, dan tidak lebih cepat untuk kebutuhan ini.
  - **Tetap meminta chat ID:** langkah inilah yang ditinggalkan member.
  - **Telegram Login Widget:** domain harus didaftarkan lewat BotFather, dan widget itu tidak berjalan baik di browser dalam aplikasi.
