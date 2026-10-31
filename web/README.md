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

## Workspace satu layar

Semua fitur ada di satu layar yang berpusat pada **simbol aktif**. Ganti simbol (kotak pencarian Ctrl/⌘ K, daftar Pasar, atau klik di widget TradingView) dan semua panel ikut berganti.

| Panel | Isi |
| --- | --- |
| Pasar (kiri) | Daftar pilihan per tab: IDX, US, Crypto, Forex, Komoditas |
| Chart (tengah) | Chart TradingView, atau "Keputusan AI": candle Yahoo + marker setiap keputusan |
| AI (kanan) | Analisa/backtest yang terbuka (progres agent, keputusan), keputusan terakhir simbol ini, form analisa dan backtest |
| Dock (bawah) | Riwayat · Laporan · Log · Backtest · Screener; bisa diperbesar atau disembunyikan |

Lebar ≥ 1280 px: tiga kolom + dock. 1024–1279 px: chart + AI, daftar Pasar jadi laci. < 1024 px: satu panel dengan tab bawah (Pasar · Chart · AI · Riwayat).

**Status di URL** — `#/?s=IDX:BBCA&run=<id>&bt=<id>&dock=log&m=crypto&v=ai&ai=backtest`, jadi link bisa dibagikan dan tombol Back berjalan. Link lama (`#/analyses/:id`, `#/backtests/:id`, `#/chart?symbol=…`, `#/markets?tab=…`, `#/?ticker=…`) diterjemahkan otomatis.

### Agent chart (tab "Tanya" di panel AI)

Chat per simbol dengan agent yang membaca pasar lewat skill, menggambar di chart "Keputusan AI", dan mengingat preferensi.

- **Skill analisa** (dihitung pandas di `worker/chart_agent.py`, bukan dikarang model): `get_market_summary`, `find_pivots`, `support_resistance`, `fit_trendline`, `fibonacci`, `indicators`, `latest_decisions` (memory log engine).
- **Skill gambar**: `draw_level`, `draw_trendline`, `draw_zone`, `draw_box` (kotak dari candle ke candle, bisa memanjang ke kanan, teks di tepi kanan), `draw_label` (label penunjuk di harga), `draw_fib`, `draw_trade_plan`, `annotate`. Minta saja "buatkan kotak supply demand" atau "kotak dari 27 Okt 09:00 sampai 28 Okt antara 4000 dan 4060": agent memakai `supply_demand_zones` (zona supply/demand 15m, 1j, harian, termasuk yang flipped) lalu menggambar kotaknya di timeframe chart yang sedang dibuka. Setiap harga dan tanggal dicek terhadap riwayat harga nyata; yang di luar rentang ditolak dan agent diberi tahu alasannya.
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
│  ├─ workspace.svelte.ts   simbol aktif, run/backtest terbuka, tab dock; sinkron ke URL
│  ├─ run.svelte.ts         satu analisa: status + stream SSE (log, laporan, progres agent)
│  ├─ backtest.svelte.ts    satu backtest: status + stream progres
│  ├─ jobs.svelte.ts        riwayat analisa dan backtest (polling saat ada yang berjalan)
│  ├─ agent.svelte.ts       agent chart: sesi, gambar, memori, skill
│  ├─ catalog.svelte.ts     opsi provider/model dari engine
│  └─ viewport.svelte.ts    layout lebar/sedang/sempit
└─ workspace/
   ├─ WorkspaceShell.svelte tata letak saja
   ├─ MarketPanel · ChartPanel · AiPanel · Dock
   ├─ ChatPanel.svelte      chat agent; SkillsPanel.svelte untuk meninjau skill
   ├─ AnalysisForm.svelte   form analisa dan backtest
   └─ dock/  HistoryView · ReportView · LogView · BacktestView
