# TradingAgents Web

Aplikasi web untuk menjalankan analisa TradingAgents dari browser: isi form, pantau progres tiap agent secara live, lalu baca laporan dan keputusan akhirnya. Riwayat analisa tersimpan di Postgres.

```
Browser (Svelte 5 + daisyUI)
   │  HTTP + Server-Sent Events
   ▼
Bun + Hono  ── Drizzle ──►  PostgreSQL (Docker, port 5590)
   │  spawn per analisa, JSON lines di stdout
   ▼
web/worker/ta_worker.py  →  engine tradingagents (Python, .venv repo)
```

| Folder | Isi |
| --- | --- |
| `client/` | Frontend Svelte 5 + Vite, Tailwind 4 + daisyUI 5 |
| `server/` | API Bun + Hono, skema dan migrasi Drizzle, antrean job, SSE |
| `worker/` | Jembatan ke engine Python (`ta_worker.py`) dan worker demo tanpa LLM (`demo_worker.py`) |

## Lima layar

Mode Pro punya lima layar, dipilih dari menu di bilah atas (di ponsel dari tab bawah): **Beranda**, **Pasar**, **Riset AI**, **Pantau**, dan **Uji strategi** (`SCREENS` di `stores/workspace.svelte.ts`, lihat [ADR 0010](../docs/adr/0010-navigasi-lima-layar.md)). Semuanya berbagi **simbol aktif**: ganti simbol (kotak pencarian Ctrl/⌘ K, daftar Pasar, atau klik di widget TradingView) dan chart serta panelnya ikut berganti. Memilih simbol dari daftar di layar tanpa chart membuka chart-nya di Pasar. Kotak pencarian menerima nama aset (Emas, Bitcoin, Bank Central Asia) selain kode (BBCA, BBCA.JK, IDX:BBCA, BTC-USD), dan menyarankan aset dari daftar Pasar saat mengetik. Nama yang dipakai beberapa aset (mis. "bank") meminta pilihan dari saran.

| Layar | Isi |
| --- | --- |
| Beranda | Ringkasan hari ini di atas: pasar utama (IHSG, emas, Bitcoin, USD/IDR, S&P 500) dengan perubahan hari ini dan garis sebulan, apa yang terjadi sejak terakhir buka (sinyal baru, alert harga yang kena, analisa yang selesai; dari menit aktivitas), Pantauanku dengan harga live dan keputusan AI terakhir, dan ringkasan pasar AI. Di bawahnya kinerja sinyalmu: call dari notifikasi sinyal dan hasilnya untuk 7 hari sampai 1 tahun (jumlah call, TP, SL, rasio menang, total R, R kumulatif per hari, per indikator, per aset, riwayat call yang bisa disaring), lalu yang berjalan sekarang, kuota hari ini, analisa terjadwal, dan alert harga |
| Pasar | Daftar harga per pasar (IDX, US, Crypto, Forex, Komoditas) di kiri, dengan harga terakhir dan perubahan hari ini dari `GET /api/quotes` (data harian yang sama dengan chart), chart di tengah ("Keputusan AI", bawaan sejak November 2026: harga terakhir dan perubahan hari ini, candle + marker setiap keputusan, dengan Indikator dan Notifikasi, dan kartu Rencana trading: setup indikator terbaru yang masih terbuka sebagai entry, SL, TP, dan R:R, kalkulator ukuran posisi dari modal dan risiko per trade (lot IDX, oz emas, unit kripto), alert harga di ketiga level sekali tekan, dan salin rencana; atau TradingView), Screener di panel bawah |
| Riset AI | Chart simbol aktif, panel **Tanya** (agent chart) dan **Jalankan** (analisa yang terbuka, keputusan terakhir, form analisa) di kanan, dan Riwayat, Laporan, Log di panel bawah |
| Pantau | Hanya yang kamu pantau: Analisa terjadwal dan Alert (semua alert harga dan sinyal) |
| Uji strategi | Backtest (form, daftar, hasil), Lab, dan Strategi live (buku sinyal strategi bawaan) |

Di Pasar dan Riset AI tiap panel bisa menempel, melayang di atas chart, atau ditutup (tombol × di kepalanya; tombolnya menunggu di pojok chart sampai dibuka lagi), dan menu Tata letak menyimpan susunannya. Mode fokus (tombol F) memberi chart seluruh jendela. Tiap layar ingat tab terakhirnya.

Lebar ≥ 1024 px: layar penuh dengan menu atas. < 1024 px: satu kolom per layar dengan tab bawah, dan tab di dalam layar menjajarkan semua isinya dalam satu baris, mis. Riset AI: Chart · Tanya · Jalankan · Riwayat · Laporan · Log (`PhoneScreen.svelte`).

**Status di URL** — `#/riset?s=IDX:BBCA&run=<id>&dock=log&tf=4h&ai=chat` (layar, simbol, analisa dan backtest terbuka, tab, pasar, chart), jadi link bisa dibagikan dan tombol Back berpindah antar layar. Link lama (`#/?s=…&run=…` dari pesan Telegram dan email, `#/analyses/:id`, `#/backtests/:id`, `#/chart?symbol=…`, `#/markets?tab=…`, `#/?ticker=…`, `ai=backtest`) dibuka di layar yang sekarang memuat isinya.

### Mode Pemula dan Pro

Sakelar **Pemula | Pro** ada di bilah atas.

- **Pemula** menampilkan satu aset dengan bahasa sederhana:
  - **Pantauanku**: watchlist, dengan saran AI terakhir tiap aset. Kalau masih kosong, tampil aset populer.
  - **Aset**: nama, harga terakhir dan perubahan hari ini, grafik area 1 hari sampai 1 tahun, kartu **Saran AI**, dan kartu **Kabari saya** (sakelar ringkasan AI harian, yang sekaligus memasukkan aset ke Pantauanku; notifikasi harga; dan status Telegram).
  - **Tanya AI**: chat agent tanpa nama tool, memori, dan skill.

  Mulai 1024 px tampil tiga kolom; di bawahnya, tiga tab bawah.
- **Pro** adalah workspace lengkap di atas.

Akun baru (daftar lewat email, Google, atau dibuat admin sebagai anggota) mulai di Pemula. Akun lama dan admin mulai di Pro. Pilihan disimpan di preferensi akun (`ui.mode`), jadi ikut ke perangkat lain, dan simbol aktif tidak berubah saat pindah mode.

**Saran AI** (`GET /api/verdict`) mengambil sumber dengan urutan ini:
1. Keputusan analisa terakhirmu untuk aset itu, dengan tanggal trading terbaru.
2. Ringkasan pasar AI harian, untuk aset yang dicakupnya (BTC, ETH, Emas, IHSG).
3. Kalau keduanya tidak ada, tombol **Minta saran AI** menjalankan analisa standar dengan jatah analisa harian: semua analis yang relevan, kedalaman 1, bahasa Indonesia, dan model server.

Rating diterjemahkan ke bahasa awam: Buy = Beli, Overweight = Cenderung beli, Hold = Tunggu dulu, Underweight = Cenderung jual, Sell = Jual.

### Agent chart (tab "Tanya" di Riset AI)

Chat per simbol dengan agent yang membaca pasar lewat skill, menggambar di chart "Keputusan AI", dan mengingat preferensi.

Jawaban soal pasar dibuka dengan ringkasan 2–3 baris dalam bahasa awam: ke mana harga condong dan kenapa, area harga yang perlu dipantau, dan level yang membatalkan pandangan itu. Rinciannya menyusul. Permintaan yang bukan soal pasar (menggambar, memori, skill) cukup dikonfirmasi satu baris.

- **Skill analisa** (dihitung pandas di `worker/chart_agent.py`, bukan dikarang model): `get_market_summary`, `find_pivots`, `support_resistance`, `fit_trendline`, `fibonacci`, `indicators`, `latest_decisions` (memory log engine).
- **Skill gambar**: `draw_level`, `draw_trendline`, `draw_zone`, `draw_box` (kotak dari candle ke candle, bisa memanjang ke kanan, teks dan rentang harganya di tepi kanan; tepi kotak tidak lagi diberi label di sumbu harga supaya tidak menumpuk), `draw_label` (label penunjuk di harga), `draw_fib`, `draw_trade_plan`, `annotate`. Minta saja "buatkan kotak supply demand" atau "kotak dari 27 Okt 09:00 sampai 28 Okt antara 4000 dan 4060": agent memakai `supply_demand_zones` (zona supply/demand 15m, 1j, harian, termasuk yang flipped) lalu menggambar kotaknya di timeframe chart yang sedang dibuka. Setiap harga dan tanggal dicek terhadap riwayat harga nyata; yang di luar rentang ditolak dan agent diberi tahu alasannya.
- **Memori**: `remember` / `forget`, cakupan pengguna atau simbol. Terlihat dan bisa dihapus di tombol "Memori" pada chat.
- **Sesi**: tersimpan di Postgres; 16 giliran terakhir dikirim apa adanya, giliran lebih lama diringkas otomatis ke ringkasan sesi.
- **Kecepatan**: setiap giliran dimulai dengan ringkasan pasar, indikator, dan S/R terdekat (126 hari) yang sudah dihitung tool, jadi pertanyaan harga/RSI/level terdekat tidak butuh putaran tool. Waktu sisanya hampir seluruhnya panggilan model (diukur ±7 detik per panggilan untuk Gemini 3.8 Flash *high*, ±4,4 detik untuk *low*), dan jawaban dialirkan per potongan bila provider men-stream.
- **Model**: memakai provider dan model deep yang dipilih di Pengaturan form Analisa. Pilihan itu disimpan di browser (`localStorage` `tradingagents.form`) begitu sebuah kolom berubah, tanpa harus menjalankan analisa dulu. Browser yang belum menyimpan apa-apa memakai default server dari `TRADINGAGENTS_LLM_PROVIDER`, `TRADINGAGENTS_QUICK_THINK_LLM`, `TRADINGAGENTS_DEEP_THINK_LLM`, dan `TRADINGAGENTS_LLM_BACKEND_URL` di `.env`. URL itu hanya dipakai untuk provider default dan diisi server sendiri; provider lain tetap ke endpoint masing-masing. Butuh model yang andal untuk tool calling.
- **Layer**: tombol S/R · Trend · Zona · Fib · Rencana · Catatan di bawah chart AI, plus "Hapus gambar".
- Mode demo (`bun run dev:demo`) memakai skill asli dengan model berskenario, jadi alur chat bisa dicoba tanpa API key.
- Candle chart kini memakai harga disesuaikan (adjclose), sama dengan engine, agar gambar agent dan marker backtest jatuh di seri yang sama.

