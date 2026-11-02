# 0015. Pasar dimulai dari daftar pasar, Riset AI dari memilih aset

Status: Diterima · 2026-11-02 · melengkapi [ADR 0010](0010-navigasi-lima-layar.md)

## Konteks

Sejak ADR 0010, Pasar dan Riset AI sama-sama "layar chart". Kepala chart, toolbar, dan chart-nya persis sama; bedanya hanya panel di samping (daftar harga di Pasar, panel AI di Riset AI). Pemilik produk melihat keduanya sebagai satu layar dengan dua pintu.

Masalah yang terlihat:
- Daftar harga Pasar terjepit sekitar 360px di kiri, dan screener di bawahnya menampilkan pasar yang sama dengan gaya lain.
- Daftar dan chart bisa tidak nyambung: daftar menunjukkan IDX sementara chart menampilkan Bitcoin.
- Unsur AI (marker dan badge keputusan AI) muncul di Pasar.
- Riset AI langsung terbuka pada simbol apa pun yang terakhir aktif, jadi analisa (yang memakai kuota) bisa dimulai pada aset yang tidak dimaksud.

Permintaan pemilik produk:
- Pasar adalah pasar: daftar penuh dulu, chart baru muncul setelah aset diklik, dengan screener di panel bawah.
- Riset AI dimulai dengan memilih aset.
- Di Riset AI tetap mudah pindah dari satu aset ke aset lain, misalnya dari BTC-USD ke BNB-USD.

## Keputusan

- **Pasar** dibuka sebagai papan pasar selebar layar (`MarketBoard`): tab IDX, US, Crypto, Forex, Komoditas; status sesi; cari di daftar; kolom nama, harga, hari ini, garis 30 hari dan perubahannya (`GET /api/quotes?spark=1`), dan bintang Pantauanku. Screener pasar itu tetap di panel bawah.
- Klik aset membuka chart-nya. Daftar menyempit jadi kolom kiri dengan "Semua pasar" untuk kembali. Chart di Pasar tidak memuat keputusan AI (`research={false}`), dan tombol **Riset AI** membawa aset itu ke Riset AI tanpa memilih lagi.
- **Riset AI** dibuka dengan pemilih aset (`AssetPicker`): kotak cari, "Lanjutkan: <aset terakhir>", Pantauanku, aset populer, riset terakhir, dan sisa kuota. Setelah memilih, tampil chart dengan keputusan AI, panel Tanya/Jalankan, dan Riwayat/Laporan/Log.
- **Pindah aset di Riset AI** ada tiga cara:
  - Nama aset di kepala chart adalah tombol yang membuka pencari dengan daftar pasar dan harganya (`AssetSwitcher`, `AssetFinder`).
  - Aset yang terakhir dibuka tampil sebagai tombol satu klik, dengan tanda berputar bila analisanya masih berjalan.
  - Alt+↑/↓ pindah ke aset sebelah di daftar pasarnya (`ws.step`), tanpa menambah riwayat browser untuk tiap langkah.
- **Status di URL:**
  - Di Pasar dan Riset AI, simbol di URL (`s=`) berarti chart terbuka; tanpa simbol, layar menampilkan papan pasar atau pemilih aset.
  - Tombol menu atas selalu membuka papan atau pemilih (`ws.go`), dan Back kembali ke keadaan sebelumnya.
  - Layar lain tidak menulis `s=`.
  - Tautan lama yang menyebut simbol, termasuk dari Telegram dan email, tetap membuka chart-nya.
- **Simbol aktif tetap satu.** Memilih aset juga memindah daftar Pasar ke pasarnya. Daftar aset yang terakhir dibuka disimpan di browser (`ta.recent`, enam terakhir), dan simbol pertama di daftar itu dipakai saat aplikasi dimuat tanpa simbol di URL.
- **Ponsel:** Pasar menampilkan papan (dengan tab Screener), lalu chart dengan tombol kembali. Riset AI menampilkan pemilih, lalu pengganti aset di atas tab Chart, Tanya, Jalankan, Riwayat, Laporan, dan Log. Kotak cari hanya mendapat fokus otomatis di layar lebar, karena keyboard ponsel akan menutupi pilihannya.
- Menit aktivitas ([ADR 0012](0012-aktivitas-member-per-menit.md)) mencatat simbol hanya saat chart terbuka.

## Konsekuensi

- Kedua layar punya tugas yang jelas: Pasar untuk melihat dan memilih aset, Riset AI untuk meminta AI meneliti satu aset. Analisa tidak lagi dimulai pada aset yang kebetulan aktif.
- Pindah aset di Riset AI butuh satu sampai dua klik (atau satu tombol keyboard), sementara daftar harga tidak memakan lebar chart dan panel AI.
- Masuk ke Pasar dari menu selalu membuka papan, jadi kembali ke chart terakhir butuh satu klik (atau Back). Ini disengaja: Pasar dimulai dari pasar.
- Papan memuat harga semua aset satu tab sekaligus (paling banyak 59 di IDX), enam permintaan data sekaligus di server; data harian sudah di-cache, jadi tambahan garis 30 hari tidak menambah permintaan ke sumber data.
- Alternatif yang ditolak:
  - **Daftar harga selalu di sisi Riset AI:** satu klik ke aset lain, tapi chart dan panel AI jadi sempit.
  - **Menggabungkan Pasar dan Riset AI jadi satu layar:** itulah keadaan yang dikeluhkan.
  - **Riset AI langsung membuka aset terakhir tanpa bertanya:** lebih cepat, tapi mengulang masalah analisa yang memakai kuota pada aset yang tidak dimaksud.
