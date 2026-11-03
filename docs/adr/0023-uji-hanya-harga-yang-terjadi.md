# 0023. Uji hanya menghitung harga yang benar-benar terjadi

Status: Diterima · 2026-11-03

## Konteks

Semua yang mengikuti sinyal sampai hasilnya memakai dua mesin:
- **Runtime skrip** (`shared/script.ts`), untuk chart, notifikasi, Lab, dan rekam jejak live.
- **Mesin bawaan** PoB, Fib, dan Scalper, yang masing-masing ada dalam Python (`web/worker`) dan TypeScript (`client/src/lib/indicators`).

Analisa 3 November 2026 menemukan dua cara keduanya mencatat trade di harga yang tidak pernah terjadi:
- **Entry yang tidak tersentuh dianggap terisi.** `signal(i, side, { entry })` diterima pada harga berapa pun, lalu SL dan TP dilacak mulai candle berikutnya. Skrip "buy limit 5 ATR di bawah harga" pada BTC-USD harian 5 tahun mendapat 361 trade. Entry-nya tidak pernah tersentuh sekali pun, tapi Lab mencatat menang 100%, +0,94R per trade di data uji, dan memberi putusan Lolos. Mesin bawaan tidak kena, karena entry-nya selalu close candle sinyal. Yang kena adalah skrip sendiri, terjemahan Pine, dan skrip "Dari prompt", yang memang diminta memakai order limit.
- **SL selalu −1R.** Candle yang dibuka sudah melewati SL tetap dicatat −1R. Pada template Donchian di BBRI harian, 15 dari 70 SL dibuka melewati SL, dengan rugi sebenarnya rata-rata −1,25R dan terburuk −2,25R. Totalnya 3,8R lebih buruk dari catatan Lab. Kripto yang buka 24 jam hampir tidak kena, tapi saham IDX dan emas setelah jeda akhir pekan kena.

## Keputusan

- **Entry di dalam candle.** `entry` selain close candle i berarti order limit atau stop yang terisi di dalam candle i.
  - Kalau candle i tidak pernah menyentuhnya (di atas high atau di bawah low), sinyal dibuang. Jumlahnya dicatat di `stats.unfilled`: editor dan kartu chart menulis "N tidak terisi", dan hasil Lab menyebutnya per uji.
  - Tidak ada hasil (outcome) baru, jadi rekam jejak, notifikasi, dan saringan Lab tetap seperti sebelumnya.
- **SL di candle entry.** Kalau candle i juga menyentuh SL, sinyal itu rugi −1R di candle i. Urutan harga di dalam satu candle tidak diketahui, jadi diambil yang terburuk. TP yang tersentuh di candle itu tidak dihitung, dan trade dilacak mulai candle berikutnya.
- **SL yang dilompati.** Candle yang dibuka sudah melewati SL mengisinya di harga pembukaan, jadi R = (open − entry) · arah / risiko, lebih kecil dari −1. Aturan ini berlaku di runtime skrip dan di ketiga mesin bawaan, dalam Python dan TypeScript sekaligus. Uji paritas (`client/test/indicators-parity.test.ts`) menjaga keduanya tetap sama.
- **TP tetap di harganya.** Candle yang dibuka melewati TP tetap dicatat di TP, jadi lompatan harga tidak pernah membuat hasil lebih bagus.
- **Yang tidak berubah:**
  - Order pasar tetap masuk di close candle sinyal, tanpa jeda ke pembukaan berikutnya dan tanpa slippage.
  - Model biaya (`tradeCost`) dan syarat lolos Lab.

## Akibat

- Uji baru untuk skrip dengan order limit atau stop bisa kehilangan trade yang dulu terhitung. Strategi harian di saham IDX tampak lebih rugi. Hasil uji lama di `lab_runs` tetap menyimpan angkanya sendiri.
- Rekam jejak live memakai aturan baru untuk sinyal yang selesai sejak rilis ini. Sinyal yang sudah selesai tetap dengan R yang tersimpan.
- AI yang menulis skrip (terjemahan Pine dan "Dari prompt") membaca aturan ini dari `SCRIPT_REFERENCE`.
- Masih terbuka, di luar keputusan ini:
  - **Kekuatan statistik syarat lolos.** Strategi tanpa keunggulan lolos sekitar 24% dari waktu.
  - **Skrip yang membaca candle sesudahnya**, misalnya `close[i + 1]`. Larik candle utuh terbuka untuk skrip, dan runtime belum bisa mendeteksinya.
