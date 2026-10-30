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
- **Skill gambar**: `draw_level`, `draw_trendline`, `draw_zone`, `draw_fib`, `draw_trade_plan`, `annotate`. Setiap harga dan tanggal dicek terhadap riwayat harga nyata; yang di luar rentang ditolak dan agent diberi tahu alasannya.
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

- **Login**: halaman login sendiri (`APP_USER` / `APP_PASSWORD`), sesi berupa cookie HttpOnly bertanda tangan HMAC selama 30 hari, tombol Keluar di header. Maksimal 10 percobaan gagal per IP per 15 menit. Semua `/api/*` butuh sesi; skrip boleh mengirim header HTTP Basic sebagai gantinya. Server menolak start di alamat non-loopback tanpa password. Mengganti password (atau `SESSION_SECRET`) mengakhiri semua sesi. `/healthz` terbuka untuk health check.
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
