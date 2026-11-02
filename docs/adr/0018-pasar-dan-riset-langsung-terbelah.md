# 0018. Pasar dan Riset AI langsung terbelah di layar lebar

Status: Diterima · 2026-11-02 · mengganti bagian "awal layar" dari [ADR 0015](0015-pasar-dan-riset-dimulai-tanpa-chart.md) untuk layar lebar

## Konteks

Menurut ADR 0015, di layar lebar:
- Pasar dibuka dengan papan pasar selebar layar.
- Riset AI dibuka dengan pemilih aset selebar layar.
- Chart dan panel AI baru muncul setelah aset diklik.

Setelah mencobanya, pemilik produk merasa perpindahan dari papan ke chart seperti membuka halaman baru, dan meminta dua hal:
- **Pasar langsung terbelah:** daftar pasar di kiri, chart di kanan dengan aset bawaan (misalnya BTCUSDT). Pindah aset cukup klik di daftar, tanpa terasa reload.
- **Riset AI juga terbelah:** pilihan aset di kiri, AI (Tanya dan Jalankan) di kanan. Setelah aset diklik, chart di kiri dan AI tetap di kanan.

## Keputusan

- **Pasar di layar ≥ 1024 px selalu menampilkan chart.**
  - Asetnya adalah yang terakhir dibuka di browser itu. Browser yang belum pernah membuka aset mulai dari Bitcoin (`BINANCE:BTCUSDT`, `DEFAULT_SYMBOL`), karena kripto bergerak sepanjang hari.
  - `#/pasar` tanpa simbol diisi simbol itu dengan replace, tanpa entri riwayat baru.
  - Daftar dibuka di pasar milik chart-nya, jadi keduanya tidak pernah menunjukkan pasar yang berbeda.
  - Store memutuskan ini saat URL dibaca (`splitPasar` di `stores/workspace.svelte.ts`), sebelum layar digambar. Jadi widget screener tidak dimuat dua kali. Shell hanya menyusul saat jendela diperbesar dari ukuran ponsel (`keepChart`).
- **Daftar di kiri (`MarketPanel`)** mendapat isi yang dulu hanya ada di papan pasar: status sesi, cari di daftar, bintang Pantauanku, dan kolom 30 hari bila panelnya dilebarkan (lebar maksimal naik ke 600 px).
  - Klik baris hanya mengganti chart di sebelahnya; baris aset yang aktif selalu terlihat di daftar.
  - Tombol "Semua pasar" dihapus, karena di layar lebar tidak ada papan lagi.
- **Riset AI di layar lebar:** pemilih aset (`AssetPicker`) menempati tempat chart, dan panel AI sudah tampil di kanan.
  - Sebelum ada aset yang dipilih, panel AI bekerja pada aset yang sedang aktif dan menyebutnya: "Riset untuk …, pilih aset lain di kiri". Tombol analisa juga menyebut nama aset. Dengan begitu, alasan ADR 0015 (analisa tidak mulai pada aset yang tidak dimaksud) tetap terjaga.
  - Memilih aset membuka chart-nya di tempat pemilih, dan panel bawah (Riwayat, Laporan, Log) ikut muncul. Menu Riset AI di bilah atas kembali ke pemilih.
- **Ponsel tidak berubah:** Pasar dimulai dari papan pasar (`MarketBoard`) dan Riset AI dari pemilih aset, satu hal per layar.

## Konsekuensi

- Pindah aset di Pasar cukup satu klik. Hanya data chart yang dimuat ulang, bukan halamannya.
- Papan pasar selebar layar sekarang hanya dipakai di ponsel.
- Panel AI di awal Riset AI langsung bisa dipakai untuk aset yang terakhir dibuka.
- Aset bawaan berubah dari IHSG ke Bitcoin untuk semua layar yang memakai simbol aktif, termasuk Pemula, tetapi hanya di browser yang belum pernah membuka aset.
- **Alternatif yang ditolak:**
  - **Tiga kolom di Riset AI (daftar, chart, AI) sekaligus:** chart terjepit di layar 1280 px, dan pemilik produk meminta dua kolom.
  - **Tetap papan dulu, lalu chart di kanan setelah klik:** justru perpindahan ini yang terasa seperti reload.