API: `GET/POST /api/agent/sessions`, `GET/DELETE /api/agent/sessions/:id`, `POST /api/agent/sessions/:id/messages` (stream SSE), `GET /api/agent/memories`, `DELETE /api/agent/memories/:id`, `GET /api/drawings?symbol=`, `DELETE /api/drawings/:id`, `DELETE /api/drawings?symbol=`, `GET /api/agent/skills`, `POST /api/agent/skills/:id/{approve|reject|disable|enable|restore}`, `DELETE /api/agent/skills/by-name/:name`.

#### Skill buatan agent (resep)

Minta agent "simpan cara ini sebagai skill" dan ia memanggil `propose_skill`. Sebuah skill adalah **data, bukan kode**: 1–6 langkah yang memanggil skill analisa di atas (dengan parameter `$nama`), plus instruksi tentang apa yang disimpulkan dan digambar. Angka tetap datang dari tool, jadi skill tidak bisa mengarang harga.

1. **Usul**: definisi divalidasi (nama, batas panjang, tool yang diizinkan, argumen dicek terhadap tanda tangan fungsinya), lalu langsung diuji di harga nyata simbol yang sedang dibuka. Hasilnya disimpan sebagai draf beserta hasil uji.
2. **Tinjau**: tombol "Skill" di chat memberi tanda "n baru". Di panel itu kamu melihat langkah, parameter, instruksi, dan hasil uji, lalu **Setujui** atau **Tolak**. Draf yang ujinya gagal tidak bisa disetujui.
3. **Pakai**: hanya skill aktif yang masuk ke prompt agent, dan `use_skill` menolak skill lain. Agent menjalankan langkahnya lalu menggambar dengan tool `draw_*` biasa.
4. **Versi**: usulan baru dengan nama yang sama menjadi versi berikutnya. Menyetujuinya mengarsipkan versi aktif sebelumnya; **Pulihkan** di daftar versi mengaktifkan versi lama lagi. **Nonaktifkan** mematikan skill tanpa menghapusnya, dan **Hapus** membuang semua versinya.

Di mode demo, pesan yang memuat "skill" membuat agent mengusulkan `sr-ringkas`, dan "pakai skill" menjalankan skill aktif pertama.

**Struktur kode (orkestrasi)** — panel tidak saling memanggil; semuanya membaca dan mengubah store bersama:

```
client/src/lib/
├─ stores/
│  ├─ workspace.svelte.ts   layar, simbol aktif, run/backtest terbuka, tab tiap layar; sinkron ke URL
│  ├─ run.svelte.ts         satu analisa: status + stream SSE (log, laporan, progres agent)
│  ├─ backtest.svelte.ts    satu backtest: status + stream progres
│  ├─ jobs.svelte.ts        riwayat analisa dan backtest (polling saat ada yang berjalan)
│  ├─ agent.svelte.ts       agent chart: sesi, gambar, memori, skill
│  ├─ catalog.svelte.ts     opsi provider/model dari engine
│  └─ viewport.svelte.ts    layout lebar/sedang/sempit
└─ workspace/
   ├─ WorkspaceShell.svelte menata layar yang terbuka; menu atas ada di AppShell, tab bawah ponsel di sini
   ├─ DashboardScreen.svelte Beranda (ResultCurve.svelte: R kumulatif)
   ├─ PageScreen.svelte     Pantau dan Uji strategi; PhoneScreen.svelte: Pasar dan Riset AI di ponsel
   ├─ MarketPanel · ChartPanel · AiPanel · Dock (panel bawah) · TabView (isi satu tab)
   ├─ ChatPanel.svelte      chat agent; SkillsPanel.svelte untuk meninjau skill
   ├─ AnalysisForm.svelte   form analisa (Riset AI) dan backtest (Uji strategi)
   └─ dock/  HistoryView · ReportView · LogView · WatchView · SignalsView · AlertsView · BacktestView · LabView
```

### Backtest dan marker keputusan

Backtest memakai `tradingagents.backtest.run_backtest` milik engine: tim agent dijalankan penuh di setiap (ticker, tanggal), lalu tiap keputusan dinilai dari harga 5 hari bursa sesudahnya dibanding benchmark, dan dirangkum per rating dengan `summarize`. Satu sel = satu analisa penuh, jadi biayanya sebanyak itu; server membatasi `MAX_BACKTEST_CELLS` (default 40). Sel yang belum lewat 5 hari bursa masih *pending*; tombol "Lanjutkan & nilai ulang" menjalankan backtest yang sama dengan `runId`-nya, melewati sel yang sudah jadi dan menilai yang pending.

- Worker web menambahkan benchmark `.JK` → `^JKSE` (IHSG). Peta benchmark engine tidak punya IDX, sehingga tanpa ini saham IDX dinilai terhadap SPY. Crypto dan forex masih memakai default engine (SPY).
- Chart keputusan (TradingView Lightweight Charts) memakai candle Yahoo dari `GET /api/candles` (cache 15 menit) dan menandai setiap keputusan dari `GET /api/decisions` (analisa selesai + sel backtest). Hasil backtest dinilai dengan alpha engine; analisa tunggal dinilai dari arah harga 5 hari bursa sesudahnya. Hold tidak punya arah, jadi tidak dinilai.
- **Timeframe** 1j · 4j · 1H · 1M · 1B (parameter `interval`: `1h`, `4h`, `1d`, `1wk`, `1mo`; di URL `tf=`). 4j digabung server dari candle 1 jam, sejajar tengah malam zona waktu bursa. Candle per jam hanya tersedia sampai 1 tahun ke belakang (batas Yahoo), jadi rentang 2T/5T mati di sana. Engine, marker keputusan, dan gambar agent tetap harian: di timeframe lain sebuah tanggal ditaruh di candle pertama hari itu, dan "harga 5 hari" dihitung dari penutupan harian (kosong di mingguan/bulanan).
- Chart ini ada di chart Keputusan AI dan di hasil backtest (Uji strategi → Backtest).

### Analisa terjadwal dan Telegram

Klik **Analisa harian** di atas chart untuk memasukkan simbol ke analisa terjadwal (sebanyak batas paket; server menyimpannya sebagai watchlist). Tab **Analisa terjadwal** di Pantau menampilkan jadwal, keputusan terakhir tiap simbol, status Telegram, tombol **Jalankan sekarang**, dan **Kirim tes**.

- Setiap hari `WATCH_DAYS` (default Sen–Jum) pukul `WATCH_TIME` WIB (default 16.30), server menjalankan satu analisa per simbol dengan model default server (`TRADINGAGENTS_*`), analis `WATCH_ANALYSTS`, dan kedalaman `WATCH_DEPTH`. Kalau server baru menyala lebih dari 3 jam setelah jadwal, putaran hari itu tidak dikejar.
- Analisanya analisa biasa: masuk antrean, tampil di Riwayat, dan memakai kuota harian. Simbol yang tidak muat di sisa kuota dilewati dan disebut di pesan.
- Setelah semua selesai, satu pesan berjudul "Analisa harian <tanggal>" dikirim ke Telegram: rating tiap simbol, cuplikan Executive Summary, dan tautan ke laporannya (`PUBLIC_URL`). Server butuh `TELEGRAM_BOT_TOKEN` (dari @BotFather), dan tiap akun mengisi chat ID-nya di Profil → Notifikasi; tanpa itu analisa tetap jalan, hanya tanpa pesan. Watchlist, jadwal, dan pesannya per akun.
- Satu putaran per hari dicatat di tabel `watch_runs`, jadi dua instance server tidak menjalankannya dua kali.

API: `GET /api/watchlist`, `POST /api/watchlist {symbol, tvSymbol}`, `DELETE /api/watchlist/:symbol`, `POST /api/watchlist/run`, `POST /api/watchlist/test`.

### Notifikasi sinyal (Telegram)

Di chart Keputusan AI, tombol **Notifikasi** menyalakan pesan Telegram per simbol untuk PoB BYSTRA (15m, 1j), Scalper Pro+ (15m) dan Fib Golden Zone (15m, 1j, harian), sebanyak batas notifikasi paket (Gratis 3, Pro 15, Creator 50), yang dipakai bersama notifikasi harga. Chat ID boleh ID grup (angka negatif) bila bot dimasukkan ke grup. Memakai bot dan chat ID yang sama dengan analisa terjadwal. Semua notifikasi akun, harga dan sinyal, terkumpul di Pantau → **Alert**, dengan tombol hapus dan sakelar Publik (Creator); yang baru tetap dipasang dari tombol Notifikasi.

Beranda menghitung **call**: sinyal yang keluar live dari notifikasi (terkirim, atau mestinya terkirim bila Telegram belum diatur), bukan riwayat yang dicatat diam-diam saat notifikasi baru dinyalakan. R dihitung dari yang diselesaikan mesin dengan pasti: TP = jarak target dibagi jarak stop, SL = −1; keluar karena kondisi dan kedaluwarsa dihitung sebagai call tetapi tidak masuk R karena harga keluarnya tidak disimpan. Riwayat tetap ada setelah notifikasinya dihapus (sejak migrasi 0025 tiap sinyal membawa pemilik dan pasangannya sendiri); sinyal yang saat itu masih berjalan ditandai "tidak dipantau lagi". API: `GET /api/alerts/history?days=7|30|90|365`.

