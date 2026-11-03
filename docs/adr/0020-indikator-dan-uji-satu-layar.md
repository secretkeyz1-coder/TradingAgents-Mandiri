# 0020. Indikator dan ujinya di satu layar

Status: Diterima · 2026-11-03

## Konteks

Uji strategi punya dua tab untuk satu pekerjaan: **Indikator saya** (memilih indikator, melihat hasil uji terakhirnya, mengelolanya) dan **Uji indikator** (form uji di kiri, riwayat uji di bawahnya, hasil di kanan). Pemilik produk menemukan tiga masalah:
- Memilih indikator di satu tab lalu mengujinya di tab lain berarti pindah tab dan memilih indikator yang sama dua kali.
- Kartu **Uji baru** dan kartu **Riwayat uji** bertumpuk di kolom kiri, jadi riwayat baru terlihat setelah menggulir melewati form. Uji lama hanya bisa dihapus setelah dibuka.
- Tidak ada cara melihat indikator di chart sebuah aset tanpa meninggalkan Uji strategi dan menyalakannya di chart Pasar.

Kanvas desain memberi dua usulan. Pemilik memilih usulan A: satu tab, tiga kolom.

## Keputusan

- **Indikator saya dan Uji indikator menjadi satu tab, Indikator** (`IndicatorsView`). Kuncinya tetap `lab`; tautan lama `#/uji?dock=library` dibuka di tab ini lalu ditulis ulang. Jalur Uji strategi menjadi Indikator → Rekam jejak live, dengan Uji saran AI terpisah di ujung.
- **Kiri: daftar indikator** (`IndicatorList`). Isinya kotak cari, menu Indikator baru, lalu kelompok Bawaan, Dari admin, dan Buatan saya. Mesin yang hanya bisa diuji (Donchian) ikut di Bawaan dengan keterangan "Hanya untuk uji".
- **Tengah: indikator yang dipilih**, dengan sakelar Tampil di chart (untuk chart Pasar dan Riset AI) dan dua tab:
  - **Detail indikator**: hasil uji terbaru, atau uji yang dibuka dari Riwayat (`LabResult`), lalu Sinyal nyata (rekam jejak live dan notifikasi) dan Kelola (edit dan hapus skrip sendiri).
  - **Chart pasar** (`IndicatorChart`): chart aplikasi yang hanya menggambar indikator itu (`DecisionChart`, prop `only`), di aset yang sedang fokus. Aset diganti lewat chip (aset terakhir dibuka dan aset di form uji) atau pencari aset, tanpa meninggalkan halaman. Mesin yang hanya digambar di sebagian timeframe menyebutnya, dengan tombol untuk pindah.
- **Kanan: satu kartu Uji dengan dua tab** (`LabCard`):
  - **Uji baru** menguji indikator yang dipilih dalam dua langkah: aset, lalu waktu.
  - **Riwayat** menampilkan uji indikator ini atau semua uji. Tiap baris punya tombol hapus sendiri, dan hapusnya bisa diurungkan beberapa detik. Karena ada Urungkan, hapus tidak memakai dialog konfirmasi.
- **Indikator yang dipilih adalah strategi form uji** (`lab.strategy`). Tautan dari Rekam jejak live, "Ubah dan uji ulang", dan kartu Uji jadi selalu sepakat soal indikatornya, tanpa state pilihan kedua.
- **Lebar layar:**
  - Mulai 80rem, tiga kolom berdampingan.
  - Antara 64 dan 80rem, kartu Uji turun ke bawah daftar.
  - Di ponsel, daftar tampil dulu, lalu indikatornya dengan tiga tab: Detail, Chart pasar, dan Uji.

## Konsekuensi

- Memilih, melihat di chart, dan menguji indikator terjadi di satu layar. Hasil uji yang baru selesai langsung tampil di tab Detail indikator yang sedang dibaca.
- `DecisionChart` punya prop baru `only`. Chart Pasar dan Riset AI tidak memakainya, jadi tidak berubah.
- Uji dari skrip yang sudah dihapus tetap bisa dibuka dari Riwayat (Semua), di bawah nama lamanya.
- Chart pasar tidak menghitung biaya dan tidak memisahkan data uji. Halaman menyebutnya, dan menunjuk kartu Uji untuk angka yang bisa dipercaya.
- **Alternatif yang ditolak:**
  - **Usulan B, uji sebagai tab ketiga:** dua kolom, dengan Detail, Chart pasar, dan Uji di satu baris tab. Lebih lega di layar 1280 px, tetapi form uji dan chart tidak pernah terlihat bersamaan, dan uji menjadi tab di dalam tab.
