# 0021. Beranda: ringkasan pagi, dan Riwayat call di layarnya sendiri

Status: Diterima · 2026-11-03

## Konteks

Beranda Pro memuat semuanya dalam satu halaman panjang: strip pasar, daftar "Sejak kamu terakhir buka", Pantauanku, ringkasan pasar AI, enam angka kinerja sinyal, kurva R, tabel per indikator dan per aset, tabel Riwayat call, dan kolom samping berisi Sedang berjalan, Jurnal, Kuota, Analisa Pantauanku, dan Alert harga.

Kritik desain memberi skor 19 dari 40. Masalah utamanya:
- **Riwayat call adalah sampel diam-diam.** `GET /api/alerts/history` menghitung angka dari semua call periode itu, tetapi daftarnya hanya 200 call terbaru, dan saringan Semua/TP/SL/Berjalan jalan di browser atas 200 baris itu.
  - Akun produksi yang aktif (13 notifikasi) membuat 46 call dalam 24 jam; hari tersibuknya 42.
  - Di akun uji dengan 665 call dalam 30 hari, daftar berhenti di hari keempat, dan "SL kena" menampilkan 74 dari 260.
- **Bagian atas tidak memilah.** "Sejak kamu terakhir buka" adalah dinding baris tanpa hasil dan jam, dan server memotongnya 20 per jenis, jadi sebagian besar call semalam hilang tanpa jejak. Sedang berjalan, satu-satunya bagian yang bisa ditindaklanjuti, ada di kolom samping.
- **Angka R tidak jujur bentuknya.** "+20,71R" adalah sebelum biaya, hanya dari call yang kena TP atau SL, dan R tidak pernah dijelaskan.
- **Kosakata dan isinya berbeda dari layar yang sudah didesain ulang (ADR 0019).** Overweight/Underweight dan BUY/SELL, bukan "Cenderung jual" dan Jual; Pantauanku tampil dua kali; Jurnal dan Alert harga mengulang tab Pantau.
- Di 1440 px tingginya 9.767 px, 76% di antaranya tabel 200 baris.

Kanvas desain memberi tiga arah (A ringkasan pagi, B kokpit satu layar, C linimasa) dan pola Riwayat call yang terukur. Pemilik produk memilih A, dan Riwayat call di layarnya sendiri.

## Keputusan

- **Beranda menjawab tiga hal dengan urutan ini:** apa yang berubah sejak terakhir buka, apa yang perlu dikerjakan sekarang, lalu pasar dan aset. Di layar ≥ 1024 px dua kolom; di ponsel satu kolom dengan urutan yang sama.
  - **Sejak kamu terakhir buka:** satu kalimat yang menghitung sinyal baru menurut keadaannya sekarang, beserta R-nya sebelum biaya. Lalu satu baris per aset, yang tersibuk dulu, dengan satu manik per call: TP bulat, SL wajik, berjalan cincin, yang lain titik kecil. Bentuknya ikut menyebut hasil, jadi warna tidak pernah sendirian. Lalu alert harga yang kena dan analisa yang selesai.
  - **Sedang berjalan:** semua call yang masih diikuti (berapa pun umurnya) dan trade jurnal, masing-masing di jalur SL–entry–TP yang sama dengan Pantau → Jurnal, dengan harga sekarang dan Saya ambil.
  - **Sinyalmu:** 7 atau 30 hari. R ditulis "sebelum biaya, dari N call yang kena TP atau SL", R dijelaskan dalam satu kalimat, lalu kurva per hari dan 8 call terbaru per hari WIB.
  - **Kolom samping:** pasar utama dengan sesinya dalam WIB dan perubahan "dari penutupan sebelumnya" (jam 07.00 tidak lagi menyebut sesi IDX kemarin "hari ini"), Pantauanku dengan keputusan AI dalam kata-kata Pemula, ringkasan pasar AI yang dilipat ke judulnya, dan kuota.
  - Tabel per indikator dan per aset, Jurnal, Alert harga, dan Analisa Pantauanku pindah keluar dari Beranda. Per indikator dan per aset menjadi saringan di Riwayat call; sisanya ada di Pantau.
  - **Akun yang belum punya Pantauanku atau notifikasi sinyal** mulai dari "Mulai di sini", tiga langkah bercentang (Pantauanku, notifikasi sinyal, Telegram), menggantikan bagian yang hanya akan kosong.