- Server memindai tiap 5 menit (pasangan 1j tiap 15 menit), satu menit setelah batas slot, lewat perintah worker `signals` yang menjalankan mesin yang sama dengan chart dan agent, hanya pada candle yang sudah tutup.
- Setiap sinyal disimpan sekali per notifikasi (`signal_events`, indeks unik), jadi terkirim sekali walau ada dua instance server. Pesan susulan dikirim saat sinyal kena TP, SL, kedaluwarsa, atau (Scalper) diganti sinyal baru.
- Saat notifikasi dinyalakan, sinyal yang sudah ada dicatat tanpa dikirim. Sinyal yang baru terlihat lebih dari `SIGNAL_STALE_BARS` candle (default 4) setelah muncul, misalnya karena server mati, dicatat tanpa dikirim.
- Scalper Pro+ memakai pengaturan Scalper di chart pemilik notifikasi (tersimpan di akun), hanya input yang mengubah sinyal, dengan panjang periode dibulatkan seperti di chart (`shared/scalper.ts`). Pengaturan baru dipakai setelah sinyal yang sudah dikirim selesai; saat pindah, sinyal yang sudah dihasilkan pengaturan baru dicatat tanpa dikirim. Akun yang memakai pengaturan bawaan berbagi satu pemindaian, dan ledger sinyal publik selalu memakai bawaan. Menu Notifikasi menandai alert yang masih menunggu pengaturan barunya.
- Kripto dipantau di bursa yang sedang dipilih di chart (tombol Bursa): notifikasi pada `BYBIT:BTCUSDT` memakai candle Bybit dan pesannya menyebut sumber datanya. Indikator yang sama boleh dinyalakan di beberapa bursa.
- Pilihan indikatornya mengikuti katalog admin (lihat Katalog indikator di bawah), termasuk skrip yang diterbitkan admin (15m, 1j, 4j, harian; pesannya memakai nama indikator itu). Alert pada indikator yang tidak lagi terbuka untuk paket akun dijeda dan ditandai di Pantau → Alert, tanpa memakan jatah paket, lalu berjalan lagi bila dibuka kembali.

### Notifikasi harga

"Kabari saya saat harga menyentuh X". Levelnya dipasang di kartu **Kabari saya** (Pemula) atau di bagian **Harga** pada menu **Notifikasi** chart (Pro). Arahnya mengikuti harga saat dipasang: level di atas harga menunggu kenaikan, di bawahnya menunggu penurunan. Kotak harga membaca format Indonesia maupun Inggris (4.100 atau 4,100) dengan memilih tafsiran yang paling dekat dengan harga sekarang, dan baris di bawahnya menyebut arahnya sebelum dipasang.

- Tiap menit, di samping pemindaian sinyal (`server/src/price-alerts.ts`), server membaca candle 15m yang sama dengan chart:
  - **Kripto dan emas:** real-time dari Binance (emas dari perpetual XAUUSDT), atau dari bursa yang dipilih di chart.
  - **Aset lain:** dari Yahoo. Datanya tertunda dan di-cache 15 menit, jadi notifikasinya bisa terlambat.
- Level terpicu kalau harga terbaru melewatinya, atau kalau high/low candle yang dibuka setelah level dipasang menyentuhnya. Sentuhan di antara dua pemeriksaan tetap terhitung, sedangkan gerakan sebelum level dipasang tidak pernah memicunya.
- **Sekali saja:** level dimatikan dengan satu update bersyarat sebelum pesannya dikirim, jadi tetap terkirim sekali walau ada dua instance server.
- **Pesan:** dikirim lewat Telegram, dan lewat email kalau SMTP diatur dan alamatnya terverifikasi. Isinya nama aset, level, harga saat itu, dan sumber datanya.
- **Catatan:** level yang terpicu tetap tersimpan (waktu dan harga), dan bisa dihapus.
- **Jatah:** level aktif memakai jatah notifikasi paket bersama notifikasi sinyal. Kalau paket turun, notifikasi sinyal didahulukan dan level terbaru dijeda.

API:
- `GET /api/price-alerts?symbol=`: daftar level, jumlah terpakai, batas paket, dan status Telegram/email.
- `POST /api/price-alerts {symbol, tvSymbol, price, label?}`: menolak harga yang sama dengan harga sekarang dan level di atas batas paket; level yang sama dikembalikan apa adanya.
- `DELETE /api/price-alerts/:id`.

### Kripto multi-bursa (tombol Bursa di chart)

- Harga kripto dari 9 bursa lewat CCXT di server (`server/src/venues.ts`): Binance, Bybit, OKX, Coinbase, Kraken, Bitget, KuCoin, Gate, dan Indodax (rupiah). Server yang mengambil datanya, karena banyak bursa diblokir ISP di Indonesia.
- Tombol "Bursa" di chart membuka harga semua bursa secara real-time (WebSocket tiap bursa, Indodax lewat REST tiap 3 detik), selisih terhadap median, spread bid-ask, dan umur data. Klik bursa untuk memakai candle-nya di chart, indikator, skrip, dan panel TradingView (simbol berganti, misalnya `BYBIT:BTCUSDT`).
- Riwayat candle per bursa berbeda: Kraken hanya 720 candle terakhir, Indodax sekitar 9 hari candle 15m. Lab bisa memilih bursa untuk simbol kripto; notifikasi dan buku catatan juga bisa per bursa (lihat bagian masing-masing).
- Gambar agent (dalam dolar) disembunyikan pada bursa rupiah.

### Lab strategi (Uji strategi → Lab)

- Uji mesin bawaan (PoB, Scalper, Fib), indikator yang diterbitkan admin, atau skrip sendiri pada riwayat panjang: kripto dari Binance (15m s.d. 1 tahun, 1j s.d. 3 tahun, 4j/harian s.d. 5 tahun), emas intraday dari XAUUSDT, lainnya dari Yahoo. Daftarnya hanya berisi yang dibuka katalog indikator untuk akun itu.
- Setiap trade dipotong biaya taker atau maker (`tradeCost` di `server/src/ledger.ts`). Untuk kripto keduanya 0,2% per trade, karena fee maker dasar Binance juga 0,1% per sisi (sebelum 1 November 2026 maker dihitung 0,05%); emas 0,40 USD; lainnya taker 0,10%, maker 0,05%. Riwayat dibagi: data awal untuk membentuk strategi, data uji (20/30/40% terakhir) untuk memeriksa. Strategi "lolos" hanya bila positif setelah biaya di keduanya dengan minimal 30 trade di data uji.
- Mesin dijalankan worker (`worker/lab.py`, perintah `lab`), skrip di sandbox yang sama dengan chart dengan batas 30 detik. Satu uji berjalan pada satu waktu, sebanyak batas paket per 24 jam (Gratis 5, Pro 60, Creator 120), 30 hasil terakhir disimpan (`lab_runs`).
- Template skrip "Donchian breakout" dan "Trend EMA 50/200 + pullback" disediakan untuk diuji di 4j dan harian. Strategi yang lolos dicatat live di buku catatan (`LEDGER_SCRIPTS` di `ledger.ts`): saat ini Donchian breakout harian, persis seperti diuji (periode 20, SL 2 ATR, TP 4 ATR, kedaluwarsa 120 candle).

### Keluar berdasarkan kondisi (skrip)

- `signal(i, side, { sl, tp, exit, maxBars, exclusive })`: `exit` adalah array boolean, posisi ditutup di close candle pertama setelah sinyal yang bernilai true (dicek setelah SL dan TP); `maxBars` menutup posisi setelah sekian candle; `exclusive: true` berarti satu posisi sekaligus.
- Hasil baru `exit` (keluar oleh kondisi) tampil di chart, editor, notifikasi, Lab dan buku catatan. Win rate di buku catatan dan Lab dihitung dari trade yang untung setelah biaya, bukan dari TP yang tersentuh; jumlah TP dan SL tetap ditampilkan terpisah.
- Template "RSI(2) pullback" dan "Bollinger revert" (mean reversion: beli saat harga terlalu jauh di bawah rata-rata dalam tren naik, keluar saat kembali ke rata-rata). Di Lab, RSI(2) harian pada S&P 500 menang 78-80% dengan hasil positif setelah biaya, tetapi baru 43 trade dalam 5 tahun.

### Buku catatan sinyal (tab Sinyal)

