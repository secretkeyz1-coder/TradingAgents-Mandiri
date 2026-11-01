# 0002. Engine Python dijalankan sebagai subprocess dengan protokol JSON per baris

Status: Diterima · 2026-11-01 (mencatat bentuk yang sudah berjalan)

## Konteks

Analisa memakai engine TradingAgents dari upstream (Python, LangGraph), yang terus diperbarui di repositori asalnya. Server ditulis dengan TypeScript di Bun.

## Keputusan

- Server menjalankan `python -u web/worker/ta_worker.py <perintah>` per job (`run`, `backtest`, `agent`, `signals`, `translate`, `lab`, `brief`, `catalog`).
- Masukan berupa satu JSON di stdin; keluaran berupa satu event JSON per baris di stdout. Stderr hanya disimpan ekornya untuk pesan gagal.
- Pemakaian token dilaporkan engine sebagai event `usage` di akhir dan dicatat per pengguna.

## Konsekuensi

- Engine upstream bisa diperbarui terpisah; kontrak di antara keduanya hanya bentuk event.
- Setiap job membayar biaya start Python (beberapa detik untuk perintah yang memuat pandas atau LangChain).
- Event yang sama dipakai untuk stream langsung, riwayat (`analysis_events`), dan baris analisa, jadi menambah jenis event cukup di dua tempat: worker dan `jobs.ts`.
