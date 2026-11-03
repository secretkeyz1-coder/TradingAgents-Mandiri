# 0022. Merek TraderMedan, arah "Horas"

Status: Diterima · 2026-11-03

## Konteks

Aplikasi web selama ini memakai nama engine-nya, TradingAgents, dengan tema "Cobalt" dari audit desain 29 Oktober: tinta biru dingin, sinyal cobalt, dan huruf Geist. Nama itu milik engine riset Python yang dipakai aplikasi, bukan nama produknya, dan tampilannya tidak punya ciri sendiri.

Pemilik produk memutuskan merek sendiri:
- **Nama:** TraderMedan, satu kata dengan M besar, sama dengan domain tradermedan.com.
- **Cakupan:** identitas baru penuh (nama, logo, warna, huruf), dirancang di kanvas dulu, lalu dibangun.

Kanvas memberi tiga arah, dan pemilik memilih **B · Horas**: tinta dan jingga dengan latar tulang, huruf Bricolage Grotesque dan Archivo, logo belah ketupat dengan huruf M, dan pita segitiga seperti ukiran dan tenun Batak.

## Keputusan

- **Nama.** Semua yang dibaca anggota menyebut TraderMedan: halaman publik, aplikasi, email, tagihan, pesan Telegram, dan judul referensi API. Engine Python, repo, paket, dan pengenal internal (misalnya kanal antar-tab `tradingagents-tabs`) tetap bernama TradingAgents.
- **Satu sumber.** `shared/brand.ts` memuat `BRAND.name`, `BRAND.wordmark` (`["Trader", "Medan"]`), dan `MARK` (path logo).
  - Semua yang menggambar logo membaca dari sana: `Logo.svelte`, `Wordmark.svelte`, serta header dan footer situs (`client/site/partials.ts`).
  - `client/public/favicon.svg` menyalin path yang sama, karena berkas statis tidak bisa membaca variabel CSS.
- **Logo dan wordmark.**
  - Logo: belah ketupat jingga dengan M hitam satu goresan, di kotak 64 satuan. Warnanya sama di latar terang dan gelap.
  - Wordmark: Bricolage Grotesque 800, rapat (−0,02em), dengan "Medan" dalam warna accent.
- **Warna.** Tema daisyUI `horas` (terang, bawaan) dan `horas-dark` (gelap, mengikuti perangkat), di `client/src/app.css`, dalam notasi oklch:
  - **Tinta Toba #121212:** teks di tema terang, latar di tema gelap.
  - **Jingga Horas #FF6A13:** `primary` di semua halaman dan kedua tema, selalu dengan teks tinta (6,5:1). Satu aksi utama per area tetap aturannya.
  - **Jingga tua:** `accent`, jingga yang dibaca sebagai teks dan garis.
    - Di tema terang nilainya oklch(53,5% 0,165 43,7), sekitar #B74200, dengan kontras 4,75:1 di tulang. #C2410C dari kanvas hanya 4,4:1 di tulang dan berjarak 11° dari merah rugi; versi ini memakai hue jingga Horas sendiri, 17° dari merah.
    - Di tema gelap nilainya jingga Horas itu sendiri (6,2:1 di kartu).
  - **Tulang #F2EDE4:** latar terang, dengan #FBF8F3 untuk kartu dan #DCD3C4 untuk garis.
  - **Batu #5F5B55:** `secondary`, teks kedua.
  - **Warna makna tidak berubah:** hijau untung, merah rugi, dan kuning peringatan. Biru info diredam (oklch 48% 0,08 245) supaya tidak bersaing dengan jingga. Jingga hanya untuk merek dan aksi utama.
- **Keadaan terpilih.**
  - Layar yang sedang dibuka di bilah atas tampil sebagai tab terisi: tinta di tema terang, jingga di tema gelap, seperti di kanvas.
  - Tombol polos yang aktif (segmen terpilih, menu yang terbuka) menjadi tab terisi tinta di tema terang dan tulang di tema gelap. daisyUI hanya menggelapkannya 7%, yang tidak terlihat di latar tinta.
- **Huruf.**
  - Bricolage Grotesque, dengan sumbu ukuran optik, untuk h1 sampai h3 dan wordmark. Judul halaman memakai bobot 800.
  - Archivo untuk teks, tombol, dan angka (angka tabular).
  - Geist Mono tetap untuk kode.
  - Ketiganya dipasang dari paket fontsource, tanpa CDN.
- **Bentuk.** Sudut 6px untuk kontrol dan 8px untuk kotak. Tombol di situs publik tidak lagi berbentuk pil.
- **Hiasan.** Pita segitiga jingga dipakai hemat: sekali, di atas footer setiap halaman publik.
- **Halaman depan.** Judul dibatasi 6rem dengan bobot 800, dan cahaya fajar di belakang lanskap pasar kini jingga, karena mengikuti token accent.
- **Email dan tagihan** memakai palet yang sama: teks tinta, tombol jingga dengan teks tinta, dan wordmark sebagai tanda tangan.

## Akibat

- Tema `cobalt` dan `cobalt-dark` hilang. Halaman yang memaksa tema (landing) memakai `data-theme="horas-dark"`.
- Teks atau garis berwarna jingga harus memakai `accent`, bukan `primary`, karena jingga terang hanya 2,5:1 di tulang. Ada empat tempat yang dipindah:
  - "Ganti" di Jurnal;
  - kurva Jurnal;
  - titik muat kartu Saran AI;
  - teks lencana aset yang dipantau.
- Pindah ke tradermedan.com dan pengalihan domain lama dikerjakan terpisah di server (reverse proxy, TLS, `PUBLIC_URL`), masing-masing dengan persetujuan pemilik.
- Nama tampilan bot Telegram dan nama pengirim email diatur di BotFather dan di `.env`, bukan di kode, jadi diganti pemilik.