- Setiap sinyal mesin bawaan (PoB 15m/1j, Scalper 15m, Fib 15m/1j/harian) pada `SIGNAL_LEDGER_SYMBOLS` (default BTC-USD, ETH-USD, GC=F) dicatat sekali saat lahir, beku, lalu dinilai saat candle berikutnya tutup, oleh pemindai yang sama dengan notifikasi.
- Akun simulasi `SIGNAL_PAPER_BALANCE` (10.000 USD), risiko `SIGNAL_PAPER_RISK_PCT` (1%) per sinyal, dikurangi biaya pulang-pergi: kripto 0,2% (fee taker dasar Binance 0,1% saat masuk dan keluar; slippage belum termasuk), emas 0,40 USD, lainnya 0,10%; ubah per simbol lewat `SIGNAL_COSTS`.
- Kripto memakai candle real-time Binance (`server/src/binance.ts`, dan `chart_agent.py` dengan jendela yang sama), jadi chart, notifikasi, agent dan ledger membaca candle yang sama. Emas 15m/1j/4j memakai kontrak perpetual XAUUSDT Binance (real-time; candle saat spot emas tutup, yaitu jeda harian 17:00-18:00 New York dan akhir pekan, dibuang). Selisihnya terhadap futures COMEX rata-rata sekitar 3-4 USD. Emas harian tetap dari Yahoo.
- Saat pertama menyala, ledger mengisi riwayat dari candle lama (ditandai "riwayat", di luar statistik live). Sinyal yang terlihat lebih dari `SIGNAL_STALE_BARS` candle terlambat juga dianggap riwayat.
- Kripto juga dicatat di bursa `SIGNAL_LEDGER_VENUES` (default `binance,bybit,okx,indodax`), masing-masing dari candle bursanya sendiri, sebagai pembanding. Akun simulasi, kurva ekuitas, dan total rekap tetap memakai Binance supaya satu sinyal tidak terhitung berkali-kali. Tab Sinyal punya pilihan bursa dan tab "Per bursa"; rekap Telegram menambahkan baris "Kripto per bursa".
- Tab "Per bursa" bisa beralih ke biaya nyata: fee taker dasar tiap bursa (Binance, Bybit, OKX 0,1%; Indodax 0,2% dari API-nya) dibayar saat masuk dan keluar, dihitung ulang dari entry dan SL yang tersimpan, tanpa diskon VIP atau token; slippage dan pajak kripto belum termasuk. Fee bursa lain, atau koreksi, lewat `SIGNAL_VENUE_FEES` (per sisi, misalnya `{"gate": 0.002}`).
- Sampai 1 November 2026 biaya kripto diasumsikan 0,12%; biaya sinyal lama dihitung ulang ke 0,2% dari entry dan SL masing-masing (migrasi `0013_crypto_cost`), dan Lab memakai biaya taker yang sama.
- Biaya default sama di semua bursa (0,2%) supaya yang dibandingkan hanya harganya. Biaya nyata satu bursa diatur lewat `SIGNAL_COSTS` dengan kunci `SIMBOL@bursa`, misalnya `{"BTC-USD@indodax": {"pct": 0.006}}` untuk taker Indodax 0,3% per sisi (angka bawaan CCXT; biaya `abs` dalam mata uang bursa itu).
- Rekap harian ke Telegram pukul `SIGNAL_RECAP_TIME` WIB (05:15, setelah New York tutup), mingguan tiap Sabtu; dikirim ke admin dan pengguna yang punya notifikasi. Admin bisa mengirim rekap tes dari tab Sinyal.
- Emas harian dari Yahoo (futures `GC=F`) bisa tertunda beberapa menit.

API: `GET /api/alerts`, `POST /api/alerts {symbol, tvSymbol, indicator, timeframe}` (bursa diambil dari `tvSymbol`), `DELETE /api/alerts/:id`, `POST /api/alerts/test`, `GET /api/ledger?days=&history=&venue=&symbol=&source=`.

### Chart dan harga dari TradingView