- **Riwayat call adalah layar Beranda sendiri** (`#/beranda?view=calls`, bisa dengan `asset` dan `since`). Ia terbuka dari:
  - "Lihat semua N call";
  - satu aset di "Sejak kamu terakhir buka" (call aset itu sejak kunjungan tadi);
  - "Lihat semua di Riwayat call" di Rekam jejak live.
- **Pola Riwayat call: dipotong di Beranda, lengkap di layarnya, dimuat bertahap.**
  - Call dikelompokkan per hari WIB. Kepala tiap hari memuat total hari itu dalam saringan yang aktif, di halaman mana pun call-nya berada.
  - Saringan hasil (dengan jumlah), aset, dan indikator (dengan R masing-masing) jalan di server, jadi angka saringan dan isi daftar selalu sama.
  - "Tampilkan 50 lagi" memakai kursor: waktu call dicatat sampai mikrodetik, lalu id-nya. Call baru yang masuk di atas tidak menggeser halaman yang sudah dimuat.
- **API:**
  - `GET /api/alerts/calls?days=7|30|90|365&status=all|open|win|loss|other&symbol=&indicator=&timeframe=&since=&before=&limit=1–100` mengembalikan `{ calls, next, total, counts, days }`. Input dibaca zod; saringan yang tidak terbaca ditolak dengan 400, tidak diabaikan.
  - `GET /api/alerts/history` tetap mengirim angka, kurva, per indikator, dan per aset. Daftarnya `calls` (8 terbaru), ditambah `open` (semua call yang masih diikuti).
  - `GET /api/activity/since` mengirim `signals` (jumlah per keadaan dan R) dan `byAsset` (per aset: jumlah, indikator, dan hasil 40 call terbarunya), menggantikan daftar 20 call.
  - Tiap call membawa `at`, waktu ia dicatat, untuk jam dan hari WIB.

## Konsekuensi

- Di akun uji yang meniru akun produksi, tinggi Beranda di 1440 px turun dari 9.767 px menjadi 2.488 px, dan di 375 px dari 11.991 px menjadi ±5.000 px.
- Saringan Riwayat call tidak lagi bohong: "Kena SL 260" menampilkan 260 call, dimuat 50 sekaligus.
- "Sejak kamu terakhir buka" menghitung semua call sejak kunjungan sebelumnya (dibaca sampai 3.000 call), bukan 20 baris pertama.
- Beranda memakai kosakata ADR 0019 (`ta-mono`, `ta-chip` dengan panah, `ta-track`), ditambah manik hasil, `ta-cday` untuk kepala hari, `ta-call` untuk baris call, dan `ta-facet` untuk saringan di `app.css`.
- `levelTrack` (jalur SL–entry–TP) pindah ke `marks.ts`, dan dipakai bersama Pantau → Jurnal dan Beranda.
- `MorningSummary.svelte` dihapus. Isinya dibagi ke `beranda/SinceDigest.svelte` dan `beranda/MarketSide.svelte`.
- **Alternatif yang ditolak:**
  - **Arah B, kokpit:** satu layar tanpa gulir, pita angka hari ini, tiga kolom yang bergulir sendiri. Padat dan cocok dibiarkan terbuka, tetapi tiga gulungan dalam satu layar berat di ponsel, dan semua bagian berebut perhatian.
  - **Arah C, linimasa:** semua kejadian dalam satu aliran per hari. Sederhana di ponsel, tetapi kinerja sinyal tersembunyi, dan 40 kejadian sehari tetap harus dilipat per aset.
  - **Halaman bernomor:** nomor halaman tidak berarti di catatan waktu, dan call baru menggeser isi tiap halaman.
  - **Gulir tanpa akhir:** bagian di bawah daftar tidak tercapai, dan posisi hilang setelah membuka chart.
  - **Riwayat call tetap di Beranda dengan Tampilkan 50 lagi:** Beranda kembali menjadi halaman panjang.
