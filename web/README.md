# TraderMedan (web)

TraderMedan adalah aplikasi web untuk menjalankan analisa engine TradingAgents dari browser: isi form, pantau progres tiap agent secara live, lalu baca laporan dan keputusan akhirnya. Riwayat analisa tersimpan di Postgres. Nama dan tampilannya dibahas di bagian [Merek dan tampilan](#merek-dan-tampilan).

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

Mode Pro punya lima layar, dipilih dari menu di bilah atas (di ponsel dari tab bawah): **Beranda**, **Pasar**, **Riset AI**, **Pantau**, dan **Uji strategi** (`SCREENS` di `stores/workspace.svelte.ts`, lihat [ADR 0010](../docs/adr/0010-navigasi-lima-layar.md), [ADR 0015](../docs/adr/0015-pasar-dan-riset-dimulai-tanpa-chart.md), [ADR 0018](../docs/adr/0018-pasar-dan-riset-langsung-terbelah.md), [ADR 0019](../docs/adr/0019-riset-ai-pilih-lalu-pratinjau.md), [ADR 0020](../docs/adr/0020-indikator-dan-uji-satu-layar.md) dan [ADR 0021](../docs/adr/0021-beranda-ringkasan-pagi-dan-riwayat-call.md)). Semuanya berbagi **simbol aktif**: ganti simbol (kotak pencarian Ctrl/⌘ K, daftar Pasar, atau klik di widget TradingView) dan chart serta panelnya ikut berganti. Memilih simbol dari daftar di layar tanpa chart membuka chart-nya di Pasar. Di layar lebar Pasar dan Riset AI langsung terbelah: Pasar dengan daftar pasar di kiri dan chart di kanan, Riset AI dengan daftar aset di kiri dan pratinjau aset yang dipilih di kanan (chart lengkapnya terbuka lewat tombol, saat analisa dimulai, atau saat pertanyaan dikirim). Di ponsel keduanya dimulai tanpa chart: Pasar dengan papan pasar, Riset AI dengan daftar aset lalu pratinjaunya. Kotak pencarian menerima nama aset (Emas, Bitcoin, Bank Central Asia) selain kode (BBCA, BBCA.JK, IDX:BBCA, BTC-USD), dan menyarankan aset dari daftar Pasar saat mengetik. Nama yang dipakai beberapa aset (mis. "bank") meminta pilihan dari saran.

| Layar | Isi |
| --- | --- |
| Beranda | Dua kolom ([ADR 0021](../docs/adr/0021-beranda-ringkasan-pagi-dan-riwayat-call.md)); di ponsel satu kolom dengan urutan yang sama. Kolom utama: **Sejak kamu terakhir buka** (dari menit aktivitas): satu kalimat yang menghitung sinyal baru menurut keadaannya sekarang (kena TP, kena SL, berjalan, diganti atau keluar) dan R-nya sebelum biaya, satu baris per aset dengan satu manik per call (TP bulat, SL wajik, berjalan cincin) yang membuka Riwayat call aset itu sejak kunjungan tadi, lalu alert harga yang kena dan analisa yang selesai; **Sedang berjalan**: call yang masih diikuti dan trade jurnal, masing-masing di jalur SL–entry–TP dengan harga sekarang, dengan Saya ambil; **Sinyalmu** 7 atau 30 hari: R sebelum biaya dan dari berapa call, kena TP dari yang selesai, kurva R per hari, dan 8 call terbaru per hari WIB. Kolom samping: pasar utama (IHSG, emas, Bitcoin, USD/IDR, S&P 500) dengan sesinya dalam WIB, perubahan dari penutupan sebelumnya, dan garis sebulan; Pantauanku dengan harga live dan keputusan AI terakhir (Cenderung beli…); ringkasan pasar AI yang dilipat ke judulnya; kuota hari ini. Akun yang belum punya Pantauanku atau notifikasi sinyal mulai dari **Mulai di sini** (tiga langkah). **Riwayat call** (`#/beranda?view=calls`, juga dari Lihat semua di Rekam jejak live) memuat semua call periode 7 hari sampai 1 tahun: dikelompokkan per hari WIB, disaring di server menurut hasil, aset, dan indikator (dengan R masing-masing), dan dimuat dengan Tampilkan 50 lagi |
| Pasar | Di layar lebar langsung **terbelah**: daftar pasar di kiri (`MarketPanel.svelte`: tab IDX, US, Crypto, Forex, Komoditas, status sesi pasar, cari di daftar, nama, harga terakhir, perubahan hari ini, garis dan perubahan 30 hari bila panelnya dilebarkan, dan bintang Pantauanku), chart di kanan, dan Screener pasar itu di panel bawah, terlipat ke judulnya sampai diklik supaya chart mendapat tinggi layar. Chart awalnya aset yang terakhir dibuka, atau Bitcoin (BTCUSDT) di browser yang belum pernah membuka aset; klik baris lain hanya mengganti chart. Kepala chart satu baris: nama aset, bintang Pantauanku, status sesi, **Riset AI**, TradingView/Sinyal, dan menu ⋯ (Lompat ke tanggal; di layar lebar juga Tata letak dan Fokus). Chart ("Sinyal", bawaan: harga terakhir dan perubahan hari ini, candle, toolbar satu baris berisi timeframe, Indikator, Notifikasi, dan Lainnya (rentang, zoom, Navigasi waktu yang awalnya tersembunyi, Skrip, bursa kripto), dan kartu Rencana trading: setup indikator terbaru yang masih terbuka sebagai entry, SL, TP, dan R:R (untuk saham IDX dibulatkan ke fraksi harga BEI: SL ke langkah di luar level, TP ke langkah sebelumnya; sinyal Jual saham IDX dibaca "hindari beli, atau jual kalau sudah punya", tanpa hitungan lot dan tanpa Saya ambil), kalkulator ukuran posisi dari modal dan risiko per trade (lot IDX, oz emas, unit kripto), alert harga di ketiga level sekali tekan, dan salin rencana; atau TradingView) tanpa marker keputusan AI, dengan tombol **Riset AI** untuk meriset aset itu. Indikator yang menyala tampil sebagai label status pendek di kiri atas chart (misalnya "Scalper tren turun · Beli 21 Okt kena SL"), jauh dari candle terbaru; klik label untuk rinciannya. Setup yang sudah kena TP atau SL tidak lagi menjadi Rencana dan levelnya tidak digambar melintang chart; kartu Rencana lalu menulis alasannya. Di ponsel, Pasar dibuka sebagai **papan pasar** (`MarketBoard.svelte`, dengan garis 30 hari dari `GET /api/quotes?spark=1`), dan chart terbuka setelah aset diklik: candle setinggi layar, kartu Rencana di bawahnya |
| Riset AI | Sebelum chart dibuka (`ResearchStart.svelte`, [ADR 0019](../docs/adr/0019-riset-ai-pilih-lalu-pratinjau.md)): **daftar aset** di kiri (`AssetPicker.svelte`: kotak cari, tab pasar IDX sampai Komoditas, dan Untukmu berisi Pantauanku, riset terakhir, dan aset terakhir dibuka, atau aset populer bila ketiganya kosong; tiap baris dengan harga, perubahan hari ini, dan keputusan AI terakhir) dan **pratinjau** aset yang dipilih di kanan (`ResearchPreview.svelte`: grafik harga dengan tanda keputusan AI lama, keputusan AI terakhir dari `GET /api/verdict`, riwayat riset aset itu, lalu satu tempat mulai: **Analisa lengkap**, form analisa yang dilipat menjadi satu baris pengaturan, atau **Tanya AI** dengan pertanyaan siap pakai). Di layar ≥ 1024 px kedua kolom bergulir sendiri-sendiri. Browser yang belum pernah membuka aset melihat penjelasan cara riset di kanan. Memilih aset hanya mengganti pratinjau; chart lengkap terbuka lewat **Buka chart lengkap**, saat analisa dimulai, atau saat pertanyaan dikirim. Setelah itu chart dengan marker setiap keputusan AI ada di kiri, panel AI di kanan (**Tanya**: agent chart; **Analisa**: analisa yang terbuka, keputusan terakhir, form analisa), dan Riwayat, Laporan, Log di panel bawah, terlipat ke tab-tabnya sampai dibuka (analisa yang dibuka atau dijalankan membukanya sendiri); menu Riset AI di bilah atas kembali ke daftar aset. Pindah aset dari kepala chart: klik nama aset untuk mencari atau memilih dari daftar pasar dengan harganya, klik salah satu aset terakhir, atau Alt+↑/↓ untuk aset sebelah di daftar pasarnya; semuanya (chart, percakapan, form, riwayat) ikut pindah. Di ponsel daftar aset memenuhi layar dulu, lalu pratinjau dengan tombol kembali **Daftar aset** |
| Pantau | Hanya yang kamu pantau. Kepalanya (`PantauHead.svelte`, diperbarui tiap menit) berisi tiga kartu yang sekaligus menjadi tab, masing-masing dengan angka dan keadaannya: **Pantauanku** (jumlah aset dan analisa berikutnya), **Alert** (terpakai dari jatah paket dan sinyal yang berjalan), dan **Jurnal** (trade berjalan dan hasil R periodenya). Pantauanku: kartu per aset (garis sebulan, harga, keputusan AI terakhir) dan kartu jadwal analisa otomatis. Alert: alert sinyal dan harga per aset, bisa disaring Berjalan, Kena TP, atau Kena SL. Jurnal: hasil dalam R dengan grafik per trade, pola per perasaan dan sumber, trade berjalan dengan jalur SL–entry–TP, dan trade selesai. Menghapus alert atau trade jurnal meminta konfirmasi dulu; mengeluarkan aset dari Pantauanku langsung terjadi dan bisa diurungkan |
| Uji strategi | Tiga tab yang dinamai menurut pertanyaannya, dibaca sebagai jalur dengan ikon, keterangan singkat, dan panah: **Indikator** (semua indikator akun, satu yang dipilih dengan tab Detail indikator dan Chart pasar, dan kartu Uji untuk mengujinya; dulu dua tab, Indikator saya dan Uji indikator, [ADR 0020](../docs/adr/0020-indikator-dan-uji-satu-layar.md)) → **Rekam jejak live** (dulu Strategi live: sinyal sungguhan mesin bawaan), dengan **Uji saran AI** (dulu Backtest: seberapa sering saran AI benar) terpisah di ujung. Hasil dibuka dengan satu putusan (warnanya selalu disertai kata dan ikon). Di ponsel satu panel tampil sekali waktu |

Di Pasar dan Riset AI tiap panel bisa menempel, melayang di atas chart, atau ditutup (tombol × di kepalanya; tombolnya menunggu di pojok chart sampai dibuka lagi), dan menu ⋯ → Tata letak di kepala chart menyimpan susunannya. Mode fokus (tombol F) memberi chart seluruh jendela. Tiap layar ingat tab terakhirnya.

Lebar ≥ 1024 px: layar penuh dengan menu atas. < 1024 px: satu kolom per layar dengan tab bawah, dan tab di dalam layar menjajarkan semua isinya dalam satu baris (`PhoneScreen.svelte`): Pasar berisi papan (dengan tab Screener), lalu chart dengan tombol kembali; Riset AI berisi daftar aset, lalu pratinjau aset yang dipilih, dan setelah chart dibuka, pengganti aset di atas tab Chart · Tanya · Analisa · Riwayat · Laporan · Log.

**Status di URL** — `#/riset?s=IDX:BBCA&run=<id>&dock=log&tf=4h&ai=chat` (layar, simbol, analisa dan backtest terbuka, tab, pasar, chart), jadi link bisa dibagikan dan tombol Back berpindah antar layar. Di Pasar dan Riset AI simbol di URL berarti chart terbuka; `#/riset` tanpa simbol membuka daftar aset dengan pratinjaunya, dan `#/pasar` tanpa simbol membuka papan pasar di ponsel, sedangkan di layar lebar diisi aset aktif. Aset yang terakhir dibuka disimpan di browser (`ta.recent`). Link lama (`#/?s=…&run=…` dari pesan Telegram dan email, `#/analyses/:id`, `#/backtests/:id`, `#/chart?symbol=…`, `#/markets?tab=…`, `#/?ticker=…`, `ai=backtest`) dibuka di layar yang sekarang memuat isinya.

### Mode Pemula dan Pro

Sakelar **Pemula | Pro** ada di bilah atas.

- **Pemula** menampilkan satu aset dengan bahasa sederhana:
  - **Pantauanku**: watchlist, dengan pandangan AI terakhir tiap aset. Kalau masih kosong, tampil aset populer.
  - **Aset**: nama, harga terakhir dan perubahan hari ini, grafik area 1 hari sampai 1 tahun, kartu **Pandangan AI**, dan kartu **Kabari saya** (sakelar ringkasan AI harian, yang sekaligus memasukkan aset ke Pantauanku; notifikasi harga; dan status Telegram).
  - **Tanya AI**: chat agent tanpa nama tool, memori, dan skill.

  Mulai 1024 px tampil tiga kolom; di bawahnya, tiga tab bawah.
- **Pro** adalah workspace lengkap di atas.

Akun baru (daftar lewat email, Google, atau dibuat admin sebagai anggota) mulai di Pemula. Akun lama dan admin mulai di Pro. Pilihan disimpan di preferensi akun (`ui.mode`), jadi ikut ke perangkat lain, dan simbol aktif tidak berubah saat pindah mode.

**Pandangan AI** (`GET /api/verdict`; dulu Saran AI, diganti karena kartunya juga menulis "bukan saran investasi") mengambil sumber dengan urutan ini:
1. Keputusan analisa terakhirmu untuk aset itu, dengan tanggal trading terbaru.
2. Ringkasan pasar AI harian, untuk aset yang dicakupnya (BTC, ETH, Emas, IHSG).
3. Kalau keduanya tidak ada, tombol **Minta pandangan AI** menjalankan analisa standar dengan jatah analisa harian: semua analis yang relevan, kedalaman 1, bahasa Indonesia, dan model server.

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
│  ├─ announcer.svelte.ts   status yang dibacakan pembaca layar, lewat satu wilayah role=status di App.svelte
│  └─ viewport.svelte.ts    layout lebar/sedang/sempit
└─ workspace/
   ├─ WorkspaceShell.svelte menata layar yang terbuka; menu atas ada di AppShell, tab bawah ponsel di sini
   ├─ DashboardScreen.svelte Beranda (ResultCurve.svelte: R kumulatif)
   ├─ beranda/              SinceDigest · RunningNow · MySignals · MarketSide · StartSteps · CallHistory (Riwayat call)
   ├─ PageScreen.svelte     Pantau (kepalanya PantauHead.svelte) dan Uji strategi; PhoneScreen.svelte: Pasar dan Riset AI di ponsel
   ├─ ResearchStart.svelte  awal Riset AI: AssetPicker di kiri, ResearchPreview (pratinjau aset) di kanan
   ├─ MarketPanel · ChartPanel · AiPanel · Dock (panel bawah) · TabView (isi satu tab)
   ├─ ChatPanel.svelte      chat agent; SkillsPanel.svelte untuk meninjau skill
   ├─ AnalysisForm.svelte   form analisa (Riset AI) dan uji saran AI (Uji strategi), dengan indikator yang dibaca AI
   └─ dock/  HistoryView · ReportView · LogView · WatchView · SignalsView · AlertsView · BacktestView
             IndicatorsView (Uji strategi → Indikator: IndicatorList, IndicatorChart, LabCard, LabResult)
```

### Backtest dan marker keputusan

Backtest memakai `tradingagents.backtest.run_backtest` milik engine: tim agent dijalankan penuh di setiap (ticker, tanggal), lalu tiap keputusan dinilai dari harga 5 hari bursa sesudahnya dibanding benchmark, dan dirangkum per rating dengan `summarize`. Satu sel = satu analisa penuh, jadi biayanya sebanyak itu; server membatasi `MAX_BACKTEST_CELLS` (default 40). Sel yang belum lewat 5 hari bursa masih *pending*; tombol "Lanjutkan dan nilai ulang" menjalankan backtest yang sama dengan `runId`-nya, melewati sel yang sudah jadi dan menilai yang pending.

- **Run id sejak awal.** Server memberi `runId` saat uji dibuat (`YYYYMMDD_HHMMSS_` diikuti 6 angka acak), bukan worker di akhir uji.
  - Uji yang terputus (restart, deploy, Batalkan) menulis "Uji berhenti setelah X dari Y tanggal" dengan tombol **Lanjutkan uji**. Tanggal yang sudah selesai dilewati, dan hanya sisanya yang dihitung dari kuota hari ini: `progress.skipped` dikurangkan di `charged` (`usage.ts`).
  - `runId` hanya diterima dari uji milik akun itu sendiri (404 untuk akun lain), karena run id menamai folder berisi keputusan uji. Run id juga ditolak selama uji dengan run id itu masih berjalan (409).
  - Uji yang dibuat sebelum 3 November 2026 hanya punya run id kalau selesai, jadi yang terputus harus dijalankan ulang dari awal.

- Worker web menambahkan benchmark `.JK` → `^JKSE` (IHSG). Peta benchmark engine tidak punya IDX, sehingga tanpa ini saham IDX dinilai terhadap SPY. Crypto dan forex masih memakai default engine (SPY).
- Chart keputusan (TradingView Lightweight Charts) memakai candle Yahoo dari `GET /api/candles` (cache 15 menit) dan menandai setiap keputusan dari `GET /api/decisions` (analisa selesai + sel backtest). Hasil backtest dinilai dengan alpha engine; analisa tunggal dinilai dari arah harga 5 hari bursa sesudahnya. Hold tidak punya arah, jadi tidak dinilai.
- **Timeframe** 1j · 4j · 1H · 1M · 1B (parameter `interval`: `1h`, `4h`, `1d`, `1wk`, `1mo`; di URL `tf=`). 4j digabung server dari candle 1 jam, sejajar tengah malam zona waktu bursa. Candle per jam hanya tersedia sampai 1 tahun ke belakang (batas Yahoo), jadi rentang 2T/5T mati di sana. Engine, marker keputusan, dan gambar agent tetap harian: di timeframe lain sebuah tanggal ditaruh di candle pertama hari itu, dan "harga 5 hari" dihitung dari penutupan harian (kosong di mingguan/bulanan).
- Chart ini ada di chart Keputusan AI dan di hasil backtest (Uji strategi → Uji saran AI).
- Uji saran AI: form tiga langkah (aset, tanggal, indikator yang dibaca AI) menyebut biayanya sebelum mulai, "Butuh N analisa" dibanding sisa kuota hari ini; bila tidak muat, **Sesuaikan ke kuota** memendekkan rentang ke tanggal terakhir yang muat. Tiap uji di Riwayat uji AI membawa skornya ("Benar 7 dari 12", dari `score` di `GET /api/analyses?kind=backtest`: saran berarah yang sudah dinilai dan berapa yang benar). Hasil yang dibuka menulis "Benar X dari Y saran", hasil per rating, dan patokannya: IHSG untuk saham .JK, S&P 500 (SPY) untuk aset lain. Provider dan model hanya tampil untuk admin.
- Yang dinilai, dan batas uji ini, ditulis di layar:
  - **Benar** berarti aset mengungguli patokannya sesudah saran beli, atau kalah darinya sesudah saran jual, walau harganya ikut turun.
  - **Ambang kebetulan.** Hasil menyebut "perlu minimal N benar dari M", yaitu jumlah benar yang dicapai tebakan (lempar koin) kurang dari 5% kali (`rightBeyondChance` di `client/src/lib/format.ts`), dan apakah hasilnya melewati ambang itu. Contohnya 10 dari 12, 15 dari 20, atau 26 dari 40.
  - **Ingatan model.** Data per tanggal dikunci, tapi model AI dilatih dengan data yang lebih baru, jadi untuk tanggal lama ia mungkin sudah tahu kelanjutannya.
  - **Data yang lebih sedikit.** Berita dan media sosial untuk tanggal lama umumnya tidak tersedia, dan laporan keuangan saham IDX tidak dibaca. Jadi AI di uji ini membaca lebih sedikit daripada analisa hari ini.
  - **Bukan uji trading.** Tidak ada entry, stop loss, target, biaya, atau saldo. Aturan trading dengan biaya diuji di tab Indikator.

### Indikator yang dibaca AI (Riset AI dan Uji saran AI)

- Form **Analisa** di Riset AI (di pratinjau dilipat menjadi satu baris pengaturan dengan tombol Ubah) dan form **Uji saran AI** punya pilihan "Indikator yang ikut dibaca AI". Pilihannya sampai 3 indikator dari daftar Indikator (bawaan, terbitan admin untuk paketnya, buatan sendiri), dengan satu timeframe candle: 15 menit, 1 jam, atau harian.
  - Yang terpilih di awal adalah indikator yang sedang tampil di chart, dengan timeframe chart. Uji saran AI mulai dari harian.
  - PoB BYSTRA tidak punya setup harian, jadi dibaca dari candle 1 jam.
- **Server** (`server/src/readings.ts`) memeriksa tiap indikator terhadap hak akun, lalu menyalinnya ke request.
  - Mesin bawaan disalin dengan pengaturan Scalper akun dari chart; skrip disalin beserta kodenya saat itu. Jadi semua sel satu uji membaca kode yang sama.
  - API tidak pernah mengirim balik kode dan pengaturan itu (`publicRequest`). Riwayat, laporan, dan hasil uji hanya menyebut nama dan timeframe-nya.
- **Worker** (`worker/readings.py`) menghitung tiap indikator sebelum engine mulai.
  - Candle dimuat sekali per aset dan timeframe lewat `server/src/script-cli.ts`. Sumbernya sama dengan Uji indikator: Binance untuk kripto, Yahoo untuk lainnya.
  - Candle dipotong di tiap tanggal analisa, jadi bacaan di tanggal lampau tidak melihat candle sesudahnya. Panjang jendelanya: 15 menit sebulan, 1 jam setahun, harian dua tahun.
  - Mesin bawaan berjalan seperti di agent chart; skrip berjalan di sandbox chart.
- **Hanya Market Analyst** yang menerima hasilnya, bersama konteks instrumennya. Ia diminta menyebut apa kata tiap indikator per tanggal itu dan memberi tiap indikator satu baris di tabel laporannya. Agen lain membaca laporan itu.
  - Engine tidak diubah: worker membungkus `create_market_analyst` di prosesnya sendiri ([ADR 0017](../docs/adr/0017-ai-membaca-indikator-pilihan.md)).
  - Admin yang mematikan Market Analyst di Pengaturan analisa tidak bisa memakai indikator; server menolak request seperti itu.
- **Log** analisa menulis apa yang dibaca, misalnya "Indikator yang dibaca AI untuk BTC-USD, dari candle sampai …". Untuk uji saran AI, log menulis berapa sel yang terbaca per indikator.
  - Indikator yang gagal dihitung (candle belum ada, skrip error) disebut beserta alasannya, dan analisanya jalan terus tanpa indikator itu.

### Pantauanku (analisa terjadwal) dan Telegram

Klik bintang di kepala chart atau di daftar pasar untuk memasukkan simbol ke Pantauanku, yang dianalisa terjadwal (sebanyak batas paket; server menyimpannya sebagai watchlist). Tab **Pantauanku** di Pantau menampilkan kartu per simbol (garis harga sebulan, harga, dan keputusan AI terakhir, yang tetap tampil walau analisa sesudahnya gagal; analisa yang gagal diberi tanda dengan **Coba lagi** dan **Lihat log**), lalu kartu jadwal: jam, hari bursa pekan ini, yang dibaca AI, status Telegram dengan **Kirim tes**, dan **Jalankan sekarang** beserta biayanya. Mengeluarkan simbol langsung terjadi dan bisa diurungkan.

- Setiap hari `WATCH_DAYS` (default Sen–Jum) pukul `WATCH_TIME` WIB (default 16.30), server menjalankan satu analisa per simbol dengan model default server (`TRADINGAGENTS_*`), analis `WATCH_ANALYSTS`, dan kedalaman `WATCH_DEPTH`. Kalau server baru menyala lebih dari 3 jam setelah jadwal, putaran hari itu tidak dikejar.
- Analisanya analisa biasa: masuk antrean, tampil di Riwayat, dan memakai kuota harian. Simbol yang tidak muat di sisa kuota dilewati dan disebut di pesan.
- Setelah semua selesai, satu pesan berjudul "Analisa harian <tanggal>" dikirim ke Telegram: rating tiap simbol, cuplikan Executive Summary, dan tautan ke laporannya (`PUBLIC_URL`). Server butuh `TELEGRAM_BOT_TOKEN` (dari @BotFather), dan tiap akun mengisi chat ID-nya di Profil → Notifikasi; tanpa itu analisa tetap jalan, hanya tanpa pesan. Watchlist, jadwal, dan pesannya per akun.
- Satu putaran per hari dicatat di tabel `watch_runs`, jadi dua instance server tidak menjalankannya dua kali.

API: `GET /api/watchlist` (tiap simbol dengan `last`, percobaan analisa terakhir, dan `decision`, analisa selesai terakhir yang punya rating), `POST /api/watchlist {symbol, tvSymbol}`, `DELETE /api/watchlist/:symbol`, `POST /api/watchlist/run`, `POST /api/watchlist/test`.

### Notifikasi sinyal (Telegram)

Di chart Keputusan AI, tombol **Notifikasi** menyalakan pesan Telegram per simbol untuk PoB BYSTRA (15m, 1j), Scalper Pro+ (15m) dan Fib Golden Zone (15m, 1j, harian), sebanyak batas notifikasi paket (Gratis 3, Pro 15, Creator 50), yang dipakai bersama notifikasi harga. Menyambungkan Telegram cukup sekali tekan: **Sambungkan Telegram** (Profil → Notifikasi, juga di Beranda) membuka bot dengan tautan sekali pakai yang berlaku 15 menit; menekan Start di bot menautkan chat itu ke akun (`POST /api/me/telegram/link`; instance pemimpin membaca pesan bot lewat `getUpdates`, tanpa webhook, `server/src/telegram.ts`, [ADR 0013](../docs/adr/0013-telegram-sekali-tekan-long-polling.md); bot yang pernah diberi webhook, atau server lain yang memakai token yang sama, membuat penautan gagal). Chat ID tetap bisa diisi sendiri, misalnya ID grup (angka negatif) bila bot dimasukkan ke grup. Memakai bot dan chat ID yang sama dengan analisa terjadwal. Semua notifikasi akun, harga dan sinyal, terkumpul di Pantau → **Alert**, dikelompokkan per aset dan bisa disaring (Berjalan, Kena TP, Kena SL), dengan sakelar Publik (Creator) dan tombol hapus yang meminta konfirmasi; yang baru tetap dipasang dari tombol Notifikasi.

Beranda menghitung **call**: sinyal yang keluar live dari notifikasi (terkirim, atau mestinya terkirim bila Telegram belum diatur), bukan riwayat yang dicatat diam-diam saat notifikasi baru dinyalakan. R dihitung dari yang diselesaikan mesin dengan pasti: TP = jarak target dibagi jarak stop, SL = −1. Sejak migrasi 0032, call skrip menyimpan R dari runtime-nya (`signal_events.r`): dua target dihitung sebagian di TP1 dan sisanya di TP2, dan SL yang dilompati di harga buka. Call yang kena TP1 lalu titik impas atau SL (**Kena TP1**) dihitung selesai dan masuk R. Keluar karena kondisi, kedaluwarsa, dan order yang tidak terisi dihitung sebagai call tetapi tidak masuk R, karena harga keluarnya tidak disimpan atau tidak pernah ada trade. Riwayat tetap ada setelah notifikasinya dihapus (sejak migrasi 0025 tiap sinyal membawa pemilik dan pasangannya sendiri); sinyal yang saat itu masih berjalan ditandai "tidak dipantau lagi". API: `GET /api/alerts/history?days=7|30|90|365` (angka, kurva, per indikator dan per aset, 8 call terbaru, dan semua call yang masih berjalan) dan `GET /api/alerts/calls?days=&status=all|open|win|loss|other&symbol=&indicator=&timeframe=&since=&before=&limit=` (Riwayat call: satu halaman dengan kursor `next`, jumlah per hasil, dan total per hari WIB).

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
- **Catatan:** level yang terpicu tetap tersimpan (waktu dan harga), dan bisa dihapus setelah konfirmasi. Level yang masih menunggu langsung terhapus, dengan **Urungkan** di baris bawah kotak harga untuk memasangnya lagi.
- **Jatah:** level aktif memakai jatah notifikasi paket bersama notifikasi sinyal. Kalau paket turun, notifikasi sinyal didahulukan dan level terbaru dijeda.

API:
- `GET /api/price-alerts?symbol=`: daftar level, jumlah terpakai, batas paket, dan status Telegram/email.
- `POST /api/price-alerts {symbol, tvSymbol, price, label?}`: menolak harga yang sama dengan harga sekarang dan level di atas batas paket; level yang sama dikembalikan apa adanya.
- `DELETE /api/price-alerts/:id`.

### Jurnal trading (Pantau → Jurnal)

Catatan trade yang benar-benar diambil, supaya trader bisa melihat apa yang berhasil dan dalam suasana hati apa (`server/src/journal.ts`, keputusan desainnya di [ADR 0014](../docs/adr/0014-jurnal-ditutup-dari-candle-15m.md)).

- **Mencatat:** tombol **Saya ambil** di kartu Rencana trading chart membuka form kecil: harga masuk (terisi entry rencana, bisa diubah), catatan, dan perasaan saat masuk (Tenang, Yakin, Ragu, FOMO, Takut, Balas dendam; boleh dikosongkan). SL, TP, sumber ("Scalper Pro+ 15m"), dan uang yang dipertaruhkan (dari kalkulator ukuran posisi bila sedang terbuka) ikut tersimpan. Call sinyal yang masih berjalan di Beranda (Sedang berjalan) punya tombol Saya ambil yang sama, dengan level call itu. Trade juga bisa diisi sendiri di tab Jurnal untuk aset yang sedang dibuka.
- **Ditolak bila:** SL dan TP tidak di sisi yang benar (Beli: SL di bawah entry, TP di atasnya; Jual sebaliknya), atau harga sekarang sudah melewati SL atau TP.
- **Selesai otomatis:** tiap menit, bersama notifikasi harga dan dari candle 15m yang sama, trade berjalan ditutup di TP (untung) atau SL (rugi) kalau high/low candle setelah trade dicatat, atau harga terbaru, menyentuhnya. Candle yang menyentuh keduanya dihitung kena SL, karena urutan di dalam candle tidak diketahui. Penutupan memakai satu update bersyarat, jadi tidak pernah dobel walau ada dua instance. Pemilik Telegram yang terhubung dikabari sekali.
- **Kamu tutup atau tidak jadi:** trade berjalan bisa ditutup di harga tertentu (terisi harga sekarang), atau ditandai "Tidak jadi" (tidak dihitung di hasil; meminta konfirmasi). Kartunya menunjukkan jalur SL–entry–TP dengan harga sekarang dan seberapa jauh menuju TP atau SL. Menghapus trade selesai juga meminta konfirmasi.
- **Hasil dalam R** (risiko satu trade, jarak entry ke SL): TP memberi jarak TP dibagi jarak SL, SL memberi −1R. Tab Jurnal merangkum 7/30/90 hari: jumlah selesai, persentase untung, total dan rata-rata R, per perasaan dan per sumber, beserta rupiahnya bila ukuran posisi ikut tersimpan. Beranda menampilkan ringkasan 30 hari dan trade yang masih berjalan.
- **Rekap mingguan:** mulai Minggu pukul 19.00 WIB, anggota dengan Telegram terhubung yang mencatat atau menutup trade pekan itu mendapat rekap (sejak Senin 00.00 WIB): selesai, untung, total R, terbaik dan terburuk, per perasaan, dan perasaan yang paling merugikan bila terjadi lebih dari sekali. Klaimnya di tabel `notices`, jadi terkirim sekali per pekan.
- **Jatah:** trade berjalan sekaligus dibatasi paket (`journal` di `shared/plans.ts`: Gratis 10, Pro 50, Creator 100), karena pemeriksa harga mengikuti semuanya. Trade yang sudah selesai tidak dibatasi.

API:
- `GET /api/journal?days=`: trade berjalan, trade yang dibuka atau selesai dalam `days` hari (bawaan 30), ringkasannya, batas paket, dan status Telegram.
- `POST /api/journal {symbol, tvSymbol, side, entry, stopLoss, takeProfit, source?, label?, mood?, note?, riskIdr?}`.
- `PATCH /api/journal/:id {mood?, note?, close?: {price}, cancel?: true}`: menutup atau membatalkan hanya trade yang masih berjalan.
- `DELETE /api/journal/:id`.

### Kripto multi-bursa (tombol Bursa di chart)

- Harga kripto dari 9 bursa lewat CCXT di server (`server/src/venues.ts`): Binance, Bybit, OKX, Coinbase, Kraken, Bitget, KuCoin, Gate, dan Indodax (rupiah). Server yang mengambil datanya, karena banyak bursa diblokir ISP di Indonesia.
- Tombol "Bursa" di chart membuka harga semua bursa secara real-time (WebSocket tiap bursa, Indodax lewat REST tiap 3 detik), selisih terhadap median, spread bid-ask, dan umur data. Klik bursa untuk memakai candle-nya di chart, indikator, skrip, dan panel TradingView (simbol berganti, misalnya `BYBIT:BTCUSDT`).
- Riwayat candle per bursa berbeda: Kraken hanya 720 candle terakhir, Indodax sekitar 9 hari candle 15m. Lab bisa memilih bursa untuk simbol kripto; notifikasi dan buku catatan juga bisa per bursa (lihat bagian masing-masing).
- Gambar agent (dalam dolar) disembunyikan pada bursa rupiah.

### Uji indikator (kartu Uji di Uji strategi → Indikator, dulu Lab)

- Satu kartu dengan dua tab (`LabCard.svelte`). **Uji baru** menguji indikator yang dipilih di daftar dalam dua langkah: aset (dipilih dari pencari aset, bukan diketik kodenya), lalu timeframe dengan periodenya. Biaya, bagian data uji, kedaluwarsa sinyal, dan bursa kripto ada di "Pengaturan lanjutan" dengan nilai bawaan. Di bawah tombol Jalankan uji tertulis sisa uji hari ini (`lab` di `GET /api/usage`, jendela 24 jam yang sama dengan batas server).
- **Riwayat** menampilkan uji indikator ini atau semua uji. Klik baris untuk membuka hasilnya di tab Detail indikator; uji indikator lain ikut memilih indikatornya, dan uji skrip yang sudah dihapus dibuka di bawah nama lamanya. Tiap baris punya tombol hapus. Uji yang dihapus bisa dikembalikan dengan **Urungkan** selama beberapa detik; setelah itu baru dihapus di server.
- Hasil dibuka dengan putusan (Lolos, Belum cukup data, atau Tidak lolos), lalu tiga syarat dalam urutan yang dicek server dan dari mana untung atau ruginya (sebelum biaya atau karena biaya). Sesudahnya kurva data awal lalu data uji, perbandingan keduanya, dan rincian per aset. Terakhir langkah berikutnya sesuai putusannya: pasang notifikasi dan lihat rekam jejak live bila lolos, uji periode lebih panjang atau tambah aset bila datanya kurang, timeframe lain atau indikator lain bila tidak lolos. Uji yang sedang berjalan tampil di tempat hasil itu sampai selesai.

- Uji mesin bawaan (PoB, Scalper, Fib), indikator yang diterbitkan admin, atau skrip sendiri pada riwayat panjang: kripto dari Binance (15m s.d. 1 tahun, 1j s.d. 3 tahun, 4j/harian s.d. 5 tahun), emas intraday dari XAUUSDT, lainnya dari Yahoo. Daftarnya hanya berisi yang dibuka katalog indikator untuk akun itu.
- Setiap trade dipotong biaya taker atau maker (`tradeCost` di `server/src/ledger.ts`). Untuk kripto keduanya 0,2% per trade, karena fee maker dasar Binance juga 0,1% per sisi (sebelum 1 November 2026 maker dihitung 0,05%); emas 0,40 USD; saham IDX 0,4% untuk keduanya (fee broker online umumnya sekitar 0,15% saat beli dan 0,25% saat jual, termasuk PPh final 0,1%); lainnya taker 0,10%, maker 0,05%. Riwayat dibagi: data awal untuk membentuk strategi, data uji (20/30/40% terakhir) untuk memeriksa. Strategi "lolos" hanya bila positif setelah biaya di keduanya dengan minimal 30 trade di data uji.
- **Hanya harga yang benar-benar terjadi yang dihitung** ([ADR 0023](../docs/adr/0023-uji-hanya-harga-yang-terjadi.md)). Aturan ini berlaku di runtime skrip dan di mesin bawaan, jadi juga di chart, notifikasi, dan rekam jejak live:
  - **Entry di dalam candle.** `entry` selain close candle sinyal adalah order limit atau stop yang terisi di dalam candle itu. Kalau candle itu tidak pernah menyentuhnya, sinyal dibuang dan dihitung "tidak terisi": hasil uji menyebut jumlahnya, sedangkan editor dan chart menulis "N tidak terisi". Kalau candle itu juga menyentuh SL, sinyal dihitung rugi 1R di situ.
  - **SL yang dilompati.** SL yang dilewati harga saat candle dibuka dicatat di harga pembukaan, jadi ruginya lebih dari 1R. TP tetap di harganya sendiri.
  - **Order yang menunggu** (`wait`, [ADR 0024](../docs/adr/0024-bahasa-skrip-setara-pine-dan-terjemahan-teruji.md)) terisi di candle pertama yang menyentuhnya; order stop yang dilompati terisi di harga buka. TP yang tersentuh di candle pengisi order stop ikut dihitung, karena harga lewat entry dulu; di candle pengisi order limit tidak. Lab menghitung trade skrip di candle isinya, dan order yang habis masa tunggunya masuk hitungan "tidak terisi".
  - **Sebelum 3 November 2026**, entry yang tidak tersentuh tetap dihitung terisi dan SL selalu −1R. Pada BBRI harian, misalnya, 15 dari 70 SL template Donchian ternyata dilompati.
- Mesin dijalankan worker (`worker/lab.py`, perintah `lab`), skrip di sandbox yang sama dengan chart dengan batas 30 detik. Satu uji berjalan pada satu waktu, sebanyak batas paket per 24 jam (Gratis 5, Pro 60, Creator 120), 30 hasil terakhir disimpan (`lab_runs`). Uji yang dihapus, atau tergeser dari 30 hasil itu, tetap dihitung sampai 24 jamnya lewat.
- Template skrip "Donchian breakout" dan "Trend EMA 50/200 + pullback" disediakan untuk diuji di 4j dan harian. Strategi yang lolos dicatat live di buku catatan (`LEDGER_SCRIPTS` di `ledger.ts`): saat ini Donchian breakout harian, persis seperti diuji (periode 20, SL 2 ATR, TP 4 ATR, kedaluwarsa 120 candle).

### Keluar berdasarkan kondisi (skrip)

- `signal(i, side, { sl, tp, entry, exit, maxBars, exclusive })`: `entry` (bawaannya close candle i) adalah harga isi di dalam candle i, dengan aturan di Uji indikator; `exit` adalah array boolean, posisi ditutup di close candle pertama setelah sinyal yang bernilai true (dicek setelah SL dan TP); `maxBars` menutup posisi setelah sekian candle; `exclusive: true` berarti satu posisi sekaligus.
- Hasil baru `exit` (keluar oleh kondisi) tampil di chart, editor, notifikasi, Lab dan buku catatan. Win rate di buku catatan dan Lab dihitung dari trade yang untung setelah biaya, bukan dari TP yang tersentuh; jumlah TP dan SL tetap ditampilkan terpisah.
- Template "RSI(2) pullback" dan "Bollinger revert" (mean reversion: beli saat harga terlalu jauh di bawah rata-rata dalam tren naik, keluar saat kembali ke rata-rata). Di Lab, RSI(2) harian pada S&P 500 menang 78-80% dengan hasil positif setelah biaya, tetapi baru 43 trade dalam 5 tahun.

### Bahasa skrip setara Pine

Bahasa skrip (`shared/script.ts`) memuat yang dipakai skrip Pine pada umumnya ([ADR 0024](../docs/adr/0024-bahasa-skrip-setara-pine-dan-terjemahan-teruji.md)). Panduan lengkapnya ada di tab **Panduan** editor skrip (`shared/script-guide.ts`): cara skrip berjalan, langkah membuat indikator, kamus Pine ke skrip, dan referensi bahasa.
- **Order yang menunggu.** `signal(i, side, { entry, wait: N })` memasang order stop atau limit sesudah candle i tutup, berlaku N candle. Yang tidak terisi tercatat `unfilled`.
- **Dua target.** `tp: [tp1, tp2]` dengan `size` (bagian yang ditutup di tp1, bawaan 0,5) dan `breakeven` (SL ke harga isi mulai candle sesudah tp1, bawaan nyala). Hasilnya `win`, `partial` (tp1 lalu SL atau titik impas), atau `loss`.
- **Waktu.** `timeframe` (menit per candle), `epoch`, `mintick`, `hour/minute/dayofweek(i, tz)`, dan `session("1500-1900", "Asia/Jakarta")`, dengan zona bursa candle dari pemanggil (`exchangeTimezone`).
- **Timeframe lebih tinggi.** `htf(menit)` dari candle chart, dengan `closed()` (seperti `request.security` dengan `[1]` dan `lookahead_on`) dan `value()`.
- **ta.\*** dihitung seperti Pine (rma, atr dan rsi diawali SMA), ditambah `dmi`, `supertrend`, `barssince`, `valuewhen`, `linreg`, `obv`, `vwap`, dan lainnya.
- **Gambar.** `line()` dan `label()` beserta `lineSet`/`labelSet`/`lineDelete`/`labelDelete`. Chart menggambarnya, termasuk garis yang mulai sebelum candle pertama yang tampil atau berakhir sesudah candle terakhir. Lewat 500, yang paling lama dihapus.
- **Chart.** Order yang masih menunggu digambar putus-putus, dan TP1 dan TP2 digambar terpisah. SL pindah ke titik impas sesudah TP1 kena. Order yang tidak terisi ditandai titik abu-abu. Kartu Rencana menyebut order dan TP1-nya.
- **Template "Trendline Rejection (dari Pine)".** Terjemahan penuh skrip Pine "Trendline Rejection Scalper". Diuji candle demi candle terhadap jalannya Pine di BTC, ETH dan PAXG 15 menit serta BTC 1 jam: sinyal, skor, entry, SL, TP, candle isi, dan candle keluar sama di 39 trade; R hanya beda saat harga melompat.

### Indikator (Uji strategi → Indikator)

Indikator saya dan Uji indikator digabung menjadi satu tab ([ADR 0020](../docs/adr/0020-indikator-dan-uji-satu-layar.md), `IndicatorsView.svelte`). Isinya tiga kolom:
- **Kiri, daftar indikator** (`IndicatorList.svelte`): kotak cari, menu Indikator baru, lalu tiga kelompok:
  - **Bawaan**, termasuk Donchian yang hanya bisa diuji;
  - **Dari admin**, yang diterbitkan admin untuk paketnya;
  - **Buatan saya**.

  Tiap baris menyebut apakah tampil di chart, berapa notifikasinya, dan hasil uji terakhirnya (Lolos, Tidak lolos, Belum cukup data, Belum diuji).
- **Tengah, indikator yang dipilih**, dengan sakelar **Tampil di chart** (chart Pasar dan Riset AI) dan dua tab:
  - **Detail indikator** berisi beberapa bagian:
    - hasil uji terbaru, atau uji yang dibuka dari Riwayat;
    - **Sinyal nyata**: rekam jejak live untuk mesin bawaan dan notifikasi yang terpasang;
    - **Kelola**: buatan sendiri bisa diedit dan dihapus. Hapus meminta konfirmasi yang menyebut notifikasi sinyal yang ikut berhenti; riwayat ujinya tetap tersimpan. Bawaan dan dari admin tidak bisa dihapus di sini: sembunyikan dari chart, atau admin menonaktifkannya di Konsol admin → Indikator.
  - **Chart pasar** (`IndicatorChart.svelte`): chart aplikasi yang hanya menggambar indikator itu (`DecisionChart` dengan prop `only`), di aset yang sedang fokus. Detailnya:
    - Ganti aset lewat chip (aset terakhir dibuka dan aset di form uji) atau **Aset lain** (pencari aset), tanpa meninggalkan halaman.
    - PoB BYSTRA dan Fib Golden Zone yang hanya digambar di sebagian timeframe menyebutnya, dengan tombol untuk pindah.
    - Notifikasi dipasang dari tombol **Notifikasi** di atas chart.
    - **Tambah … ke uji** memasukkan aset itu ke form uji.
    - Hitungan di chart tanpa biaya; halaman menunjuk kartu Uji untuk angka yang bisa dipercaya.
- **Kanan, kartu Uji** (lihat Uji indikator di atas).

Mulai 80rem ketiganya berdampingan. Antara 64 dan 80rem kartu Uji turun ke bawah daftar. Di ponsel daftar tampil dulu, lalu indikatornya dengan tab Detail, Chart pasar, dan Uji. Indikator yang dipilih adalah strategi form uji (`lab.strategy`), jadi tombol "Uji" di Rekam jejak live membuka tab ini pada mesin itu. Tautan lama `#/uji?dock=library` dibuka di tab ini.

- Indikator baru dibuat dari menu **Indikator baru** dengan empat cara: dari template, dari kode Pine TradingView (diterjemahkan AI), dari prompt (lihat di bawah), atau ditulis sendiri.
  - Editor skrip bisa dibuka dari layar mana pun, dan memuat sendiri pilihan model AI-nya. Sebelumnya editor yang dibuka dari Uji strategi menyebut "Model AI belum diatur" sampai Riset AI pernah dibuka.
  - Di sisi kiri editor, nama skrip dan template tersusun rata kiri; nama panjang turun ke baris berikutnya.

### Terjemahan Pine (editor skrip → Dari Pine)

Skrip Pine Script TradingView menjadi skrip aplikasi (`POST /api/scripts/translate`, [ADR 0024](../docs/adr/0024-bahasa-skrip-setara-pine-dan-terjemahan-teruji.md)):
1. **Terjemahan.** AI membaca referensi bahasa, kamus Pine (`shared/script-guide.ts`, sama dengan tab Panduan), dan terjemahan penuh Trendline Rejection sebagai contoh. AI menjawab dengan kode dan laporan: apa yang **dibawa**, **diubah**, dan **dibuang**.
2. **Uji di server** (`server/src/script-check.ts`), pada candle chart yang terbuka (tanpa chart: BTC-USD 1 jam). Draf harus:
   - jalan dalam waktu chart;
   - menghasilkan sinyal, plot, garis, atau label;
   - tidak menaruh sebagian besar entry di luar candle sinyal tanpa `wait`;
   - tidak membaca candle sesudah sinyal. Ini diperiksa dengan menjalankan ulang skrip pada candle sampai beberapa sinyalnya, dengan candle berikutnya dibuat datar; sinyal dan plot yang sudah tutup harus sama.
3. **Perbaikan.** Masalah yang ditemukan dikirim balik ke AI, paling banyak 2 kali.

Editor menampilkan langkahnya selagi berjalan (bisa dihentikan), lalu panel **Hasil AI** di bawah kode: lolos uji atau masalah yang tersisa, berapa kali diperbaiki, dan laporannya.
- Jawaban rute ini (juga `/plan` dan `/compose`) berupa stream server-sent events, dengan ping tiap 15 detik supaya Cloudflare tidak memutusnya.
- Satu panggilan model paling lama `TA_TRANSLATE_LLM_TIMEOUT` detik.
- Worker demo menjawab dengan draf tetap bila `TA_DEMO_PINE=1` (dipakai tes): draf pertama sengaja membaca candle sesudah sinyal, lalu perbaikannya. Tanpa itu, Pine tetap ke penerjemah sungguhan.

### Indikator dari prompt (editor skrip → Dari prompt)

Prompt analisa atau aturan strategi dalam kata-kata menjadi skrip lewat dua langkah, masing-masing satu pesan dari kuota chat harian.

1. **Rencana skrip** (`POST /api/scripts/plan`). AI memilah teksnya menjadi tiga daftar:
   - **Akan dikodekan:** aturan yang bisa dihitung dari harga, tiap aturan dengan angka utamanya.
   - **Diubah supaya bisa diuji:** misalnya lebih dari dua target menjadi dua; order limit atau stop tanpa batas waktu diberi masa tunggu; trailing stop menjadi SL tetap; timeframe di bawah 15 menit menjadi 15 menit.
   - **Tidak bisa jadi skrip:** misalnya format laporan analis, penilaian, berita, ukuran posisi, dan membaca screenshot; masing-masing dengan alasannya.

   Pengguna mencentang aturan yang dipakai.
2. **Skrip** (`POST /api/scripts/compose`). AI menulis skrip dari aturan yang dicentang, dengan teks aslinya sebagai konteks. Server menguji dan meminta perbaikannya seperti terjemahan Pine, lalu editor mengujinya di chart. Nama skrip baru diambil dari baris pertama prompt.

Batasnya:
- Prompt 20 sampai 20.000 huruf, dan paling banyak 30 aturan dikirim.
- Rencana dibatasi 20 aturan, 10 perubahan, dan 10 hal yang tidak bisa (`web/worker/script_translate.py`).
- Anggota memakai model bawaan server. Hasilnya draf: periksa kode dan hasil ujinya sebelum disimpan.
- Worker demo (`dev:demo`, tes) menjawab kedua langkah dengan contoh tetap, tanpa model.
- Jumlah indikator buatan sendiri mengikuti paket (`scripts` di `shared/plans.ts`).
- Indikator yang sama bisa dibaca AI saat Riset AI dan Uji saran AI (lihat "Indikator yang dibaca AI").

### Rekam jejak live (Uji strategi → Rekam jejak live, dulu Strategi live)

- Di kiri daftar **Mesin bawaan** (Semua mesin dan tiap mesin, dengan total R dan rata-rata per sinyal setelah biaya) dan **Notifikasi sinyalku**: sinyal dari notifikasi akun itu dalam periode yang sama, dinilai dari target dan stop-nya (sebelum biaya, dari `GET /api/alerts/history`). Mesin yang dipilih terbuka di kanan dengan satu putusan ("Rugi −40,2R" berikut jumlah sinyal, persentase untung, dan rata-rata per sinyal setelah biaya), jarak ke 100 sinyal selesai (sebelum itu hasilnya sementara), apakah biaya yang membuat rugi, kurva R kumulatif setelah biaya, **Riwayat dibanding live** (uji terakhir mesin itu di tab Indikator di samping rekam jejak live-nya), angka utama, pengelompokan per mesin, aset, timeframe, sesi, atau bursa, dan sinyal terbaru 20 sekaligus. "Apa arti angka ini?" menjelaskan R, untung, rata-rata per sinyal, sebelum biaya, turun terdalam, dan sumber harga.

- Setiap sinyal mesin bawaan (PoB 15m/1j, Scalper 15m, Fib 15m/1j/harian) pada `SIGNAL_LEDGER_SYMBOLS` (default BTC-USD, ETH-USD, GC=F) dicatat sekali saat lahir, beku, lalu dinilai saat candle berikutnya tutup, oleh pemindai yang sama dengan notifikasi.
- Akun simulasi `SIGNAL_PAPER_BALANCE` (10.000 USD), risiko `SIGNAL_PAPER_RISK_PCT` (1%) per sinyal, dikurangi biaya pulang-pergi: kripto 0,2% (fee taker dasar Binance 0,1% saat masuk dan keluar; slippage belum termasuk), emas 0,40 USD, saham IDX 0,4%, lainnya 0,10%; ubah per simbol lewat `SIGNAL_COSTS`.
- SL yang dilompati harga (candle dibuka melewati SL, misalnya emas setelah jeda akhir pekan) dicatat di harga pembukaan, jadi ruginya bisa lebih dari 1R. Aturan ini berlaku untuk sinyal yang selesai sejak 3 November 2026; sinyal yang sudah selesai sebelumnya tetap dengan R yang tersimpan.
- Kripto memakai candle real-time Binance (`server/src/binance.ts`, dan `chart_agent.py` dengan jendela yang sama), jadi chart, notifikasi, agent dan ledger membaca candle yang sama. Emas 15m/1j/4j memakai kontrak perpetual XAUUSDT Binance (real-time; candle saat spot emas tutup, yaitu jeda harian 17:00-18:00 New York dan akhir pekan, dibuang). Selisihnya terhadap futures COMEX rata-rata sekitar 3-4 USD. Emas harian tetap dari Yahoo.
- Saat pertama menyala, ledger mengisi riwayat dari candle lama (ditandai "riwayat", di luar statistik live). Sinyal yang terlihat lebih dari `SIGNAL_STALE_BARS` candle terlambat juga dianggap riwayat.
- Kripto juga dicatat di bursa `SIGNAL_LEDGER_VENUES` (default `binance,bybit,okx,indodax`), masing-masing dari candle bursanya sendiri, sebagai pembanding. Akun simulasi, kurva ekuitas, dan total rekap tetap memakai Binance supaya satu sinyal tidak terhitung berkali-kali. Rekam jejak live punya pilihan Bursa dan pengelompokan Per bursa; rekap Telegram menambahkan baris "Kripto per bursa".
- Tab "Per bursa" bisa beralih ke biaya nyata: fee taker dasar tiap bursa (Binance, Bybit, OKX 0,1%; Indodax 0,2% dari API-nya) dibayar saat masuk dan keluar, dihitung ulang dari entry dan SL yang tersimpan, tanpa diskon VIP atau token; slippage dan pajak kripto belum termasuk. Fee bursa lain, atau koreksi, lewat `SIGNAL_VENUE_FEES` (per sisi, misalnya `{"gate": 0.002}`).
- Sampai 1 November 2026 biaya kripto diasumsikan 0,12%; biaya sinyal lama dihitung ulang ke 0,2% dari entry dan SL masing-masing (migrasi `0013_crypto_cost`), dan Lab memakai biaya taker yang sama.
- Biaya default sama di semua bursa (0,2%) supaya yang dibandingkan hanya harganya. Biaya nyata satu bursa diatur lewat `SIGNAL_COSTS` dengan kunci `SIMBOL@bursa`, misalnya `{"BTC-USD@indodax": {"pct": 0.006}}` untuk taker Indodax 0,3% per sisi (angka bawaan CCXT; biaya `abs` dalam mata uang bursa itu).
- Rekap harian ke Telegram pukul `SIGNAL_RECAP_TIME` WIB (05:15, setelah New York tutup), mingguan tiap Sabtu; dikirim ke admin dan pengguna yang punya notifikasi. Admin bisa mengirim rekap tes dari Konsol admin → Status layanan → Tes pesan.
- Emas harian dari Yahoo (futures `GC=F`) bisa tertunda beberapa menit.
- Rekam jejak tampil di tempat trader memilih: di menu Indikator dan Notifikasi chart, tiap mesin bawaan diberi satu baris, misalnya "15m: 58% untung bersih · rata-rata +0,12R · 120 sinyal" (sinyal live 90 hari di sumber default, setelah biaya; "untung bersih" berarti hasilnya di atas nol setelah biaya). Kurang dari 10 sinyal selesai ditulis "belum cukup untuk dinilai". Kartu Rencana trading menampilkan rekam jejak mesin rencana itu, hanya bila timeframe-nya sama, dengan menyebut simbol yang dihitung. Bila simbol di chart termasuk yang dicatat dan punya cukup sinyal, rekam jejak simbol itu yang dipakai. Kaki menu menjelaskan R (risiko satu trade, jarak entry ke SL).

API: `GET /api/alerts`, `POST /api/alerts {symbol, tvSymbol, indicator, timeframe}` (bursa diambil dari `tvSymbol`), `DELETE /api/alerts/:id`, `POST /api/alerts/test`, `GET /api/ledger?days=&history=&venue=&symbol=&source=`, `GET /api/ledger/record` (rekam jejak per mesin dan timeframe, 90 hari, total dan per simbol).

### Chart dan harga dari TradingView

Chart, ticker tape, daftar harga dan screener memakai [widget gratis TradingView](https://www.tradingview.com/widget-docs/). Menurut [FAQ data TradingView](https://www.tradingview.com/widget-docs/faq/data/), crypto dan forex realtime; saham (termasuk IDX) tertunda sekitar 15 menit, dan paket berbayar TradingView tidak mengubah data di widget.

- Widget hanya menampilkan data TradingView, jadi tidak bisa diberi penanda hasil analisa AI.
- Engine menganalisa dengan data harian Yahoo Finance; angka di chart bisa sedikit berbeda.
- Widget gratis tidak menyajikan futures bursa (`COMEX:GC1!`) atau sebagian feed indeks (`SP:SPX`, `TVC:DJI`). Komoditas dan indeks memakai simbol CFD yang tersedia: emas `OANDA:XAUUSD` (engine: `GC=F`), S&P 500 `FOREXCOM:SPXUSD` (engine: `^GSPC`), dan seterusnya.
- Pemetaan simbol Yahoo ↔ TradingView ada di `client/src/lib/tv.ts`, bersama daftar simbol tiap tab dan ticker tape. Tambah baris di sana untuk simbol baru, lalu cek simbolnya memang tampil di widget.
- Kepala chart (Pro dan Pemula) menampilkan status sesi pasar dalam WIB, misalnya "IDX buka · tutup 12.00 WIB", "IDX istirahat siang", "Bursa AS tutup · buka 21.30 WIB", atau "Kripto · 24 jam" (`client/src/lib/sessions.ts`): IDX dengan istirahat Jumat yang lebih panjang, bursa AS pada jam New York (jadi ikut bergeser saat daylight saving), forex dan emas dari Minggu sore sampai Jumat sore New York (emas dengan jeda satu jam tiap hari). Hari libur bursa belum dihitung, jadi hari libur tetap tertulis buka.

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

Server memakai `worker/demo_worker.py`, yang memutar ulang analisa tiruan dengan format event yang sama. Cocok untuk mengerjakan UI. Indikator yang dipilih tetap dihitung sungguhan (butuh internet untuk candle) dan dikutip di laporan Market Analyst tiruan.

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
- **Verifikasi email:** tautan sekali pakai (24 jam). Sebelum terverifikasi, analisa AI, chat agent, dan watchlist terjadwal belum jalan; setelahnya trial Pro 7 hari aktif, sekali per akun. Masuk dengan Google langsung terverifikasi. Lupa kata sandi: tautan 1 jam, dan mengatur ulang mengeluarkan semua sesi lain. Tanpa SMTP tautan tidak terkirim: halaman Lupa kata sandi tidak menjanjikan tautan, melainkan menyuruh menghubungi admin (WhatsApp atau email dari `shared/brand.ts` bila diisi) yang membuat kata sandi sementara di Konsol admin → Pengguna; pendaftar diberi tahu bahwa akunnya menunggu verifikasi admin (juga oleh pesan server saat mencoba analisa, Tanya AI, atau analisa harian), Konsol admin → Ringkasan menghitung akun yang menunggu, dan **verifikasi manual** di Pengguna langsung mengaktifkan trial Pro.
- **Email** lewat SMTP penyedia apa pun (`SMTP_URL`, `MAIL_FROM`). Tanpa SMTP tidak ada email yang terkirim (log menyebut penerima dan judulnya; `MAIL_LOG=1` menulis isinya, untuk pengembangan saja), dan admin bisa menandai email terverifikasi di Konsol admin → Pengguna.
- **Konsol admin** (`/app#/admin`, menu akun → Konsol admin; hanya admin) memisahkan pekerjaan admin dari layar trading. Isinya sepuluh halaman: Ringkasan (angka bisnis dan daftar "Perlu tindakan": pembayaran menunggu dan layanan yang belum diatur atau bermasalah), Pengguna, Aktivitas, **Analisa & backtest** (seratus terakhir dari semua akun, dengan akun dan alasan gagal), Pembayaran, Kupon, Indikator, **Pengaturan analisa** (tim analis, kedalaman, bahasa, provider, model, dan backend URL untuk analisa, uji saran AI, dan Tanya AI yang dijalankan admin; disimpan di browser itu), Status layanan (termasuk Tes pesan: rekap sinyal tes ke Telegram admin), dan Pengaturan server. Pengaturan server hanya bisa dibaca: isinya apa yang sudah aktif dan nama variabelnya, tanpa kunci atau alamat backend (`GET /api/admin/config`). Anggota tidak melihat menu ini, dan anggota yang membuka `#/admin` dibawa ke aplikasi. **Peran:** layar trading tampil sama untuk member dan admin; semua kontrol admin hanya ada di Konsol, dan nama variabel server tidak tampil di layar trading ([ADR 0016](../docs/adr/0016-peran-member-dan-admin.md)).
- **Admin** membuat akun di Konsol admin → **Pengguna**: nama pengguna, kata sandi awal, peran (anggota/admin). Di sana juga: paket dan masa berlakunya, verifikasi email manual, nonaktifkan/aktifkan, reset kata sandi, ubah peran, dan kuota harian per orang (kosong = kuota paketnya). Admin tidak bisa menonaktifkan atau menurunkan dirinya sendiri, dan selalu harus ada satu admin aktif.
- **Data pribadi per akun:** riwayat analisa dan backtest, marker keputusan, sesi chat agent, memori, gambar di chart, skill, watchlist. Admin bisa melihat riwayat semua akun di Konsol admin → **Analisa & backtest** dan membuka laporannya; chat, memori, dan skill tetap pribadi, termasuk dari admin.
- **Tetap bersama:** memori keputusan engine TradingAgents (satu file log di engine yang dipakai agent untuk belajar dari keputusan lama).
- **Kuota:** tiap akun mengikuti paketnya (atau kuota khusus dari admin), dan `DAILY_TOTAL_ANALYSIS_LIMIT` / `DAILY_TOTAL_CHAT_LIMIT` membatasi semua akun bersama. Analisa yang terhenti karena worker atau server berhenti (restart, deploy) tidak dihitung, dan uji saran AI yang gagal atau dibatalkan dihitung sebanyak sel yang sudah jalan. Menghapus riwayat tidak mengembalikan kuota: analisa, uji saran AI, sesi Tanya AI, dan uji indikator yang dihapus tetap dihitung di harinya (tabel `spent_quota`, dibersihkan setelah dua hari).
- **Sesi:** kata sandi diganti atau akun dinonaktifkan → semua sesi akun itu langsung berakhir (browser yang mengganti kata sandinya tetap masuk).
- **Verifikasi dua langkah:** tiap akun bisa menyalakannya di Profil → Keamanan dengan aplikasi authenticator (TOTP sesuai RFC 6238: pindai kode QR, lalu ketik satu kode). Setelah itu kata sandi, Google, dan tautan atur ulang kata sandi hanya menghasilkan tiket 10 menit untuk langkah kode; tiap kode berlaku sekali. Delapan kode pemulihan ditampilkan sekali untuk ponsel yang hilang (yang disimpan hanya hash-nya) dan bisa dibuat ulang dengan kode dari aplikasi. Kode salah juga dihitung per akun, maksimal 10 per 15 menit. Menyalakannya mengeluarkan browser lain. Admin bisa mematikannya di Konsol admin → Pengguna untuk anggota yang kehilangan ponsel sekaligus kode pemulihannya (`server/src/totp.ts`).
- **Telegram:** satu bot untuk server (`TELEGRAM_BOT_TOKEN`); tiap akun mengisi chat ID-nya sendiri di Profil → Notifikasi dan menerima ringkasan analisa hariannya sendiri.
- **Tanpa `APP_PASSWORD`** (pengembangan lokal) tidak ada login: semua permintaan dianggap admin pertama.

API: `GET /api/session`, `GET /api/auth/config`, `POST /api/login`, `POST /api/login/2fa` (tiket + kode), `POST /api/logout`, `POST /api/signup`, `GET /api/verify-email`, `POST /api/password/forgot`, `POST /api/password/reset`, `GET /api/auth/google`, `GET`/`PATCH /api/me`, `POST /api/me/password`, `POST /api/me/email`, `POST /api/me/verify-email`, `POST /api/me/2fa/setup`, `POST /api/me/2fa/enable`, `POST /api/me/2fa/disable`, `POST /api/me/2fa/recovery`, `PATCH /api/me/profile`; admin: `GET`/`POST /api/users`, `PATCH /api/users/:id`; `GET /api/analyses?scope=all` (admin).

### Paket dan pembayaran

- Paket ada di `shared/plans.ts` (dipakai server, aplikasi, dan situs): Gratis, Pro (Rp149.000/bulan atau Rp1.490.000/tahun), Creator (Rp399.000/bulan atau Rp3.990.000/tahun), dan harga founding Pro Rp79.000/bulan untuk 100 pelanggan pertama. Paket membedakan kapasitas: analisa AI dan chat per hari, uji indikator per 24 jam, notifikasi, simbol watchlist, skrip, trade berjalan di jurnal. Di luar kapasitas ada halaman rekam jejak publik untuk Creator, dan indikator chart yang dibuka admin untuk tiap paket (Katalog indikator di bawah; semuanya terbuka untuk semua paket sampai admin mengubahnya). Admin memakai kapasitas Creator dengan batas analisa dan chat dari `DAILY_*`.
- Paket berlaku sampai tanggalnya, lalu akun kembali ke Gratis; notifikasi dan simbol watchlist di atas batas Gratis dijeda (yang terlama tetap jalan).
- Pembayaran manual: anggota memesan di menu akun → **Paket & tagihan**. Jumlahnya harga ditambah kode unik 3 digit supaya mudah dicocokkan dengan mutasi rekening; rekening atau QRIS-nya dari `PAYMENT_INSTRUCTIONS`, dan pesanan kedaluwarsa setelah 3 hari. Setelah anggota menekan "Saya sudah bayar", admin mendapat Telegram dan email, lalu mengonfirmasi atau menolak di Konsol admin → **Pembayaran** (berisi ringkasan anggota, paket aktif, trial, dan pendapatan). Konfirmasi memperpanjang paket dari tanggal berakhirnya bila paketnya sama, atau mulai hari itu. Selama `PAYMENT_INSTRUCTIONS` kosong, pesan batas paket dan kuota menyarankan menghubungi admin, bukan Paket & tagihan.
- Paket yang diatur admin di Konsol admin → Pengguna tercatat sebagai pemberian (Rp0) di riwayat pembayaran.
- Kupon: admin membuat kode di Konsol admin → **Kupon**, berupa potongan persen atau rupiah, untuk paket dan periode tertentu atau semua, dengan kuota dan hari terakhir bila perlu. Anggota mengetiknya di **Paket & tagihan**. Satu akun memakai satu kode sekali, harga founding tidak bisa digabung dengan kupon, dan kupon 100% langsung mengaktifkan paket. Kupon dimatikan, tidak dihapus, supaya riwayat pesanannya tetap utuh.
- Tagihan: setiap pesanan punya halaman tagihan, yang menjadi bukti pembayaran setelah lunas (`/invoice/:id`). Halaman itu dibuka dari tautan bertanda tangan di email pesanan dan bukti bayar, serta dari dialog Paket & tagihan; tidak perlu masuk, dan bisa dicetak atau disimpan sebagai PDF. Tautan di email butuh `PUBLIC_URL`.
- Pengingat otomatis lewat email, dan Telegram bila akunnya menautkan Telegram: 7, 3, dan 1 hari sebelum paket berbayar berakhir, sehari sebelum masa coba habis, setelah paket atau masa coba berakhir, dan sehari sebelum pesanan yang belum dibayar kedaluwarsa. Tiap pengingat terkirim sekali per akun dan kejadian (tabel `notices`), dicek tiap jam.
- Ringkasan bisnis (Konsol admin → **Ringkasan**): pendapatan bulanan berulang dari pelanggan berbayar, pendapatan per bulan selama 12 bulan, konversi trial ke berbayar, paket yang perlu diperpanjang dan yang tidak diperpanjang, pemakaian kupon, serta token model AI 30 hari terakhir per jenis pekerjaan, model, dan akun. Semua rupiah di sini tanpa kode unik.
- Meteran token: setiap perintah worker yang memanggil model (analisa, backtest, agent chart, terjemahan Pine dan skrip dari prompt, ringkasan pasar) melaporkan token per model saat selesai, lewat callback pemakaian LangChain. Server menyimpannya per akun di tabel `llm_usage`, dan `LLM_COST_IDR_PER_MTOK` mengubahnya menjadi perkiraan biaya.

API: `GET /api/billing`, `GET /api/billing/coupon?code=&period=`, `POST /api/billing/orders` (dengan `coupon` opsional), `POST /api/billing/orders/:id/claim`, `POST /api/billing/orders/:id/cancel`; admin: `GET /api/admin/payments?status=open|paid|all`, `POST /api/admin/payments/:id/confirm`, `POST /api/admin/payments/:id/reject`, `GET /api/admin/overview`, `GET`/`POST /api/admin/coupons`, `PATCH /api/admin/coupons/:id`, `GET /api/admin/business`; tanpa masuk: `GET /invoice/:id?t=` (tautan bertanda tangan).

### Katalog indikator (Konsol admin → Indikator)

- Admin mengatur indikator chart yang bisa dipakai tiap paket: tiga mesin bawaan (Scalper Pro+, PoB BYSTRA, Fib Golden Zone) dan skrip yang diterbitkan admin (`server/src/indicators.ts`, [ADR 0011](../docs/adr/0011-katalog-indikator-per-paket.md)). Tiap indikator punya paket yang boleh memakainya, akses khusus untuk akun tertentu apa pun paketnya, tanda **langsung nyala** (menyala di chart akun yang belum pernah memilih indikator), tanda aktif, dan urutan di menu.
- Anggota hanya melihat yang dibuka untuknya, di tiga tempat sekaligus: menu Indikator di chart, pilihan notifikasi sinyal, dan Lab. Admin selalu melihat semuanya, termasuk yang nonaktif, untuk mencoba sebelum membukanya.
- Indikator baru dibuat dari skrip (bahasa yang sama dengan Skrip saya; bisa diambil dari skrip admin atau template). Kodenya disalin ke katalog, jadi mengubah skrip asal tidak mengubah indikatornya. Indikator baru terbuka untuk admin saja sampai paketnya dicentang.
- Mesin bawaan tidak bisa dihapus, diganti nama, atau diubah kodenya; matikan untuk menyembunyikannya. Menghapus indikator skrip ikut menghapus notifikasi yang memakainya; riwayat call-nya tetap di Beranda pemiliknya, dan penghapusan ditolak selama sinyal publik creator darinya masih berjalan.
- Halaman `/harga` menampilkan tabel indikator per paket dari `GET /api/public/indicators` (nama, penjelasan, paket; tanpa kode), hanya indikator aktif yang terbuka untuk minimal satu paket.
- Migrasi 0026 mengisi tiga mesin bawaan terbuka untuk semua paket dan tidak langsung nyala, sama dengan perilaku sebelum katalog ada.

API: `GET /api/indicators` (yang boleh dipakai akun ini, dengan kode skrip untuk sandbox chart), `GET /api/public/indicators` (tanpa masuk); admin: `GET`/`POST /api/admin/indicators`, `PATCH`/`DELETE /api/admin/indicators/:id`, `PUT /api/admin/indicators/:id/grants` (`{ userIds }`, mengganti seluruh daftar).

### Aktivitas member (Konsol admin → Aktivitas)

- Selama tab aplikasi ada di depan dan dipakai (klik, sentuhan, atau ketikan dalam 5 menit terakhir), halaman mengirim detak tiap 30 detik berisi layar, tab, dan simbol chart yang terbuka (`client/src/lib/activity.ts`). Server menyimpan satu baris per menit (`activity_minutes`), jadi waktu aktif dihitung per menit, bukan dari lamanya tab terbuka.
- Tindakan dicatat server di tempat terjadinya (`activity_events`, `track` di `server/src/activity.ts`): masuk, analisa AI, backtest, pesan ke agent chart, uji indikator, notifikasi sinyal dan harga baru, simbol ke analisa harian, dan skrip baru.
- Halaman Aktivitas menampilkan member yang online sekarang (detak dalam 3 menit terakhir), member aktif per hari, jam ramai per hari dan jam dalam seminggu (WIB), layar dan tab, fitur, aset yang paling lama dibuka, dan daftar member dengan terakhir aktif. Halaman per member (`#/admin/aktivitas/<id>`) menambah sesinya (jeda lebih dari 15 menit memulai sesi baru) dan riwayat tindakannya. Periode 7, 30, atau 90 hari.
- Akun admin tidak dicatat. Data lebih dari 90 hari dihapus tiap hari oleh instance pemimpin penjadwal, seperti yang tertulis di Kebijakan Privasi.

API: `POST /api/activity` (detak halaman, `{ screen, tab, symbol }`); admin: `GET /api/admin/activity?days=7|30|90`, `GET /api/admin/activity/users/:id?days=`. Keputusan desainnya di [ADR 0012](../docs/adr/0012-aktivitas-member-per-menit.md).

### Merek dan tampilan

- **Nama:** TraderMedan, di semua yang dibaca anggota: situs, aplikasi, email, tagihan, Telegram, dan judul API. Engine Python di bawahnya, repo, dan pengenal internal tetap bernama TradingAgents.
- **Satu sumber:** `shared/brand.ts` menyimpan `BRAND` (nama, wordmark, tagline, kontak) dan `MARK` (path logo).
  - `client/src/lib/Logo.svelte`, `Wordmark.svelte`, serta header dan footer situs (`client/site/partials.ts`) menggambar dari sana.
  - `client/public/favicon.svg` menyalin path yang sama.
- **Tema:** daisyUI `horas` (terang, bawaan) dan `horas-dark` (gelap, mengikuti perangkat), di `client/src/app.css`. Warnanya:
  - jingga #FF6A13 untuk aksi utama, selalu dengan teks tinta;
  - accent untuk jingga yang dibaca sebagai teks: jingga tua di latar terang, jingga itu sendiri di latar gelap;
  - tinta #121212 dan tulang #F2EDE4 sebagai latar dan teks;
  - hijau, merah, dan kuning tetap untuk untung, rugi, dan peringatan.
- **Huruf:** Bricolage Grotesque untuk judul dan wordmark, Archivo untuk teks dan angka, dan Geist Mono untuk kode. Semuanya dari paket fontsource.
- **Hiasan:** pita segitiga jingga, sekali di atas footer situs publik.
- Keputusan, nilai warna, dan kontrasnya ada di [ADR 0022](../docs/adr/0022-merek-tradermedan-horas.md).

### Situs publik

- Landing page (`/`), Harga (`/harga`), Syarat & Ketentuan (`/syarat`), Kebijakan Privasi (`/privasi`), Disclaimer risiko (`/disclaimer`), Status layanan (`/status`), dan rekam jejak Creator (`/c/<nama pengguna>`) adalah halaman statis dari build klien (`client/index.html`, `client/harga/` dan seterusnya). Harga dan kapasitas diisi saat build dari `shared/plans.ts`; nama merek dan kontak dari `shared/brand.ts`.
- Landing page memuat data live tanpa login dari `GET /api/public/market` (BTC, ETH, SOL, emas, IHSG, S&P 500, USD/IDR: lanskap hero dari 30 harga penutupan tiap pasar, chart BTC, daftar pantau, dan ringkasan pasar), `/api/public/crypto-map` (peta 24 koin Binance), `/api/public/signals` (8 sinyal live terbaru dan rekor 90 hari), dan `/api/public/brief` (bacaan AI, juga rata-rata 20 hari dan terendah 30 hari BTC yang digambar di chart); semuanya di-cache (`server/src/site.ts`).
- Landing page selalu memakai tema gelap (`data-theme="horas-dark"` di `client/index.html`); halaman situs lain mengikuti tema perangkat.
- Ringkasan pasar AI ditulis tiap 6 jam oleh model quick tier server (perintah worker `brief`, `worker/brief.py`) hanya dari angka yang dihitung server: harga, perubahan 1/7/30 hari, rata-rata 20/50 hari, RSI 14, rentang 30 hari, dan sinyal terbaru. Hasilnya (judul, ringkasan, arah per aset dengan argumen bull dan bear, yang dipantau, risiko) disimpan di tabel `market_briefs` bersama angka yang dibacanya, dan angka itu ditampilkan di landing. `SITE_BRIEF=off` mematikannya.
- Status layanan (`/status`): keadaan sekarang dan 90 hari terakhir dari database, harga kripto (Binance), harga pasar lain (Yahoo), mesin analisa, pemindai sinyal, ringkasan pasar AI, Telegram, dan email. Server memeriksa tiap 5 menit dan menyimpan hitungan harian per bagian di tabel `status_days`; bagian yang belum diatur tidak dihitung. Data dari `GET /api/public/status` (di-cache 30 detik). Pemeriksanya server yang sama, jadi bila server mati halaman ini ikut tidak terbuka; untuk itu pakai pemantau dari luar ke `/healthz`.
- Rekam jejak Creator (`/c/<nama pengguna>`): akun Creator menyalakan halamannya di Profil → Halaman publik (nama tampilan dan bio), lalu memilih alert yang masuk dengan sakelar **Publik** di menu Notifikasi chart. Setiap sinyal baru dari alert itu dicatat saat muncul bersama biaya simulasinya, lalu dinilai otomatis saat selesai (tabel `creator_signals`, `server/src/creators.ts`). Catatan hanya bertambah: alert yang dijadikan privat atau dihapus tetap meninggalkan sinyalnya, dan alert publik yang masih punya sinyal berjalan tidak bisa dihapus. Halaman turun bila pemiliknya mematikannya atau bukan Creator lagi. Data dari `GET /api/public/creators/:username` (di-cache 1 menit); pengaturannya lewat `PATCH /api/me/profile` dan `PATCH /api/alerts/:id/public`.
- Aplikasi ada di `/app`. Tanpa `PUBLIC_SITE=on`, alamat root langsung membuka aplikasi (landing tetap bisa dilihat di `/index.html`). Tautan lama `/#/...`, termasuk yang datang lewat pengalihan domain lama, tetap diarahkan ke `/app` oleh `client/public/legacy-hash.js`. Skrip itu berupa berkas sendiri, bukan skrip inline, supaya tidak memicu laporan CSP dan tetap jalan saat CSP nanti ditegakkan.
- Isi Syarat & Ketentuan, Kebijakan Privasi, dan Disclaimer adalah draf awal: tinjau dengan ahli hukum, dan isi nama usaha serta kontak di `shared/brand.ts`, sebelum situs dibuka.
- **Key LLM**: diisi di `web/deploy/.env` (tidak masuk image, tidak di-commit). `ALLOWED_BACKEND_URLS` membatasi ke mana key itu boleh dikirim. Hanya admin yang memilih provider, model, dan Backend URL. Analisa, backtest, chat agent, terjemahan Pine, dan skrip dari prompt milik anggota selalu memakai bawaan server, apa pun yang dikirim halamannya (`server/src/models.ts`). Opsi form untuk anggota juga tidak memuat nama key dan URL bawaan, dan pesan error penyedia AI yang sampai ke anggota (chat agent, terjemahan Pine) menulis "server" di tempat alamat backend (`shownTo` di `server/src/models.ts`). Anggota bahkan tidak melihat panel Pengaturan di form analisa dan backtest: keduanya selalu memakai analisa standar (semua analis yang punya data, kedalaman 1, bahasa Indonesia; `shared/analysis.ts`), dan server menerapkannya apa pun yang dikirim.
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
- **Satu jawaban per sesi chat, dan satu uji indikator sekaligus,** di instance mana pun, lewat lease di tabel `leases`. Lease diperbarui selama kerja berjalan, dan lepas sendiri dalam 2 menit kalau instance-nya mati.
- **Halaman status** membaca hasil cek terakhir dari `shared_values`, yang ditulis instance pemegang scheduler.

Cache (candle, katalog model, halaman Creator, jawaban halaman status) tetap per instance. Isinya boleh sedikit berbeda antar-instance karena tidak pernah memberi jawaban salah; paling buruk satu instance mengambil ulang datanya.

**Worker analisa.** Antrean analisa dan backtest ada di Postgres (`jobs.ts`). Di produksi, service `worker` di compose (`bun src/runner.ts`) mengambil baris yang antre (`FOR UPDATE SKIP LOCKED`, jadi satu analisa tidak pernah diambil dua worker) dan menjalankan engine; app sendiri tidak menjalankan analisa (`MAX_CONCURRENT_ANALYSES=0`). Setiap event disimpan di `analysis_events` dan diumumkan lewat `NOTIFY`, jadi stream langsung di browser dan ringkasan watchlist berjalan di instance app mana pun. Tambah worker dengan `docker compose up -d --scale worker=2`; masing-masing menjalankan `MAX_CONCURRENT_ANALYSES` analisa sekaligus.
- **Batal:** baris langsung ditandai dibatalkan, dan worker yang menjalankannya diberi tahu untuk mematikan prosesnya.
- **Worker berhenti** (deploy, restart): analisa yang sedang jalan ditandai gagal dengan alasannya, karena analisa tidak bisa dilanjutkan di tengah. Worker yang mati mendadak berhenti mengirim heartbeat, dan analisanya ditandai gagal oleh instance pemegang scheduler dalam sekitar 2 menit.
- Chat agen, uji indikator, terjemahan Pine dan skrip dari prompt, pemindaian sinyal, dan ringkasan AI masih berjalan di proses app.

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
| `TA_TRANSLATE_LLM_TIMEOUT` | `300` | Timeout per panggilan LLM untuk terjemahan Pine dan skrip dari prompt (detik, 30 sampai 1800; retry selalu 1). Server menunggu tiap langkah dua kali itu ditambah 1 menit |

API key LLM tetap dibaca engine dari `.env` di root repo, tidak lewat web.

Pengaturan dicek saat server start (`readSettings` di `server/src/config.ts`). Angka, URL, `LOG_LEVEL`, atau `SESSION_SECRET` yang salah menghentikan server dengan daftar semua masalahnya, bukan baru ketahuan saat fiturnya dipakai.

Setiap analisa yang berjalan mengirim *heartbeat* ke barisnya tiap 30 detik. Saat boot dan tiap 2 menit, server hanya menggagalkan baris yang heartbeat-nya basi (servernya mati), jadi dua instance di database yang sama tidak saling menggagalkan; baris antre diklaim atomik supaya tidak dijalankan dua kali. Kalau sebuah baris selesai di tempat lain (misalnya dibatalkan), worker-nya di instance ini ikut dihentikan.

## API

Referensi lengkapnya ada di [`docs/api/openapi.json`](../docs/api/openapi.json) (OpenAPI 3.1). Isinya setiap rute, apakah perlu sesi atau khusus admin, dan isian rute-rute utama. Berkas itu dibangkitkan dari rute server: setelah menambah atau mengubah rute, jalankan `bun run openapi` di `web/server`; tesnya gagal selama berkas tertinggal. Arsitektur, keputusan desain (ADR), dan runbook operasi ada di [`docs/`](../docs/README.md). Tabel di bawah merangkum rute yang paling sering dipakai.

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/options` | Provider, model, analis, kedalaman, bahasa, dan `typicalMinutes` (median lama 50 analisa terakhir, untuk janji waktu di form Riset AI) |
| GET | `/api/usage` | Pemakaian hari ini: analisa dan chat dibanding kuota, dan `lab` (uji indikator dalam 24 jam terakhir dibanding batas paket) |
| GET | `/api/analyses` | 100 analisa terakhir (`?kind=backtest` untuk backtest, masing-masing dengan `score`: saran berarah yang sudah dinilai dan berapa yang benar) |
| POST | `/api/backtests` | Mulai backtest (`tickers`, `start`, `end`, `everyNDays`, opsional `runId`) |
| GET | `/api/candles?symbol=&range=&interval=` | Candle Yahoo; `range` `6mo`/`1y`/`2y`/`5y`, `interval` `1h`/`4h`/`1d`/`1wk`/`1mo` (default `1d`) |
| GET | `/api/decisions?ticker=` | Semua keputusan AI untuk satu ticker |
| GET | `/api/verdict?ticker=` | Satu saran untuk layar Pemula: analisa selesai terakhir milik pengguna, atau pandangan ringkasan pasar AI, atau `null` |
| GET | `/api/quotes?symbols=&spark=` | Harga terakhir dan perubahan dari penutupan sebelumnya untuk maksimal 80 simbol (ejaan mesin: `BBCA.JK`, `BTC-USD`), untuk daftar Pasar dan Pantauanku; `spark=1` menambah penutupan 30 hari terakhir dan perubahannya untuk daftar dan papan pasar |
| GET | `/api/activity/since` | Yang terjadi sejak kunjungan sebelumnya (jeda lebih dari 15 menit di menit aktivitas): sinyal baru dihitung menurut keadaannya sekarang dan per aset, alert harga yang kena, analisa yang selesai |
| GET | `/api/indicators` | Indikator chart yang boleh dipakai akun ini (katalog admin), dengan kode skrip yang diterbitkan untuk sandbox chart |
| GET | `/api/ledger/record` | Rekam jejak live tiap mesin dan timeframe (90 hari, setelah biaya), total dan per simbol yang dicatat, untuk menu Indikator, Notifikasi, dan kartu Rencana trading |
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
