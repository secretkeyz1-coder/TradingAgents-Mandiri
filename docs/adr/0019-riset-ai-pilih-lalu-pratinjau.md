# 0019. Riset AI: pilih aset di kiri, pratinjau di kanan

Status: Diterima · 2026-11-03 · mengganti bagian "Riset AI di layar lebar" dari [ADR 0018](0018-pasar-dan-riset-langsung-terbelah.md)

## Konteks

Menurut ADR 0018, Riset AI di layar lebar menaruh pemilih aset (`AssetPicker`) di tempat chart dan panel AI di kanan. Pemilik produk menilai hasilnya 2 dari 5:
- Pemilih aset berupa kolom sempit di tengah, dengan ruang kosong lebar di kiri dan kanannya.
- Panel AI di kanan sudah bekerja pada aset yang belum dipilih.
- Sebelum memilih, pengguna tidak melihat apa pun tentang aset itu: harga, grafik, atau keputusan AI terakhirnya.

Kanvas desain memberi tiga usulan, dan pemilik memilih usulan A: daftar aset di kiri, pratinjau aset yang dipilih di kanan.

## Keputusan

- **Awal Riset AI, sebelum chart aset dibuka, adalah `ResearchStart`.** Isinya dua kolom selebar layar:
  - **Kiri, `AssetPicker`:** kotak cari, tab pasar, dan kelompok "Untukmu".
    - Untukmu berisi Pantauanku, riset terakhir, dan aset yang terakhir dibuka. Kalau ketiganya kosong, isinya aset Populer.
    - Tiap baris menampilkan monogram, harga, perubahan hari ini, dan keputusan AI terakhir.
  - **Kanan, `ResearchPreview`:**
    - Grafik harga aset itu (`AssetView`, sama dengan Pemula), dengan tanda di hari-hari AI pernah memberi keputusan.
    - Keputusan AI terakhir (`GET /api/verdict`), lalu riwayat riset aset itu.
    - Satu tempat untuk mulai: Analisa lengkap (form analisa dilipat menjadi satu baris pengaturan dengan tombol Ubah) atau Tanya AI.
  - Di layar ≥ 1024 px, kedua kolom bergulir sendiri-sendiri. Daftar tetap terjangkau selama pratinjau dibaca.
- **Memilih aset tidak membuka chart.** `ws.preview()` hanya mengganti simbol aktif: urutan aset terakhir dibuka (`ws.recent`) dan URL tidak berubah. Chart lengkap terbuka lewat tiga jalan:
  - tombol "Buka chart lengkap";
  - memulai analisa (progresnya diikuti di panel AI);
  - mengirim pertanyaan (jawabannya ada di panel AI).
- **Panel AI tidak tampil di awal Riset AI.** Mulai analisa dan Tanya AI ada di pratinjau, dan keduanya menyebut nama aset. Alasan ADR 0015 tetap terjaga: tidak ada tombol analisa sebelum aset dipilih, jadi analisa tidak mulai pada aset yang tidak dimaksud.
- **Browser yang belum pernah membuka aset** melihat penjelasan cara kerja riset di kanan. Ia tidak melihat pratinjau aset bawaan yang tidak dipilih siapa pun.
- **Di ponsel**, daftar tampil dulu. Memilih aset membuka pratinjau, dengan tombol kembali "Daftar aset".
- **Tab "Jalankan" di panel AI menjadi "Analisa"**, nama yang sama dengan di pratinjau.
- Bagian Pasar dari ADR 0018 tidak berubah.

## Konsekuensi

- Pengguna melihat harga, grafik, dan keputusan AI terakhir sebuah aset sebelum memakai kuota.
- `GET /api/watchlist` kini mengirim dua hal terpisah:
  - `decision`: analisa terakhir yang selesai dengan rating;
  - `last`: percobaan terakhir.

  Dengan begitu analisa yang gagal tidak menyembunyikan keputusan sebelumnya. Pantauanku, Beranda, ringkasan pagi, dan daftar Pemula membaca rating dari `decision`.
- Panel bawah (Riwayat, Laporan, Log) baru muncul setelah chart dibuka. Riwayat aset yang sedang dipilih ada di pratinjau.
- **Alternatif yang ditolak:**
  - **Usulan B, pusat riset:** kotak cari besar di atas, lalu tiga kolom (Lanjutkan, Pantauanku, Riset terakhir) dan papan pasar. Pengguna tetap harus memilih sebelum melihat apa pun tentang asetnya.
  - **Usulan C, papan ubin:** tiap aset satu ubin dengan grafik kecil dan label keputusan AI. Bagus untuk memindai, tetapi grafik sekecil itu tidak cukup untuk memutuskan riset, dan layar lebar terisi ubin, bukan aset yang sedang dibaca.
