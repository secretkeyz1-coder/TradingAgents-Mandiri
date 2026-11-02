# 0014. Jurnal trading: ditutup dari candle 15m notifikasi harga, SL didahulukan, hasil dalam R

Status: Diterima · 2026-11-02

## Konteks

Trader jarang mencatat trade yang mereka ambil. Akibatnya mereka tidak tahu setup dan suasana hati mana yang menghasilkan, dan jurnal yang harus ditutup dengan tangan berhenti diisi setelah beberapa hari. Aplikasi sudah membaca candle 15m tiap menit untuk notifikasi harga (`price-alerts.ts`), dari sumber yang sama dengan chart: kripto dan emas real-time dari Binance atau bursa pilihan, aset lain dari Yahoo dengan tunda.

## Keputusan

- Trade dicatat di tabel `journal_trades` (migrasi 0029), dari tombol Saya ambil di kartu Rencana trading atau diisi sendiri. Isinya arah, entry, SL, TP, sumber, perasaan, catatan, dan uang yang dipertaruhkan bila ukuran posisi ikut. Saat dicatat, trade dipasang pada candle 15m terbaru (`armed_bar`).
- Pencatatan ditolak kalau SL dan TP tidak di sisi yang benar dari entry, atau harga sekarang sudah melewati salah satunya: yang dicatat harus trade yang masih berjalan.
- Tiap menit, setelah notifikasi harga, `settleJournal` membaca candle yang sama lewat `quotes`, satu kali per simbol dan bursa. Trade selesai kalau high atau low candle yang dibuka setelah `armed_bar`, atau harga terbaru, menyentuh SL atau TP.
- **Candle yang menyentuh keduanya dihitung kena SL.** Urutan harga di dalam satu candle tidak diketahui, dan yang dipilih adalah tafsiran yang tidak membuat hasil terlihat lebih bagus.
- Harga keluar adalah levelnya sendiri. Hasil dicatat dalam R: TP memberi jarak TP dibagi jarak SL, SL memberi −1R. Trade yang ditutup sendiri dihitung dari harga yang diisi, dan trade "tidak jadi" tidak dihitung.
- Menutup trade adalah satu update bersyarat (`… where status = 'open' returning`). Hanya satu instance yang menutup dan mengirim pesan, dan penutupan oleh pemilik tidak bisa bertabrakan dengan penutupan otomatis.
- Trade berjalan sekaligus dibatasi paket (`journal` di `shared/plans.ts`), karena pemeriksa harga mengikuti semuanya.
- Rekap mingguan dikirim mulai Minggu pukul 19.00 WIB dan mencakup Senin 00.00 WIB sampai saat itu. Penerimanya member dengan Telegram terhubung yang mencatat atau menutup trade pekan itu. Klaimnya ditulis di `notices` (akun, `journal-recap:<minggu ISO>`) sebelum dikirim, jadi rekap terkirim sekali walau ada dua instance atau server dimulai ulang.

## Konsekuensi

- Jurnal terisi hasilnya sendiri tanpa member membuka aplikasi, dan rekap mingguan menunjukkan pola seperti "trade saat FOMO rata-rata −0,8R".
- Hasilnya konservatif, tetapi bukan eksekusi broker:
  - Harga yang gap melewati SL tetap dicatat −1R, padahal di broker bisa rugi lebih.
  - Slippage dan biaya tidak dihitung.
  - Aset dari Yahoo tertunda, jadi penutupannya bisa terlambat beberapa menit sampai puluhan menit.
- Sentuhan singkat di antara dua pemeriksaan tetap terhitung lewat high dan low, sedangkan gerakan sebelum trade dicatat tidak pernah menutupnya.
- Alternatif yang ditolak:
  - **Hanya harga terakhir:** sentuhan singkat di TP atau SL terlewat.
  - **Ditutup member sendiri:** kebanyakan tidak pernah menutupnya.
  - **Data tick:** tidak tersedia gratis untuk semua pasar yang dipakai.
