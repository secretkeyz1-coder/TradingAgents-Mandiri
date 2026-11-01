# 0012. Aktivitas member: menit aktif dari detak halaman, tindakan dari server, disimpan 90 hari

Status: Diterima · 2026-11-02

## Konteks

Admin ingin melihat apa yang dilakukan member, kapan mereka online, dan kebiasaan mereka memakai aplikasi. Sampai sekarang server hanya tahu hasil kerja yang tersimpan (analisa, notifikasi, skrip), bukan kapan dan berapa lama aplikasi dipakai. Pemilik produk memilih cakupan inti dengan masa simpan 90 hari, diumumkan di Kebijakan Privasi.

## Keputusan

- Waktu aktif dihitung per menit. Halaman mengirim detak tiap 30 detik (`POST /api/activity`) hanya selama tabnya ada di depan dan ada klik, sentuhan, atau ketikan dalam 5 menit terakhir, berisi layar, tab, dan simbol chart yang terbuka. Server menyimpan satu baris per akun per menit (`activity_minutes`, indeks unik pada akun dan menit; detak berikutnya di menit yang sama hanya mengganti tempatnya). Detak dua kali per menit membuat menit yang dipakai tidak terlewat karena jeda timer, dan indeks unik membuat detak berlebih tidak menambah waktu.
- Tindakan dicatat server di rute tempat tindakan itu terjadi (`activity_events` lewat `track`), bukan dilaporkan halaman: masuk, analisa AI, backtest, pesan ke agent chart, uji Lab, notifikasi baru, simbol ke analisa harian, skrip baru. Yang dicatat server tidak bisa hilang karena pemblokir atau dipalsukan dari browser, dan tidak menambah permintaan.
- Akun admin tidak dicatat, supaya angkanya hanya tentang member.
- Online berarti ada menit dalam 3 menit terakhir; sesi adalah rangkaian menit dengan jeda tidak lebih dari 15 menit. Hari dan jam dihitung dalam WIB, dan periode dimulai tengah malam WIB.
- Baris lebih dari 90 hari dihapus tiap hari oleh instance pemimpin penjadwal (`startActivityPruning`).
- Pencatatan (`activity.ts`) terpisah dari pembacaan (`analytics.ts`): modul fitur mengimpor `track` tanpa ikut mengimpor rute admin, sehingga `auth.ts` bisa mencatat masuk tanpa impor melingkar.

## Konsekuensi

- Halaman admin bisa menjawab siapa yang online, berapa member aktif per hari, jam ramai dalam seminggu, layar dan fitur yang dipakai, aset yang paling lama dibuka, serta sesi dan riwayat tindakan tiap member.
- Satu member yang memakai aplikasi sepanjang hari menghasilkan paling banyak 1.440 baris per hari; dengan masa simpan 90 hari tabelnya tetap kecil untuk jumlah member sekarang.
- Waktu yang dihitung adalah waktu dipakai, bukan waktu tab terbuka: tab yang dibiarkan di belakang atau tanpa sentuhan tidak dihitung. Membaca chart lebih dari 5 menit tanpa menggerakkan pointer juga tidak dihitung.
- Simbol dicatat hanya di layar chart dan mode Pemula, supaya "aset yang paling lama dibuka" tidak ikut menghitung waktu di Beranda atau Pantau.
- Kebijakan Privasi menyebut data ini, tujuannya, siapa yang melihatnya (admin), dan masa simpannya.
- Alternatif yang ditolak: layanan analitik pihak ketiga (data member keluar ke pihak lain dan butuh persetujuan cookie), mencatat setiap klik (data jauh lebih banyak tanpa menjawab pertanyaan admin dengan lebih baik), dan menghitung lama tab terbuka (tab yang lupa ditutup terhitung berjam-jam).