```

### Backtest dan marker keputusan

Backtest memakai `tradingagents.backtest.run_backtest` milik engine: tim agent dijalankan penuh di setiap (ticker, tanggal), lalu tiap keputusan dinilai dari harga 5 hari bursa sesudahnya dibanding benchmark, dan dirangkum per rating dengan `summarize`. Satu sel = satu analisa penuh, jadi biayanya sebanyak itu; server membatasi `MAX_BACKTEST_CELLS` (default 40). Sel yang belum lewat 5 hari bursa masih *pending*; tombol "Lanjutkan & nilai ulang" menjalankan backtest yang sama dengan `runId`-nya, melewati sel yang sudah jadi dan menilai yang pending.

- Worker web menambahkan benchmark `.JK` → `^JKSE` (IHSG). Peta benchmark engine tidak punya IDX, sehingga tanpa ini saham IDX dinilai terhadap SPY. Crypto dan forex masih memakai default engine (SPY).
- Chart keputusan (TradingView Lightweight Charts) memakai candle Yahoo dari `GET /api/candles` (cache 15 menit) dan menandai setiap keputusan dari `GET /api/decisions` (analisa selesai + sel backtest). Hasil backtest dinilai dengan alpha engine; analisa tunggal dinilai dari arah harga 5 hari bursa sesudahnya. Hold tidak punya arah, jadi tidak dinilai.
- **Timeframe** 1j · 4j · 1H · 1M · 1B (parameter `interval`: `1h`, `4h`, `1d`, `1wk`, `1mo`; di URL `tf=`). 4j digabung server dari candle 1 jam, sejajar tengah malam zona waktu bursa. Candle per jam hanya tersedia sampai 1 tahun ke belakang (batas Yahoo), jadi rentang 2T/5T mati di sana. Engine, marker keputusan, dan gambar agent tetap harian: di timeframe lain sebuah tanggal ditaruh di candle pertama hari itu, dan "harga 5 hari" dihitung dari penutupan harian (kosong di mingguan/bulanan).
- Chart ini ada di halaman Chart (bagian "Keputusan AI di chart"), tab Chart di detail analisa, dan halaman detail backtest.

### Watchlist, analisa terjadwal, dan Telegram

Klik **☆ Pantau** di atas chart untuk memasukkan simbol ke watchlist (maksimal 10). Tab **Pantau** di dock menampilkan jadwal, keputusan terakhir tiap simbol, status Telegram, tombol **Jalankan sekarang**, dan **Kirim tes**.

- Setiap hari `WATCH_DAYS` (default Sen–Jum) pukul `WATCH_TIME` WIB (default 16.30), server menjalankan satu analisa per simbol dengan model default server (`TRADINGAGENTS_*`), analis `WATCH_ANALYSTS`, dan kedalaman `WATCH_DEPTH`. Kalau server baru menyala lebih dari 3 jam setelah jadwal, putaran hari itu tidak dikejar.
- Analisanya analisa biasa: masuk antrean, tampil di Riwayat, dan memakai kuota harian. Simbol yang tidak muat di sisa kuota dilewati dan disebut di pesan.
- Setelah semua selesai, satu pesan dikirim ke Telegram: rating tiap simbol, cuplikan Executive Summary, dan tautan ke laporannya (`PUBLIC_URL`). Server butuh `TELEGRAM_BOT_TOKEN` (dari @BotFather), dan tiap akun mengisi chat ID-nya di Profil; tanpa itu analisa tetap jalan, hanya tanpa pesan. Watchlist, jadwal, dan pesannya per akun.
- Satu putaran per hari dicatat di tabel `watch_runs`, jadi dua instance server tidak menjalankannya dua kali.

API: `GET /api/watchlist`, `POST /api/watchlist {symbol, tvSymbol}`, `DELETE /api/watchlist/:symbol`, `POST /api/watchlist/run`, `POST /api/watchlist/test`.

### Notifikasi sinyal (Telegram)

Di chart Keputusan AI, tombol **Notifikasi** menyalakan pesan Telegram per simbol untuk PoB BYSTRA (15m, 1j), Scalper Pro+ (15m) dan Fib Golden Zone (15m, 1j, harian), maksimal 15 per akun. Chat ID boleh ID grup (angka negatif) bila bot dimasukkan ke grup. Memakai bot dan chat ID yang sama dengan watchlist.

- Server memindai tiap 5 menit (pasangan 1j tiap 15 menit), satu menit setelah batas slot, lewat perintah worker `signals` yang menjalankan mesin yang sama dengan chart dan agent, hanya pada candle yang sudah tutup.
- Setiap sinyal disimpan sekali per notifikasi (`signal_events`, indeks unik), jadi terkirim sekali walau ada dua instance server. Pesan susulan dikirim saat sinyal kena TP, SL, kedaluwarsa, atau (Scalper) diganti sinyal baru.
- Saat notifikasi dinyalakan, sinyal yang sudah ada dicatat tanpa dikirim. Sinyal yang baru terlihat lebih dari `SIGNAL_STALE_BARS` candle (default 4) setelah muncul, misalnya karena server mati, dicatat tanpa dikirim.
- Kripto dipantau di bursa yang sedang dipilih di chart (tombol Bursa): notifikasi pada `BYBIT:BTCUSDT` memakai candle Bybit dan pesannya menyebut sumber datanya. Indikator yang sama boleh dinyalakan di beberapa bursa.

### Kripto multi-bursa (tombol Bursa di chart)

- Harga kripto dari 9 bursa lewat CCXT di server (`server/src/venues.ts`): Binance, Bybit, OKX, Coinbase, Kraken, Bitget, KuCoin, Gate, dan Indodax (rupiah). Server yang mengambil datanya, karena banyak bursa diblokir ISP di Indonesia.
- Tombol "Bursa" di chart membuka harga semua bursa secara real-time (WebSocket tiap bursa, Indodax lewat REST tiap 3 detik), selisih terhadap median, spread bid-ask, dan umur data. Klik bursa untuk memakai candle-nya di chart, indikator, skrip, dan panel TradingView (simbol berganti, misalnya `BYBIT:BTCUSDT`).
- Riwayat candle per bursa berbeda: Kraken hanya 720 candle terakhir, Indodax sekitar 9 hari candle 15m. Lab bisa memilih bursa untuk simbol kripto; notifikasi dan buku catatan juga bisa per bursa (lihat bagian masing-masing).
- Gambar agent (dalam dolar) disembunyikan pada bursa rupiah.

### Lab strategi (tab Lab)

- Uji mesin bawaan (PoB, Scalper, Fib) atau skrip sendiri pada riwayat panjang: kripto dari Binance (15m s.d. 1 tahun, 1j s.d. 3 tahun, 4j/harian s.d. 5 tahun), emas intraday dari XAUUSDT, lainnya dari Yahoo.
- Setiap trade dipotong biaya taker atau maker (`tradeCost` di `server/src/ledger.ts`). Riwayat dibagi: data awal untuk membentuk strategi, data uji (20/30/40% terakhir) untuk memeriksa. Strategi "lolos" hanya bila positif setelah biaya di keduanya dengan minimal 30 trade di data uji.
- Mesin dijalankan worker (`worker/lab.py`, perintah `lab`), skrip di sandbox yang sama dengan chart dengan batas 30 detik. Satu uji berjalan pada satu waktu, maksimal 60 uji per pengguna per 24 jam, 30 hasil terakhir disimpan (`lab_runs`).
- Template skrip "Donchian breakout" dan "Trend EMA 50/200 + pullback" disediakan untuk diuji di 4j dan harian. Strategi yang lolos dicatat live di buku catatan (`LEDGER_SCRIPTS` di `ledger.ts`): saat ini Donchian breakout harian, persis seperti diuji (periode 20, SL 2 ATR, TP 4 ATR, kedaluwarsa 120 candle).

### Keluar berdasarkan kondisi (skrip)

- `signal(i, side, { sl, tp, exit, maxBars, exclusive })`: `exit` adalah array boolean, posisi ditutup di close candle pertama setelah sinyal yang bernilai true (dicek setelah SL dan TP); `maxBars` menutup posisi setelah sekian candle; `exclusive: true` berarti satu posisi sekaligus.
- Hasil baru `exit` (keluar oleh kondisi) tampil di chart, editor, notifikasi, Lab dan buku catatan. Win rate di buku catatan dan Lab dihitung dari trade yang untung setelah biaya, bukan dari TP yang tersentuh; jumlah TP dan SL tetap ditampilkan terpisah.
- Template "RSI(2) pullback" dan "Bollinger revert" (mean reversion: beli saat harga terlalu jauh di bawah rata-rata dalam tren naik, keluar saat kembali ke rata-rata). Di Lab, RSI(2) harian pada S&P 500 menang 78-80% dengan hasil positif setelah biaya, tetapi baru 43 trade dalam 5 tahun.

### Buku catatan sinyal (tab Sinyal)

- Setiap sinyal mesin bawaan (PoB 15m/1j, Scalper 15m, Fib 15m/1j/harian) pada `SIGNAL_LEDGER_SYMBOLS` (default BTC-USD, ETH-USD, GC=F) dicatat sekali saat lahir, beku, lalu dinilai saat candle berikutnya tutup, oleh pemindai yang sama dengan notifikasi.
- Akun simulasi `SIGNAL_PAPER_BALANCE` (10.000 USD), risiko `SIGNAL_PAPER_RISK_PCT` (1%) per sinyal, dikurangi biaya pulang-pergi: kripto 0,12% (fee + slippage), emas 0,40 USD, lainnya 0,10%; ubah per simbol lewat `SIGNAL_COSTS`.
- Kripto memakai candle real-time Binance (`server/src/binance.ts`, dan `chart_agent.py` dengan jendela yang sama), jadi chart, notifikasi, agent dan ledger membaca candle yang sama. Emas 15m/1j/4j memakai kontrak perpetual XAUUSDT Binance (real-time; candle saat spot emas tutup, yaitu jeda harian 17:00-18:00 New York dan akhir pekan, dibuang). Selisihnya terhadap futures COMEX rata-rata sekitar 3-4 USD. Emas harian tetap dari Yahoo.
- Saat pertama menyala, ledger mengisi riwayat dari candle lama (ditandai "riwayat", di luar statistik live). Sinyal yang terlihat lebih dari `SIGNAL_STALE_BARS` candle terlambat juga dianggap riwayat.
- Kripto juga dicatat di bursa `SIGNAL_LEDGER_VENUES` (default `binance,bybit,okx,indodax`), masing-masing dari candle bursanya sendiri, sebagai pembanding. Akun simulasi, kurva ekuitas, dan total rekap tetap memakai Binance supaya satu sinyal tidak terhitung berkali-kali. Tab Sinyal punya pilihan bursa dan tab "Per bursa"; rekap Telegram menambahkan baris "Kripto per bursa".
- Tab "Per bursa" bisa beralih ke biaya nyata: fee taker dasar tiap bursa (Binance, Bybit, OKX 0,1%; Indodax 0,2% dari API-nya) dibayar saat masuk dan keluar, dihitung ulang dari entry dan SL yang tersimpan, tanpa diskon VIP atau token; slippage dan pajak kripto belum termasuk. Fee bursa lain, atau koreksi, lewat `SIGNAL_VENUE_FEES` (per sisi, misalnya `{"gate": 0.002}`).
- Biaya default sama di semua bursa (0,12%) supaya yang dibandingkan hanya harganya. Biaya nyata satu bursa diatur lewat `SIGNAL_COSTS` dengan kunci `SIMBOL@bursa`, misalnya `{"BTC-USD@indodax": {"pct": 0.006}}` untuk taker Indodax 0,3% per sisi (angka bawaan CCXT; biaya `abs` dalam mata uang bursa itu).
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

- **Login**: halaman login sendiri per akun (lihat "Akun" di bawah), sesi berupa cookie HttpOnly bertanda tangan HMAC selama 30 hari. Maksimal 10 percobaan gagal per IP per 15 menit. Semua `/api/*` butuh sesi; skrip boleh mengirim header HTTP Basic (nama pengguna + kata sandi akun) sebagai gantinya. Server menolak start di alamat non-loopback tanpa `APP_PASSWORD`. `/healthz` terbuka untuk health check.

### Akun

- **Admin pertama** dibuat otomatis saat boot dari `APP_USER` / `APP_PASSWORD` kalau belum ada akun sama sekali, dan semua data yang tersimpan sebelum fitur akun ada diberikan ke admin itu. Setelahnya kata sandi diganti di app (menu akun → Profil); mengubah `.env` tidak mengubah akun yang sudah ada.
- **Tanpa pendaftaran publik.** Admin membuat akun di menu akun → **Pengguna**: nama pengguna, kata sandi awal, peran (anggota/admin). Di sana juga: nonaktifkan/aktifkan, reset kata sandi, ubah peran, dan kuota harian per orang (kosong = default `DAILY_*`). Admin tidak bisa menonaktifkan atau menurunkan dirinya sendiri, dan selalu harus ada satu admin aktif.
- **Data pribadi per akun:** riwayat analisa dan backtest, marker keputusan, sesi chat agent, memori, gambar di chart, skill, watchlist. Admin bisa melihat riwayat semua akun (tombol **Semua pengguna** di Riwayat, dengan kolom pemilik) dan membuka laporannya; chat, memori, dan skill tetap pribadi, termasuk dari admin.
- **Tetap bersama:** memori keputusan engine TradingAgents (satu file log di engine yang dipakai agent untuk belajar dari keputusan lama).
- **Kuota:** tiap akun punya batas harian sendiri, dan `DAILY_TOTAL_ANALYSIS_LIMIT` / `DAILY_TOTAL_CHAT_LIMIT` membatasi semua akun bersama.
- **Sesi:** kata sandi diganti atau akun dinonaktifkan → semua sesi akun itu langsung berakhir (browser yang mengganti kata sandinya tetap masuk).
- **Telegram:** satu bot untuk server (`TELEGRAM_BOT_TOKEN`); tiap akun mengisi chat ID-nya sendiri di Profil dan menerima ringkasan watchlist-nya sendiri.
- **Tanpa `APP_PASSWORD`** (pengembangan lokal) tidak ada login: semua permintaan dianggap admin pertama.

API: `GET /api/session`, `POST /api/login`, `POST /api/logout`, `GET`/`PATCH /api/me`, `POST /api/me/password`; admin: `GET`/`POST /api/users`, `PATCH /api/users/:id`; `GET /api/analyses?scope=all` (admin).
- **Key LLM**: diisi di `web/deploy/.env` (tidak masuk image, tidak di-commit). `ALLOWED_BACKEND_URLS` membatasi ke mana key itu boleh dikirim.
- **Data**: volume `tradingagents_db` (Postgres) dan `tradingagents_data` (laporan, cache, dan memori keputusan engine).
- **Proxy**: matikan buffering supaya stream SSE (log analisa, chat agent) jalan, dan beri timeout baca panjang, misalnya di nginx `proxy_buffering off; proxy_read_timeout 3600s;`.
- File `.env` harus berakhiran baris LF; nilai dengan `\r` dari editor Windows membuat password tidak cocok.

Pola deploy yang dipakai: source di `~/tradingagents/src` pada VPS, compose di `~/tradingagents/src/web/deploy`, nginx sebagai reverse proxy dengan vhost per domain dan sertifikat Let's Encrypt dari certbot. Untuk memperbarui dari repo lokal (ganti `<user>@<vps>`):

```bash
git -c core.autocrlf=false archive --format=tar.gz -o /tmp/ta.tar.gz HEAD
scp /tmp/ta.tar.gz <user>@<vps>:tradingagents/
ssh <user>@<vps> "cd ~/tradingagents && tar -xzf ta.tar.gz -C src && rm ta.tar.gz && cd src/web/deploy && sudo docker compose up -d --build"
```

`.env` di VPS tidak tersentuh oleh pembaruan karena tidak ada di arsip git. `core.autocrlf=false` mencegah Git di Windows mengubah akhiran baris jadi CRLF di arsip (skrip shell gagal jalan dengan CRLF).

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

Backup ini masih di disk VPS yang sama; kalau disk atau VPS-nya hilang, backup ikut hilang. Salin berkala ke tempat lain (laptop, object storage) untuk perlindungan penuh.

## Konfigurasi server

Semua opsional, lewat environment variable:

| Variable | Default | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://tradingagents:tradingagents@127.0.0.1:5590/tradingagents` | Koneksi Postgres |
| `PORT` / `HOST` | `3080` / `127.0.0.1` | Alamat server |
| `PYTHON_BIN` | `.venv` repo | Interpreter untuk worker |
| `MAX_CONCURRENT_ANALYSES` | `2` | Analisa yang jalan bersamaan; sisanya antre |
| `MAX_BACKTEST_CELLS` | `40` | Batas sel per backtest (samakan dengan `MAX_CELLS` di `client/src/routes/Home.svelte`) |
| `TA_WORKER_SCRIPT` | `web/worker/ta_worker.py` | Ganti ke `web/worker/demo_worker.py` untuk mode demo |
| `JOB_IDLE_MINUTES` | `15` | Analisa/backtest tanpa event selama ini dianggap macet: worker dihentikan, status gagal |
| `DAILY_ANALYSIS_LIMIT` | `60` | Analisa per hari (WIB); tiap sel backtest dihitung satu analisa. `0` = tanpa batas. Pemakaian tampil di bawah tombol Analisa/Backtest (`GET /api/usage`) |
| `DAILY_CHAT_LIMIT` | `300` | Pesan ke chat agent per hari (WIB). `0` = tanpa batas. Pemakaian tampil di footer chat |
| `DAILY_TOTAL_ANALYSIS_LIMIT` / `DAILY_TOTAL_CHAT_LIMIT` | `200` / `1000` | Batas harian semua akun bersama (`DAILY_*` di atas adalah default per akun) |
| `SESSION_SECRET` | dari `APP_PASSWORD` | Kunci tanda tangan cookie sesi; menggantinya mengeluarkan semua orang |
| `TA_LLM_TIMEOUT` / `TA_LLM_MAX_RETRIES` | `180` / `2` | Timeout per panggilan LLM (detik) dan retry SDK untuk analisa dan backtest |
| `TA_AGENT_LLM_TIMEOUT` | `120` | Timeout per panggilan LLM untuk chat agent (retry selalu 1) |

API key LLM tetap dibaca engine dari `.env` di root repo, tidak lewat web.

Setiap analisa yang berjalan mengirim *heartbeat* ke barisnya tiap 30 detik. Saat boot dan tiap 2 menit, server hanya menggagalkan baris yang heartbeat-nya basi (servernya mati), jadi dua instance di database yang sama tidak saling menggagalkan; baris antre diklaim atomik supaya tidak dijalankan dua kali. Kalau sebuah baris selesai di tempat lain (misalnya dibatalkan), worker-nya di instance ini ikut dihentikan.

## API

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/options` | Provider, model, analis, kedalaman, bahasa |
| GET | `/api/analyses` | 100 analisa terakhir (`?kind=backtest` untuk backtest) |
| POST | `/api/backtests` | Mulai backtest (`tickers`, `start`, `end`, `everyNDays`, opsional `runId`) |
| GET | `/api/candles?symbol=&range=&interval=` | Candle Yahoo; `range` `6mo`/`1y`/`2y`/`5y`, `interval` `1h`/`4h`/`1d`/`1wk`/`1mo` (default `1d`) |
| GET | `/api/decisions?ticker=` | Semua keputusan AI untuk satu ticker |
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

Migrasi baru di `server/drizzle/` diterapkan otomatis saat server start berikutnya.

## Batasan MVP

- Belum ada login. Server hanya listen di `127.0.0.1`; jangan buka ke internet tanpa menambah autentikasi, karena setiap analisa memakai API key dan biaya LLM kamu.
- Worker berjalan sebagai subprocess server. Kalau server restart, analisa yang sedang berjalan ditandai gagal; yang masih antre dijalankan lagi.
- Provider ChatGPT (login), Azure, dan Bedrock belum tersedia di form web.
