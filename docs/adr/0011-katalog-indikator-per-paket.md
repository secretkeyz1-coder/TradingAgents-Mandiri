# 0011. Katalog indikator: akses per paket dan per akun, diatur admin

Status: Diterima · 2026-11-02

## Konteks

Indikator chart (Scalper Pro+, PoB BYSTRA, Fib GZ) terbuka untuk semua akun, dan paket hanya membedakan kapasitas. Pemilik produk ingin admin bisa mengatur indikator mana yang muncul untuk paket langganan apa dan untuk pengguna mana, menentukan mana yang langsung menyala, membuat indikator baru, dan mengelolanya, tanpa rilis ulang setiap kali keputusan itu berubah.

## Keputusan

- Ada katalog indikator di database (`indicators`, migrasi 0026). Tiap baris punya paket yang boleh memakainya (`plans`), tanda aktif, tanda langsung menyala (`default_on`), dan urutan. Akses per akun disimpan di `indicator_grants` dan menambah, tidak mengurangi, apa yang dibuka paket. Migrasi mengisi tiga mesin bawaan terbuka untuk semua paket dan mati sampai dinyalakan, sama dengan perilaku sebelumnya.
- Kunci indikator tetap satu bentuk di semua tempat: nama mesin untuk bawaan (`pob`, `scalper`, `fib`), `catalog:<id>` untuk skrip yang diterbitkan admin, `script:<id>` untuk skrip milik anggota (tidak diatur katalog).
- Satu aturan akses (`usableKeys` di `web/server/src/indicators.ts`): admin melihat semuanya, termasuk yang nonaktif, untuk mencoba; anggota melihat baris aktif yang paketnya cocok dengan paket yang berlaku (`planOf`) atau yang diberikan ke akunnya.
- Aturan itu ditegakkan di setiap tempat indikator dipakai: daftar menu chart (`GET /api/indicators`), pilihan dan pembuatan notifikasi sinyal (`GET`/`POST /api/alerts`, 403 bila tidak boleh), pemindaian sinyal, dan Lab (`GET /api/lab`, `POST /api/lab/run`). Pemindaian melewati alert yang indikatornya tidak lagi terbuka sebelum menghitung batas paket, jadi alert itu dijeda tanpa memakan jatah dan berjalan lagi bila dibuka kembali, seperti paket yang habis masa berlakunya.
- Indikator baru dibuat admin dari skrip (bahasa yang sama dengan Skrip saya). Kodenya disalin ke katalog, sehingga semua anggota menjalankan versi yang sama dan perubahan skrip asal tidak ikut. Grafik menjalankannya di sandbox browser; notifikasinya dijalankan server di sandbox yang sama, sekali per pasangan untuk semua yang memantaunya, dan pesannya memakai nama indikator itu.
- Mesin bawaan tidak bisa dihapus, diganti namanya, atau diubah kodenya dari konsol (mesinnya ada di kode dan namanya dipakai di pesan sinyal dan halaman publik); untuk menyembunyikannya, admin mematikannya. Menghapus indikator skrip ikut menghapus notifikasi yang memakainya, sementara riwayat call-nya tetap di Beranda pemiliknya; penghapusan ditolak selama ada sinyal publik creator yang masih berjalan.
- Halaman harga membaca `GET /api/public/indicators` (nama, penjelasan, dan paket dari indikator aktif yang terbuka untuk minimal satu paket, tanpa kode), jadi halaman itu tidak pernah menjanjikan yang tidak ditampilkan aplikasi.

## Konsekuensi

- Paket kini bisa berbeda dalam indikator, bukan hanya kapasitas. Teks situs tidak lagi menyebut semua alat sama di semua paket; tabel di halaman harga menunjukkan keadaan sebenarnya.
- Kode indikator skrip terlihat di browser anggota yang boleh memakainya, karena grafik menjalankannya di sana. Yang tidak boleh memakainya tidak pernah menerimanya.
- Akun yang belum pernah memilih indikator mendapat indikator yang ditandai langsung menyala; setelah anggota mengubah pilihannya, pilihannya yang dipakai.
- Pemindaian sinyal membaca katalog dan akses per akun dengan dua query tambahan per putaran.
- Agen chart dan buku catatan sinyal publik tetap memakai semua mesin bawaan: keduanya bukan menu indikator anggota.
- Alternatif yang ditolak: fitur per paket yang ditulis di `shared/plans.ts` (setiap perubahan butuh rilis), dan akses per akun saja (admin harus mengatur setiap anggota satu per satu).