Chart, ticker tape, daftar harga dan screener memakai [widget gratis TradingView](https://www.tradingview.com/widget-docs/). Menurut [FAQ data TradingView](https://www.tradingview.com/widget-docs/faq/data/), crypto dan forex realtime; saham (termasuk IDX) tertunda sekitar 15 menit, dan paket berbayar TradingView tidak mengubah data di widget.

- Widget hanya menampilkan data TradingView, jadi tidak bisa diberi penanda hasil analisa AI.
- Engine menganalisa dengan data harian Yahoo Finance; angka di chart bisa sedikit berbeda.
- Widget gratis tidak menyajikan futures bursa (`COMEX:GC1!`) atau sebagian feed indeks (`SP:SPX`, `TVC:DJI`). Komoditas dan indeks memakai simbol CFD yang tersedia: emas `OANDA:XAUUSD` (engine: `GC=F`), S&P 500 `FOREXCOM:SPXUSD` (engine: `^GSPC`), dan seterusnya.
- Pemetaan simbol Yahoo ↔ TradingView ada di `client/src/lib/tv.ts`, bersama daftar simbol tiap tab dan ticker tape. Tambah baris di sana untuk simbol baru, lalu cek simbolnya memang tampil di widget.

## Prasyarat

- Bun 1.4+
- Docker (untuk Postgres)
- Python venv repo sudah terpasang (`uv venv --python 3.13` lalu `uv pip install -e ".[dev]"` di root repo)
- Minimal satu API key LLM di `.env` root repo, misalnya `OPENAI_API_KEY=...`

## Menjalankan (development)

Dari folder `web/`:

```bash
bun install
```

```bash
bun run db:up
```

```bash
bun run dev
```

Buka http://localhost:5180. Vite meneruskan `/api` ke server Bun di port 3080. Migrasi database jalan otomatis saat server start.

### Tes

```bash
cd web/server && bun run test   # server: API, login, notifikasi, keamanan
cd web/client && bun run test   # paritas indikator: grafik vs notifikasi
```

- Tes server butuh Postgres lokal (`bun run db:up` dari `web/`) dan Python venv di root repo (katalog model dibaca lewat worker).
- Setiap run membuat ulang database `tradingagents_test`, dan nama database yang tidak berakhiran `_test` ditolak, jadi data dev aman. Untuk database lain, set `TEST_DATABASE_URL` (tetap harus berakhiran `_test`).
- Tes memanggil app langsung (`app.request` pada `server/src/app.ts`), tanpa port dan tanpa scheduler. Harga untuk notifikasi harga juga tiruan, jadi tidak ada panggilan ke bursa.
- Satu run sekitar satu menit; sebagian besar menunggu langkah TOTP 30 detik di tes verifikasi dua langkah.
- Tes paritas menjalankan PoB, Fib, dan Scalper Pro+ dua kali pada candle asli yang disimpan di `client/test/fixtures`: versi TypeScript yang digambar grafik (`client/src/lib/indicators`) dan versi Python yang dipakai notifikasi (`worker/pob.py`, `fib.py`, `chart_agent.py` lewat `signals.py`). Setiap sinyal dibandingkan: bar, arah, entry, stop, target, dan hasilnya. Scalper juga dijalankan dengan pengaturan pengguna yang memuat angka pecahan: apa adanya di grafik, dan seperti yang diteruskan pemindai lewat `shared/scalper.ts`. Mengubah satu mesin tanpa yang lain membuat tes ini gagal dan menampilkan sinyal yang berbeda.
- Tes paritas butuh Python 3.11+ dengan pandas (`PYTHON` memilih interpreter; bawaannya `.venv` di root repo), tanpa database dan tanpa jaringan. Sekitar 20 detik.
- Setiap push ke `main` atau `feat/web-app`, dan setiap PR, yang menyentuh `web/` atau engine menjalankan semuanya di GitHub Actions (`.github/workflows/web.yml`): cek tipe klien dan server, build klien, `ruff check web`, tes server pada Postgres 16 (versi produksi), dan tes paritas.

### Mode demo (tanpa API key, tanpa biaya)

```bash
bun run dev:demo
```

Server memakai `worker/demo_worker.py`, yang memutar ulang analisa tiruan dengan format event yang sama. Cocok untuk mengerjakan UI.

## Menjalankan (satu proses)

```bash
bun run build
```

```bash
bun run start
```

Server Bun menyajikan `client/dist` sekaligus API di http://127.0.0.1:3080.

## Deploy dengan Docker

Satu image (`web/Dockerfile`) berisi engine Python, server Bun, dan client yang sudah dibuild; `web/deploy/compose.yml` menambahkan Postgres sendiri. App hanya mendengar di `127.0.0.1:${APP_PORT}`, jadi taruh reverse proxy dengan TLS di depannya.

```bash
cd web/deploy
cp .env.example .env      # isi POSTGRES_PASSWORD, APP_PASSWORD, key LLM, ALLOWED_BACKEND_URLS
docker compose up -d --build
```

- **Rilis berikutnya** dikirim lewat GitHub Actions: Actions, Deploy, Run workflow, lalu ketik `deploy`. Workflow menjalankan semua cek di commit itu, mengemasnya (`git archive`), dan mengirimnya lewat SSH ke `web/deploy/receive-release.sh`, satu-satunya perintah yang boleh dijalankan kunci deploy. Skrip itu membongkar rilis di `~/tradingagents/releases/<waktu>-<commit>` lalu menjalankan `deploy.sh` milik rilis itu:
  - membawa `.env` dari rilis yang sedang jalan dan menandai image lama `:previous`;
  - build, lalu `docker compose up -d` (migrasi dulu, baru app dan worker diganti);
  - menunggu `/healthz` dan memastikan worker berjalan.

  Kalau satu langkah gagal, image dan rilis sebelumnya otomatis dipulihkan. Kalau berhasil, `~/tradingagents/src` menjadi symlink ke rilis baru, tiga rilis terakhir disimpan, dan image lama proyek ini dibersihkan. Deploy di VPS berjalan terlepas dari koneksi SSH dan mencatat lognya di `<rilis>/deploy.log`: koneksi yang putus atau job yang dibatalkan tidak menghentikannya di tengah jalan, dan deploy berikutnya ditolak sampai yang ini selesai. Menyiapkan kunci deploy dan secret-nya dijelaskan di `docs/runbooks/deploy.md`. Tanpa Actions: `git -c core.autocrlf=false archive --format=tar.gz HEAD | ssh <user>@<host> /usr/local/bin/tradingagents-deploy "$(git rev-parse HEAD)"`.
- **Migrasi** berjalan sebagai langkah sendiri: service `migrate` menjalankan `bun src/migrate.ts` dengan image baru, lalu selesai. Container app baru diganti setelah langkah itu sukses (app sendiri start dengan `MIGRATE_ON_START=0`). Kalau migrasi gagal, `docker compose up` berhenti dengan error dan app yang lama tetap melayani. Lognya: `docker compose logs migrate`.

- **Login**: halaman login sendiri per akun (lihat "Akun" di bawah), sesi berupa cookie HttpOnly bertanda tangan HMAC selama 30 hari. Maksimal 10 percobaan gagal per IP per 15 menit. Semua `/api/*` butuh sesi; skrip boleh mengirim header HTTP Basic (nama pengguna + kata sandi akun) sebagai gantinya, kecuali untuk akun dengan verifikasi dua langkah. Server menolak start di alamat non-loopback tanpa `APP_PASSWORD`. `/healthz` terbuka untuk health check.

### Akun

- **Admin pertama** dibuat otomatis saat boot dari `APP_USER` / `APP_PASSWORD` kalau belum ada akun sama sekali, dan semua data yang tersimpan sebelum fitur akun ada diberikan ke admin itu. Setelahnya kata sandi diganti di app (menu akun → Profil → Keamanan); mengubah `.env` tidak mengubah akun yang sudah ada.
- **Pendaftaran:** dengan `SIGNUP=open`, orang mendaftar sendiri di `/app#/signup` (email, kata sandi, nomor WhatsApp opsional, setuju S&K) atau dengan Google (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, redirect `PUBLIC_URL/api/auth/google/callback`). Tanpa `SIGNUP=open` hanya admin yang membuat akun. Masuk bisa dengan email atau nama pengguna. Akun yang masuk dengan Google wajib mengisi nomor WhatsApp dulu di layar "Satu langkah lagi"; sampai terisi, server menahan analisa AI dan chat agent, dan nomornya tidak bisa dihapus lagi dari Profil. Cara memasang kunci Google: [docs/runbooks/google-auth.md](../docs/runbooks/google-auth.md).
- **Verifikasi email:** tautan sekali pakai (24 jam). Sebelum terverifikasi, analisa AI, chat agent, dan watchlist terjadwal belum jalan; setelahnya trial Pro 7 hari aktif, sekali per akun. Masuk dengan Google langsung terverifikasi. Lupa kata sandi: tautan 1 jam, dan mengatur ulang mengeluarkan semua sesi lain. Tanpa SMTP tautan tidak terkirim: pendaftar diberi tahu bahwa akunnya menunggu verifikasi admin, Konsol admin → Ringkasan menghitung akun yang menunggu, dan **verifikasi manual** di Pengguna langsung mengaktifkan trial Pro.
- **Email** lewat SMTP penyedia apa pun (`SMTP_URL`, `MAIL_FROM`). Tanpa SMTP tidak ada email yang terkirim (log menyebut penerima dan judulnya; `MAIL_LOG=1` menulis isinya, untuk pengembangan saja), dan admin bisa menandai email terverifikasi di Konsol admin → Pengguna.
- **Konsol admin** (`/app#/admin`, menu akun → Konsol admin; hanya admin) memisahkan pekerjaan admin dari layar trading. Isinya delapan halaman: Ringkasan (angka bisnis dan daftar "Perlu tindakan": pembayaran menunggu dan layanan yang belum diatur atau bermasalah), Pengguna, Aktivitas, Pembayaran, Kupon, Indikator, Status layanan, dan Pengaturan server. Pengaturan server hanya bisa dibaca: isinya apa yang sudah aktif dan nama variabelnya, tanpa kunci atau alamat backend (`GET /api/admin/config`). Anggota tidak melihat menu ini, dan anggota yang membuka `#/admin` dibawa ke aplikasi.
- **Admin** membuat akun di Konsol admin → **Pengguna**: nama pengguna, kata sandi awal, peran (anggota/admin). Di sana juga: paket dan masa berlakunya, verifikasi email manual, nonaktifkan/aktifkan, reset kata sandi, ubah peran, dan kuota harian per orang (kosong = kuota paketnya). Admin tidak bisa menonaktifkan atau menurunkan dirinya sendiri, dan selalu harus ada satu admin aktif.
- **Data pribadi per akun:** riwayat analisa dan backtest, marker keputusan, sesi chat agent, memori, gambar di chart, skill, watchlist. Admin bisa melihat riwayat semua akun (tombol **Semua pengguna** di Riwayat, dengan kolom pemilik) dan membuka laporannya; chat, memori, dan skill tetap pribadi, termasuk dari admin.
- **Tetap bersama:** memori keputusan engine TradingAgents (satu file log di engine yang dipakai agent untuk belajar dari keputusan lama).
- **Kuota:** tiap akun mengikuti paketnya (atau kuota khusus dari admin), dan `DAILY_TOTAL_ANALYSIS_LIMIT` / `DAILY_TOTAL_CHAT_LIMIT` membatasi semua akun bersama.
- **Sesi:** kata sandi diganti atau akun dinonaktifkan → semua sesi akun itu langsung berakhir (browser yang mengganti kata sandinya tetap masuk).
- **Verifikasi dua langkah:** tiap akun bisa menyalakannya di Profil → Keamanan dengan aplikasi authenticator (TOTP sesuai RFC 6238: pindai kode QR, lalu ketik satu kode). Setelah itu kata sandi, Google, dan tautan atur ulang kata sandi hanya menghasilkan tiket 10 menit untuk langkah kode; tiap kode berlaku sekali. Delapan kode pemulihan ditampilkan sekali untuk ponsel yang hilang (yang disimpan hanya hash-nya) dan bisa dibuat ulang dengan kode dari aplikasi. Kode salah juga dihitung per akun, maksimal 10 per 15 menit. Menyalakannya mengeluarkan browser lain. Admin bisa mematikannya di Konsol admin → Pengguna untuk anggota yang kehilangan ponsel sekaligus kode pemulihannya (`server/src/totp.ts`).
- **Telegram:** satu bot untuk server (`TELEGRAM_BOT_TOKEN`); tiap akun mengisi chat ID-nya sendiri di Profil → Notifikasi dan menerima ringkasan analisa hariannya sendiri.
- **Tanpa `APP_PASSWORD`** (pengembangan lokal) tidak ada login: semua permintaan dianggap admin pertama.

API: `GET /api/session`, `GET /api/auth/config`, `POST /api/login`, `POST /api/login/2fa` (tiket + kode), `POST /api/logout`, `POST /api/signup`, `GET /api/verify-email`, `POST /api/password/forgot`, `POST /api/password/reset`, `GET /api/auth/google`, `GET`/`PATCH /api/me`, `POST /api/me/password`, `POST /api/me/email`, `POST /api/me/verify-email`, `POST /api/me/2fa/setup`, `POST /api/me/2fa/enable`, `POST /api/me/2fa/disable`, `POST /api/me/2fa/recovery`, `PATCH /api/me/profile`; admin: `GET`/`POST /api/users`, `PATCH /api/users/:id`; `GET /api/analyses?scope=all` (admin).

### Paket dan pembayaran

- Paket ada di `shared/plans.ts` (dipakai server, aplikasi, dan situs): Gratis, Pro (Rp149.000/bulan atau Rp1.490.000/tahun), Creator (Rp399.000/bulan atau Rp3.990.000/tahun), dan harga founding Pro Rp79.000/bulan untuk 100 pelanggan pertama. Paket membedakan kapasitas: analisa AI dan chat per hari, uji Lab per hari, notifikasi, simbol watchlist, skrip. Di luar kapasitas ada halaman rekam jejak publik untuk Creator, dan indikator chart yang dibuka admin untuk tiap paket (Katalog indikator di bawah; semuanya terbuka untuk semua paket sampai admin mengubahnya). Admin memakai kapasitas Creator dengan batas analisa dan chat dari `DAILY_*`.
- Paket berlaku sampai tanggalnya, lalu akun kembali ke Gratis; notifikasi dan simbol watchlist di atas batas Gratis dijeda (yang terlama tetap jalan).
- Pembayaran manual: anggota memesan di menu akun → **Paket & tagihan**. Jumlahnya harga ditambah kode unik 3 digit supaya mudah dicocokkan dengan mutasi rekening; rekening atau QRIS-nya dari `PAYMENT_INSTRUCTIONS`, dan pesanan kedaluwarsa setelah 3 hari. Setelah anggota menekan "Saya sudah bayar", admin mendapat Telegram dan email, lalu mengonfirmasi atau menolak di Konsol admin → **Pembayaran** (berisi ringkasan anggota, paket aktif, trial, dan pendapatan). Konfirmasi memperpanjang paket dari tanggal berakhirnya bila paketnya sama, atau mulai hari itu.
- Paket yang diatur admin di Konsol admin → Pengguna tercatat sebagai pemberian (Rp0) di riwayat pembayaran.
- Kupon: admin membuat kode di Konsol admin → **Kupon**, berupa potongan persen atau rupiah, untuk paket dan periode tertentu atau semua, dengan kuota dan hari terakhir bila perlu. Anggota mengetiknya di **Paket & tagihan**. Satu akun memakai satu kode sekali, harga founding tidak bisa digabung dengan kupon, dan kupon 100% langsung mengaktifkan paket. Kupon dimatikan, tidak dihapus, supaya riwayat pesanannya tetap utuh.
- Tagihan: setiap pesanan punya halaman tagihan, yang menjadi bukti pembayaran setelah lunas (`/invoice/:id`). Halaman itu dibuka dari tautan bertanda tangan di email pesanan dan bukti bayar, serta dari dialog Paket & tagihan; tidak perlu masuk, dan bisa dicetak atau disimpan sebagai PDF. Tautan di email butuh `PUBLIC_URL`.
- Pengingat otomatis lewat email, dan Telegram bila akunnya menautkan Telegram: 7, 3, dan 1 hari sebelum paket berbayar berakhir, sehari sebelum masa coba habis, setelah paket atau masa coba berakhir, dan sehari sebelum pesanan yang belum dibayar kedaluwarsa. Tiap pengingat terkirim sekali per akun dan kejadian (tabel `notices`), dicek tiap jam.
- Ringkasan bisnis (Konsol admin → **Ringkasan**): pendapatan bulanan berulang dari pelanggan berbayar, pendapatan per bulan selama 12 bulan, konversi trial ke berbayar, paket yang perlu diperpanjang dan yang tidak diperpanjang, pemakaian kupon, serta token model AI 30 hari terakhir per jenis pekerjaan, model, dan akun. Semua rupiah di sini tanpa kode unik.
- Meteran token: setiap perintah worker yang memanggil model (analisa, backtest, agent chart, terjemahan Pine, ringkasan pasar) melaporkan token per model saat selesai, lewat callback pemakaian LangChain. Server menyimpannya per akun di tabel `llm_usage`, dan `LLM_COST_IDR_PER_MTOK` mengubahnya menjadi perkiraan biaya.

API: `GET /api/billing`, `GET /api/billing/coupon?code=&period=`, `POST /api/billing/orders` (dengan `coupon` opsional), `POST /api/billing/orders/:id/claim`, `POST /api/billing/orders/:id/cancel`; admin: `GET /api/admin/payments?status=open|paid|all`, `POST /api/admin/payments/:id/confirm`, `POST /api/admin/payments/:id/reject`, `GET /api/admin/overview`, `GET`/`POST /api/admin/coupons`, `PATCH /api/admin/coupons/:id`, `GET /api/admin/business`; tanpa masuk: `GET /invoice/:id?t=` (tautan bertanda tangan).

### Katalog indikator (Konsol admin → Indikator)

- Admin mengatur indikator chart yang bisa dipakai tiap paket: tiga mesin bawaan (Scalper Pro+, PoB BYSTRA, Fib GZ) dan skrip yang diterbitkan admin (`server/src/indicators.ts`, [ADR 0011](../docs/adr/0011-katalog-indikator-per-paket.md)). Tiap indikator punya paket yang boleh memakainya, akses khusus untuk akun tertentu apa pun paketnya, tanda **langsung nyala** (menyala di chart akun yang belum pernah memilih indikator), tanda aktif, dan urutan di menu.
- Anggota hanya melihat yang dibuka untuknya, di tiga tempat sekaligus: menu Indikator di chart, pilihan notifikasi sinyal, dan Lab. Admin selalu melihat semuanya, termasuk yang nonaktif, untuk mencoba sebelum membukanya.
- Indikator baru dibuat dari skrip (bahasa yang sama dengan Skrip saya; bisa diambil dari skrip admin atau template). Kodenya disalin ke katalog, jadi mengubah skrip asal tidak mengubah indikatornya. Indikator baru terbuka untuk admin saja sampai paketnya dicentang.
- Mesin bawaan tidak bisa dihapus, diganti nama, atau diubah kodenya; matikan untuk menyembunyikannya. Menghapus indikator skrip ikut menghapus notifikasi yang memakainya; riwayat call-nya tetap di Beranda pemiliknya, dan penghapusan ditolak selama sinyal publik creator darinya masih berjalan.
- Halaman `/harga` menampilkan tabel indikator per paket dari `GET /api/public/indicators` (nama, penjelasan, paket; tanpa kode), hanya indikator aktif yang terbuka untuk minimal satu paket.
- Migrasi 0026 mengisi tiga mesin bawaan terbuka untuk semua paket dan tidak langsung nyala, sama dengan perilaku sebelum katalog ada.

API: `GET /api/indicators` (yang boleh dipakai akun ini, dengan kode skrip untuk sandbox chart), `GET /api/public/indicators` (tanpa masuk); admin: `GET`/`POST /api/admin/indicators`, `PATCH`/`DELETE /api/admin/indicators/:id`, `PUT /api/admin/indicators/:id/grants` (`{ userIds }`, mengganti seluruh daftar).

### Aktivitas member (Konsol admin → Aktivitas)

- Selama tab aplikasi ada di depan dan dipakai (klik, sentuhan, atau ketikan dalam 5 menit terakhir), halaman mengirim detak tiap 30 detik berisi layar, tab, dan simbol chart yang terbuka (`client/src/lib/activity.ts`). Server menyimpan satu baris per menit (`activity_minutes`), jadi waktu aktif dihitung per menit, bukan dari lamanya tab terbuka.
- Tindakan dicatat server di tempat terjadinya (`activity_events`, `track` di `server/src/activity.ts`): masuk, analisa AI, backtest, pesan ke agent chart, uji Lab, notifikasi sinyal dan harga baru, simbol ke analisa harian, dan skrip baru.
- Halaman Aktivitas menampilkan member yang online sekarang (detak dalam 3 menit terakhir), member aktif per hari, jam ramai per hari dan jam dalam seminggu (WIB), layar dan tab, fitur, aset yang paling lama dibuka, dan daftar member dengan terakhir aktif. Halaman per member (`#/admin/aktivitas/<id>`) menambah sesinya (jeda lebih dari 15 menit memulai sesi baru) dan riwayat tindakannya. Periode 7, 30, atau 90 hari.
- Akun admin tidak dicatat. Data lebih dari 90 hari dihapus tiap hari oleh instance pemimpin penjadwal, seperti yang tertulis di Kebijakan Privasi.

API: `POST /api/activity` (detak halaman, `{ screen, tab, symbol }`); admin: `GET /api/admin/activity?days=7|30|90`, `GET /api/admin/activity/users/:id?days=`. Keputusan desainnya di [ADR 0012](../docs/adr/0012-aktivitas-member-per-menit.md).

### Situs publik

- Landing page (`/`), Harga (`/harga`), Syarat & Ketentuan (`/syarat`), Kebijakan Privasi (`/privasi`), Disclaimer risiko (`/disclaimer`), Status layanan (`/status`), dan rekam jejak Creator (`/c/<nama pengguna>`) adalah halaman statis dari build klien (`client/index.html`, `client/harga/` dan seterusnya). Harga dan kapasitas diisi saat build dari `shared/plans.ts`; nama merek dan kontak dari `shared/brand.ts`.
- Landing page memuat data live tanpa login dari `GET /api/public/market` (BTC, ETH, SOL, emas, IHSG, S&P 500, USD/IDR: lanskap hero dari 30 harga penutupan tiap pasar, chart BTC, daftar pantau, dan ringkasan pasar), `/api/public/crypto-map` (peta 24 koin Binance), `/api/public/signals` (8 sinyal live terbaru dan rekor 90 hari), dan `/api/public/brief` (bacaan AI, juga rata-rata 20 hari dan terendah 30 hari BTC yang digambar di chart); semuanya di-cache (`server/src/site.ts`).
- Landing page selalu memakai tema gelap (`data-theme="cobalt-dark"` di `client/index.html`); halaman situs lain mengikuti tema perangkat.
- Ringkasan pasar AI ditulis tiap 6 jam oleh model quick tier server (perintah worker `brief`, `worker/brief.py`) hanya dari angka yang dihitung server: harga, perubahan 1/7/30 hari, rata-rata 20/50 hari, RSI 14, rentang 30 hari, dan sinyal terbaru. Hasilnya (judul, ringkasan, arah per aset dengan argumen bull dan bear, yang dipantau, risiko) disimpan di tabel `market_briefs` bersama angka yang dibacanya, dan angka itu ditampilkan di landing. `SITE_BRIEF=off` mematikannya.
- Status layanan (`/status`): keadaan sekarang dan 90 hari terakhir dari database, harga kripto (Binance), harga pasar lain (Yahoo), mesin analisa, pemindai sinyal, ringkasan pasar AI, Telegram, dan email. Server memeriksa tiap 5 menit dan menyimpan hitungan harian per bagian di tabel `status_days`; bagian yang belum diatur tidak dihitung. Data dari `GET /api/public/status` (di-cache 30 detik). Pemeriksanya server yang sama, jadi bila server mati halaman ini ikut tidak terbuka; untuk itu pakai pemantau dari luar ke `/healthz`.
- Rekam jejak Creator (`/c/<nama pengguna>`): akun Creator menyalakan halamannya di Profil → Halaman publik (nama tampilan dan bio), lalu memilih alert yang masuk dengan sakelar **Publik** di menu Notifikasi chart. Setiap sinyal baru dari alert itu dicatat saat muncul bersama biaya simulasinya, lalu dinilai otomatis saat selesai (tabel `creator_signals`, `server/src/creators.ts`). Catatan hanya bertambah: alert yang dijadikan privat atau dihapus tetap meninggalkan sinyalnya, dan alert publik yang masih punya sinyal berjalan tidak bisa dihapus. Halaman turun bila pemiliknya mematikannya atau bukan Creator lagi. Data dari `GET /api/public/creators/:username` (di-cache 1 menit); pengaturannya lewat `PATCH /api/me/profile` dan `PATCH /api/alerts/:id/public`.
- Aplikasi ada di `/app`. Tanpa `PUBLIC_SITE=on`, alamat root langsung membuka aplikasi (landing tetap bisa dilihat di `/index.html`); tautan lama `/#/...` tetap diarahkan ke `/app`.
- Isi Syarat & Ketentuan, Kebijakan Privasi, dan Disclaimer adalah draf awal: tinjau dengan ahli hukum, dan isi nama usaha serta kontak di `shared/brand.ts`, sebelum situs dibuka.
- **Key LLM**: diisi di `web/deploy/.env` (tidak masuk image, tidak di-commit). `ALLOWED_BACKEND_URLS` membatasi ke mana key itu boleh dikirim. Hanya admin yang memilih provider, model, dan Backend URL. Analisa, backtest, chat agent, dan terjemahan Pine milik anggota selalu memakai bawaan server, apa pun yang dikirim halamannya (`server/src/models.ts`). Opsi form untuk anggota juga tidak memuat nama key dan URL bawaan. Anggota bahkan tidak melihat panel Pengaturan di form analisa dan backtest: keduanya selalu memakai analisa standar (semua analis yang punya data, kedalaman 1, bahasa Indonesia; `shared/analysis.ts`), dan server menerapkannya apa pun yang dikirim.
- **Data**: volume `tradingagents_db` (Postgres) dan `tradingagents_data` (laporan, cache, dan memori keputusan engine).
- **Proxy**: matikan buffering supaya stream SSE (log analisa, chat agent) jalan, dan beri timeout baca panjang, misalnya di nginx `proxy_buffering off; proxy_read_timeout 3600s;`.
- File `.env` harus berakhiran baris LF; nilai dengan `\r` dari editor Windows membuat password tidak cocok.

Pola deploy yang dipakai: setiap rilis diekstrak ke `~/tradingagents/releases/<waktu>-<commit>` pada VPS, `~/tradingagents/src` menunjuk ke rilis yang berjalan (compose di `~/tradingagents/src/web/deploy`), dan nginx menjadi reverse proxy dengan vhost per domain dan sertifikat Let's Encrypt dari certbot. Deploy lewat GitHub Actions (Deploy, Run workflow), atau dari repo lokal dengan akses SSH biasa (ganti `<user>@<vps>`):

```bash
git -c core.autocrlf=false archive --format=tar.gz HEAD | ssh <user>@<vps> /usr/local/bin/tradingagents-deploy "$(git rev-parse HEAD)"
```

Jangan mengekstrak arsip ke `src`: itu rilis yang sedang berjalan, jadi isinya tertimpa tanpa rilis sebelumnya untuk kembali. `.env` tidak ada di arsip git; `deploy.sh` menyalinnya dari rilis yang berjalan ke rilis baru. `core.autocrlf=false` perlu karena tanpa itu Git di Windows menulis CRLF ke Dockerfile, compose, dan kode di arsip; hanya skrip shell yang dijaga LF oleh `web/.gitattributes`. Pemasangan sekali, urutan deploy, dan rollback ada di [docs/runbooks/deploy.md](../docs/runbooks/deploy.md).

### Backup

`web/deploy/backup.sh` menyimpan dump database (`db-<waktu>.dump`, format pg_dump custom) dan isi volume data engine (`data-<waktu>.tar.gz`), lalu menghapus yang lebih tua dari `KEEP_DAYS` (default 14 hari). Di VPS dijalankan cron setiap hari pukul 02.30 WIB:

```
# /etc/cron.d/tradingagents-backup
30 19 * * * root BACKUP_DIR=/home/<user>/tradingagents/backups sh /home/<user>/tradingagents/src/web/deploy/backup.sh >> /var/log/tradingagents-backup.log 2>&1
```

Memulihkan database (hentikan app dulu: `docker compose stop app`):

```bash
docker exec -i tradingagents-db-1 pg_restore -U tradingagents -d tradingagents --clean --if-exists < db-<waktu>.dump
```

**Uji restore.** `web/deploy/restore-check.sh` membuktikan backup terbaru bisa dipulihkan, tanpa menyentuh database live:
- Dump terbaru dipulihkan ke Postgres sementara (image yang sama dengan database live, tanpa port dan tanpa volume).
- Jumlah baris setiap tabel dibandingkan dengan database live, yang hanya dibaca. Tabel yang dibuat setelah backup itu tampil dengan "-" di kolom backup.
- Arsip data terbaru dibaca sampai habis, lalu container sementaranya dihapus.
- Status keluar 0 hanya kalau restore berhasil dan ada akun admin.

```bash
sudo BACKUP_DIR=/home/<user>/tradingagents/backups sh web/deploy/restore-check.sh
```

Jalankan setidaknya seminggu sekali, misalnya lewat cron setiap Minggu pukul 03.00 WIB:

```
# /etc/cron.d/tradingagents-restore-check
0 20 * * 6 root BACKUP_DIR=/home/<user>/tradingagents/backups sh /home/<user>/tradingagents/src/web/deploy/restore-check.sh >> /var/log/tradingagents-backup.log 2>&1
```

**Salinan di luar VPS.** Backup di atas masih ada di disk VPS yang sama: kalau disk atau VPS-nya hilang, backup ikut hilang. Dengan `BACKUP_REMOTE`, `backup.sh` juga menyalin setiap backup ke penyimpanan lain lewat [rclone](https://rclone.org), lalu menghapus salinan di sana yang lebih tua dari `REMOTE_KEEP_DAYS` (default 60 hari). Kalau unggahan gagal, skrip keluar dengan error yang tercatat di log, dan backup lokal tetap ada.

Disiapkan sekali di VPS, sebagai root (cron berjalan sebagai root):
1. Pasang rclone: `sudo apt-get install -y rclone`.
2. Jalankan `sudo rclone config`. Buat remote untuk penyimpanannya (Cloudflare R2, Backblaze B2, atau S3 lain), sebaiknya di penyedia yang berbeda dari VPS. Lalu buat remote `crypt` di atasnya, supaya penyedia hanya menyimpan data terenkripsi.
3. Simpan kata sandi crypt di luar VPS juga, misalnya di password manager. Tanpa kata sandi itu, salinannya tidak bisa dibuka setelah VPS hilang.
4. Coba dulu dengan `sudo BACKUP_REMOTE=<remote-crypt>:tradingagents sh .../backup.sh`, lalu `sudo rclone ls <remote-crypt>:tradingagents`.
5. Tambahkan `BACKUP_REMOTE=<remote-crypt>:tradingagents` ke baris cron di atas.

Memulihkan dari salinan luar: `rclone copy <remote-crypt>:tradingagents/db-<waktu>.dump .`, lalu `pg_restore` seperti di atas.

`BACKUP_PING_URL`, misalnya sebuah cek di healthchecks.io, dipanggil setelah semua salinan selesai. Kalau backup berhenti berjalan atau gagal mengunggah, layanan itu mengirim peringatan.

### Keamanan, log, dan error

- **Header keamanan** di setiap respons: HSTS 180 hari, `X-Frame-Options: SAMEORIGIN`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, dan CORP.
- **CSP** masih mode laporan (`Content-Security-Policy-Report-Only`). Browser mengirim pelanggarannya ke `POST /api/csp-report`, dan server mencatatnya di log (maksimal 30 per menit). Kebijakan diberlakukan setelah laporannya bersih, karena widget TradingView memuat skrip dan frame dari domainnya sendiri.
- **Log:** satu objek JSON per baris (`t`, `level`, `event`, lalu isi peristiwanya), jadi bisa dicari dengan `grep '"level":"error"'` atau dikirim apa adanya ke layanan log. Tiap request API menjadi satu baris berisi id, method, path tanpa query string (bisa memuat token sekali pakai), status, durasi, dan user.
- **Kode error:** setiap respons membawa `X-Request-Id`. Error 500 hanya menampilkan pesan umum dengan kode itu; pesan aslinya dan stack masuk log serta tabel `server_errors` (disimpan 30 hari).
- **Konsol admin → Status layanan** menampilkan error itu, termasuk kegagalan kerja latar (pemindaian sinyal, cek harga, analisa, watchlist, ringkasan AI, rekap, pengingat). Jumlah 24 jam terakhir muncul di "Perlu tindakan" (`GET /api/admin/errors`).

### Lebih dari satu instance

Beberapa instance server boleh berjalan di atas satu database. Yang harus sama di semua instance disimpan di Postgres:
- **Scheduler hanya jalan di satu instance:** pemindaian sinyal, cek harga, watchlist, rekap, pengingat, ringkasan AI, cek status, dan pembersihan. Instance itu memegang advisory lock Postgres (`locks.ts`). Kalau instance itu mati, instance lain mengambil alih dalam sekitar 15 detik; `docker stop` menyerahkannya saat itu juga. Log `scheduler_leader` menandai instance yang memegangnya.
- **Batas percobaan** (kata sandi, kode dua langkah, pendaftaran, email) dihitung di tabel `rate_limits`, jadi berlaku untuk semua instance dan tidak hilang saat restart.
- **Satu jawaban per sesi chat, dan satu uji Lab sekaligus,** di instance mana pun, lewat lease di tabel `leases`. Lease diperbarui selama kerja berjalan, dan lepas sendiri dalam 2 menit kalau instance-nya mati.
- **Halaman status** membaca hasil cek terakhir dari `shared_values`, yang ditulis instance pemegang scheduler.

Cache (candle, katalog model, halaman Creator, jawaban halaman status) tetap per instance. Isinya boleh sedikit berbeda antar-instance karena tidak pernah memberi jawaban salah; paling buruk satu instance mengambil ulang datanya.

**Worker analisa.** Antrean analisa dan backtest ada di Postgres (`jobs.ts`). Di produksi, service `worker` di compose (`bun src/runner.ts`) mengambil baris yang antre (`FOR UPDATE SKIP LOCKED`, jadi satu analisa tidak pernah diambil dua worker) dan menjalankan engine; app sendiri tidak menjalankan analisa (`MAX_CONCURRENT_ANALYSES=0`). Setiap event disimpan di `analysis_events` dan diumumkan lewat `NOTIFY`, jadi stream langsung di browser dan ringkasan watchlist berjalan di instance app mana pun. Tambah worker dengan `docker compose up -d --scale worker=2`; masing-masing menjalankan `MAX_CONCURRENT_ANALYSES` analisa sekaligus.
- **Batal:** baris langsung ditandai dibatalkan, dan worker yang menjalankannya diberi tahu untuk mematikan prosesnya.
- **Worker berhenti** (deploy, restart): analisa yang sedang jalan ditandai gagal dengan alasannya, karena analisa tidak bisa dilanjutkan di tengah. Worker yang mati mendadak berhenti mengirim heartbeat, dan analisanya ditandai gagal oleh instance pemegang scheduler dalam sekitar 2 menit.
- Chat agen, uji Lab, terjemahan Pine, pemindaian sinyal, dan ringkasan AI masih berjalan di proses app.

Tanpa worker terpisah (development, `bun run dev`), app menjalankan antreannya sendiri selama `MAX_CONCURRENT_ANALYSES` lebih dari 0.

### Pemantauan

**Peringatan di Telegram.** Instance pemegang scheduler memeriksa setiap menit dan mengirim pesan ke grup atau channel `ALERT_CHAT_ID`. Kalau tidak diisi, pesan dikirim ke setiap admin yang mengisi chat ID Telegram di profilnya. Setiap kondisi dikirim sekali saat mulai dan sekali saat pulih:
- 5 error server atau lebih dalam 10 menit (sumbernya disebut);
- antrean analisa tidak berjalan: yang tertua menunggu 10 menit tanpa ada analisa yang jalan, atau 60 menit dalam keadaan apa pun;
- 3 analisa gagal atau lebih dalam 30 menit;
- pemindai sinyal diam lebih dari 20 menit;
- cek status menemukan bagian yang mati.

**Metrik.** Dengan `METRICS_TOKEN`, `GET /metrics` menjawab dalam format Prometheus (header `Authorization: Bearer <token>`). Isinya: request per pola route dan status beserta durasinya, antrean analisa (antre, jalan, umur yang tertua), error satu jam terakhir, scan sinyal terakhir, instance pemegang scheduler, uptime, dan memori. Angka request dihitung per instance, jadi setiap instance di-scrape sendiri. Tanpa token, halaman ini tidak ada.

Tracing (OpenTelemetry) belum dipasang. Satu request sudah bisa dilacak lewat `X-Request-Id`, yang muncul di log JSON dan di kode error.

## Konfigurasi server

Semua opsional, lewat environment variable:

| Variable | Default | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://tradingagents:tradingagents@127.0.0.1:5590/tradingagents` | Koneksi Postgres |
| `PORT` / `HOST` | `3080` / `127.0.0.1` | Alamat server |
| `PYTHON_BIN` | `.venv` repo | Interpreter untuk worker |
| `MAX_CONCURRENT_ANALYSES` | `2` | Analisa yang dijalankan proses ini bersamaan; sisanya antre. `0`: proses ini hanya mengantre, worker terpisah yang menjalankan (`bun src/runner.ts`, service `worker` di compose) |
| `MAX_BACKTEST_CELLS` | `40` | Batas sel per backtest (samakan dengan `MAX_CELLS` di `client/src/routes/Home.svelte`) |
| `TA_WORKER_SCRIPT` | `web/worker/ta_worker.py` | Ganti ke `web/worker/demo_worker.py` untuk mode demo |
| `JOB_IDLE_MINUTES` | `15` | Analisa/backtest tanpa event selama ini dianggap macet: worker dihentikan, status gagal |
| `DAILY_ANALYSIS_LIMIT` | `60` | Analisa per hari (WIB) untuk akun admin; anggota mengikuti paketnya. Tiap sel backtest dihitung satu analisa. `0` = tanpa batas. Pemakaian tampil di bawah tombol Analisa/Backtest (`GET /api/usage`) |
| `DAILY_CHAT_LIMIT` | `300` | Pesan ke chat agent per hari (WIB) untuk akun admin; anggota mengikuti paketnya. `0` = tanpa batas. Pemakaian tampil di footer chat |
| `DAILY_TOTAL_ANALYSIS_LIMIT` / `DAILY_TOTAL_CHAT_LIMIT` | `200` / `1000` | Batas harian semua akun bersama |
| `SIGNUP` | `closed` | `open` membuka pendaftaran mandiri (email dan Google) |
| `PUBLIC_SITE` | `off` | `on` menampilkan landing page di root; aplikasi tetap di `/app` |
| `SITE_BRIEF` | `on` | `off` menghentikan ringkasan pasar AI untuk landing page (satu panggilan model tiap 6 jam) |
| `PUBLIC_URL` | kosong | Alamat publik untuk tautan di email dan Telegram, dan redirect Google |
| `SMTP_URL` / `MAIL_FROM` | kosong | Pengirim email, misalnya `smtps://user:pass@smtp.resend.com:465` dan `Nama <noreply@domainmu>` |
| `MAIL_LOG` | kosong | `1` menulis isi email (termasuk tautannya) ke log selama SMTP belum diatur; untuk pengembangan saja |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | kosong | Masuk dan daftar dengan Google (OAuth client tipe Web) |
| `PAYMENT_INSTRUCTIONS` | kosong | Rekening atau QRIS untuk pembayaran manual (`
` untuk baris baru); kosong = pemesanan paket belum dibuka |
| `REMINDERS` | `on` | `off` menghentikan pengingat perpanjangan paket dan tagihan |
| `LLM_COST_IDR_PER_MTOK` | kosong | Harga token model dalam rupiah per sejuta token, `masuk,keluar` (mis. `15000,60000`), untuk perkiraan biaya di dashboard bisnis |
| `SESSION_SECRET` | dari `APP_PASSWORD` (lokal saja) | Kunci tanda tangan cookie sesi dan tautan tagihan, minimal 32 karakter. Wajib saat server terbuka ke jaringan dengan login (`HOST` bukan loopback dan `APP_PASSWORD` terisi). Menggantinya mengeluarkan semua orang dan membatalkan tautan tagihan lama |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, atau `silent` |
| `METRICS_TOKEN` | kosong | Token untuk `GET /metrics` (format Prometheus), minimal 16 karakter. Kosong: halaman metrik tidak ada |
| `ALERT_CHAT_ID` | kosong | Chat ID Telegram (angka) atau `@channel` tujuan peringatan server. Kosong: dikirim ke admin yang mengisi chat ID Telegram |
| `MIGRATE_ON_START` | `1` | `0` kalau migrasi sudah dijalankan langkah deploy sebelumnya (`bun src/migrate.ts`, service `migrate` di compose) |
| `TA_LLM_TIMEOUT` / `TA_LLM_MAX_RETRIES` | `180` / `2` | Timeout per panggilan LLM (detik) dan retry SDK untuk analisa dan backtest |
| `TA_AGENT_LLM_TIMEOUT` | `120` | Timeout per panggilan LLM untuk chat agent (retry selalu 1) |

API key LLM tetap dibaca engine dari `.env` di root repo, tidak lewat web.

Pengaturan dicek saat server start (`readSettings` di `server/src/config.ts`). Angka, URL, `LOG_LEVEL`, atau `SESSION_SECRET` yang salah menghentikan server dengan daftar semua masalahnya, bukan baru ketahuan saat fiturnya dipakai.

Setiap analisa yang berjalan mengirim *heartbeat* ke barisnya tiap 30 detik. Saat boot dan tiap 2 menit, server hanya menggagalkan baris yang heartbeat-nya basi (servernya mati), jadi dua instance di database yang sama tidak saling menggagalkan; baris antre diklaim atomik supaya tidak dijalankan dua kali. Kalau sebuah baris selesai di tempat lain (misalnya dibatalkan), worker-nya di instance ini ikut dihentikan.

## API

Referensi lengkapnya ada di [`docs/api/openapi.json`](../docs/api/openapi.json) (OpenAPI 3.1). Isinya setiap rute, apakah perlu sesi atau khusus admin, dan isian rute-rute utama. Berkas itu dibangkitkan dari rute server: setelah menambah atau mengubah rute, jalankan `bun run openapi` di `web/server`; tesnya gagal selama berkas tertinggal. Arsitektur, keputusan desain (ADR), dan runbook operasi ada di [`docs/`](../docs/README.md). Tabel di bawah merangkum rute yang paling sering dipakai.

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/options` | Provider, model, analis, kedalaman, bahasa, dan `typicalMinutes` (median lama 50 analisa terakhir, untuk janji waktu di form Riset AI) |
| GET | `/api/analyses` | 100 analisa terakhir (`?kind=backtest` untuk backtest) |
| POST | `/api/backtests` | Mulai backtest (`tickers`, `start`, `end`, `everyNDays`, opsional `runId`) |
| GET | `/api/candles?symbol=&range=&interval=` | Candle Yahoo; `range` `6mo`/`1y`/`2y`/`5y`, `interval` `1h`/`4h`/`1d`/`1wk`/`1mo` (default `1d`) |
| GET | `/api/decisions?ticker=` | Semua keputusan AI untuk satu ticker |
| GET | `/api/verdict?ticker=` | Satu saran untuk layar Pemula: analisa selesai terakhir milik pengguna, atau pandangan ringkasan pasar AI, atau `null` |
| GET | `/api/quotes?symbols=` | Harga terakhir dan perubahan dari penutupan sebelumnya untuk maksimal 80 simbol (ejaan mesin: `BBCA.JK`, `BTC-USD`), untuk daftar Pasar dan Pantauanku |
| GET | `/api/activity/since` | Yang terjadi sejak kunjungan sebelumnya (jeda lebih dari 15 menit di menit aktivitas): sinyal baru, alert harga yang kena, analisa yang selesai |
| GET | `/api/indicators` | Indikator chart yang boleh dipakai akun ini (katalog admin), dengan kode skrip yang diterbitkan untuk sandbox chart |
| POST | `/api/analyses` | Mulai analisa baru |
| GET | `/api/analyses/:id` | Detail, status agent, laporan |
| GET | `/api/analyses/:id/events` | Stream SSE: event tersimpan diputar ulang, lalu event live |
| GET | `/api/analyses/:id/report` | Laporan HTML lengkap (di-sandbox lewat CSP) |
| POST | `/api/analyses/:id/cancel` | Batalkan analisa yang antre atau berjalan |
| DELETE | `/api/analyses/:id` | Hapus analisa yang sudah selesai |
| POST | `/api/agent/sessions/:id/messages` | Satu giliran agent chart (stream SSE) |
| GET | `/api/agent/skills` | Semua versi skill buatan agent |
| POST | `/api/agent/skills/:id/:action` | `approve`, `reject`, `disable`, `enable`, `restore` |
| DELETE | `/api/agent/skills/by-name/:name` | Hapus skill beserta semua versinya |

Rute agent lainnya (sesi, memori, gambar) ada di bagian Agent chart di atas.

## Mengubah skema database

Edit `server/src/db/schema.ts`, lalu dari `server/`:

```bash
bun run db:generate
```

Migrasi baru di `server/drizzle/` diterapkan otomatis saat server start berikutnya. Di produksi, migrasi berjalan sebelum app diganti (service `migrate`), jadi app versi lama masih melayani di atas skema baru selama beberapa detik. Karena itu migrasi harus tetap cocok dengan versi yang sedang berjalan: tambahkan tabel atau kolom dulu, dan hapus yang lama di rilis berikutnya. Beberapa instance yang start bersamaan bergiliran lewat advisory lock, jadi setiap migrasi diterapkan sekali.

## Batasan MVP

- Tanpa `APP_PASSWORD` tidak ada login, dan server hanya listen di `127.0.0.1`. Jangan buka server seperti itu ke internet, karena setiap analisa memakai API key dan biaya LLM kamu.
- Analisa yang sedang berjalan tidak bisa dilanjutkan setelah worker-nya restart: ditandai gagal dan perlu dijalankan lagi. Yang masih antre tetap menunggu worker berikutnya.
- Provider ChatGPT (login), Azure, dan Bedrock belum tersedia di form web.
