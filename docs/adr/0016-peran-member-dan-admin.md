# 0016. Peran member dan admin: layar trading sama, kontrol admin hanya di Konsol admin

Status: Diterima · 2026-11-02 · melengkapi [ADR 0010](0010-navigasi-lima-layar.md)

## Konteks

Konsol admin (`#/admin`) sudah memisahkan pekerjaan bisnis dari layar trading, tetapi beberapa kontrol admin masih tinggal di layar yang juga dipakai member:
- sakelar "Semua pengguna" di Riwayat dan Backtest;
- tombol "Kirim rekap tes" di Strategi live;
- nama variabel server (`TELEGRAM_BOT_TOKEN`, `SIGNAL_VENUE_FEES`) di catatan Telegram dan biaya;
- pilihan tim analis, kedalaman, bahasa, provider, model, dan backend URL di form analisa.

Admin yang memakai aplikasi sebagai trader melihat layar yang berbeda dari member, dan pemilik produk meminta pembagian peran yang jelas.

## Keputusan

- Layar trading (Beranda, Pasar, Riset AI, Pantau, Uji strategi) tampil sama untuk member dan admin. Datanya selalu milik akun yang sedang masuk.
- Semua kontrol admin ada di Konsol admin:
  - **Analisa & backtest** (`JobsPage`): seratus analisa dan uji saran AI terakhir dari semua akun, dengan akun, status, dan alasan gagal. Ini menggantikan sakelar "Semua pengguna".
  - **Pengaturan analisa** (`AnalysisSettingsPage`): tim analis, kedalaman, bahasa, provider, model, dan backend URL untuk analisa, uji saran AI, dan Tanya AI yang dijalankan admin. Disimpan di browser admin (`stores/analysisSettings`, kunci yang juga dibaca agent chat), jadi server tetap menghormati pilihan admin seperti sebelumnya. Form di aplikasi hanya menampilkan satu baris ringkasan dengan tautan ke halaman ini.
  - **Status layanan → Tes pesan:** rekap sinyal tes ke Telegram admin.
- Nama variabel server tidak pernah tampil di layar trading; Pengaturan server di Konsol tetap menyebutnya.
- Pembagian peran:

  | Hal | Member (Gratis, Pro, Creator) | Admin |
  | --- | --- | --- |
  | Layar trading | Ya | Ya, sama seperti member |
  | Data | Milik sendiri | Milik sendiri di aplikasi; semua akun hanya di Konsol |
  | Indikator | Skrip pribadi sesuai paket | Ditambah menerbitkan ke katalog per paket |
  | Model dan provider AI | Bawaan server | Pengaturan analisa di Konsol |
  | Kuota | Sesuai paket | Batas admin |
  | Pengguna, pembayaran, kupon, aktivitas, status, tes pesan | Tidak ada | Di Konsol |
  | Halaman rekam jejak publik | Paket Creator | Mengelola |

## Konsekuensi

- Yang dilihat admin di aplikasi adalah yang dilihat member, jadi admin bisa menilai pengalaman member tanpa akun kedua.
- Pengaturan analisa admin berlaku per browser. Admin yang pindah browser mulai dari bawaan server sampai mengaturnya lagi. Ini disengaja: pengaturan itu alat uji admin, bukan pengaturan server.
- Server tidak berubah: member tetap dipaksa memakai analisa standar dan model bawaan (`models.ts`), dan rute `?scope=all` tetap khusus admin.
- Alternatif yang ditolak:
  - **Membiarkan kontrol admin di layar trading tapi menandainya:** dua versi layar tetap ada.
  - **Model bawaan server yang bisa diubah dari Konsol:** perlu pengaturan server yang bisa diubah saat berjalan; belum dibutuhkan selama pilihan per analisa cukup untuk admin.
