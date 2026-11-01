# 0010. Navigasi lima layar menggantikan workspace satu layar

Status: Diterima · 2026-11-02

## Konteks

Mode Pro dulu satu layar: chart di tengah, panel Pasar, AI, dan panel bawah di sekelilingnya, plus rail di kiri yang membuka dan menutup panel itu. Rail tidak memindahkan pengguna ke tempat lain; ia hanya mengulang panel yang sudah punya judul dan tab sendiri, dan pengguna merasakannya sebagai tombol yang berlebihan. Layar yang sama juga menampung pekerjaan yang berbeda sifatnya (memantau pasar, meriset dengan AI, mengelola yang dipantau, menguji strategi), dan belum ada tempat untuk melihat bagaimana sinyal pengguna sendiri bekerja.

## Keputusan

- Mode Pro punya lima layar, dipilih dari menu di bilah atas (di ponsel dari tab bawah): Beranda, Pasar, Riset AI, Pantau, dan Uji strategi (`SCREENS` di `web/client/src/lib/stores/workspace.svelte.ts`). Rail dihapus.
- Layar adalah bagian URL (`#/pasar?s=…`), jadi Back berpindah antar layar dan tautan bisa dibagikan. Tautan dari sebelum layar ada (`#/?s=…&run=…`, termasuk yang sudah terkirim di Telegram dan email) dibuka di layar yang sekarang memuat isinya.
- Pasar dan Riset AI adalah layar chart: panel-panelnya (daftar harga di Pasar, panel Riset AI, panel bawah di keduanya) tetap bisa menempel, melayang, atau ditutup, dan menu Tata letak berlaku untuk panel yang dimiliki layar itu. Pantau dan Uji strategi adalah halaman bertab. Beranda adalah dashboard sinyal pengguna.
- Riwayat sinyal untuk Beranda tidak boleh hilang saat notifikasinya dihapus: `signal_events` membawa pemilik dan pasangannya sendiri, dan kuncinya ke `signal_alerts` menjadi `ON DELETE SET NULL` (migrasi 0025).

## Konsekuensi

- Chart tidak lagi selalu terlihat. Memilih simbol dari daftar di Beranda, Pantau, atau Uji strategi membuka chart-nya di Pasar; dari Riset AI, chart Riset AI.
- Panel Pasar dan panel Riset AI tidak pernah tampil bersama lagi, jadi laci Pasar untuk layar sedang tidak diperlukan.
- Mode fokus hanya ada di layar chart.
- Alternatif yang ditolak: sidebar kiri dengan lima menu (memakan lebar yang dibutuhkan chart), dan mempertahankan satu layar dengan rail yang hanya diganti namanya (masalah intinya tetap: rail mengulang panel).
