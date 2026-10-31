"""The public site's market brief (``ta_worker.py brief``).

The server computes the figures (prices, changes, averages, RSI, the 30-day
range, the latest signals) and one call to the quick model turns them into a
short Indonesian read: a headline, a summary, and per asset a lean with its
bull case, bear case and what to watch. The prompt holds the model to the
numbers it is given: no news, no advice.
"""

from __future__ import annotations

import json

PROMPT = """Kamu analis pasar untuk sebuah situs riset trading. Tulis bacaan pasar yang singkat dan lugas dalam bahasa Indonesia, HANYA dari data JSON di bawah.

Aturan:
- Pakai hanya angka dan fakta yang ada di data. Jangan menyebut berita, peristiwa, tokoh, atau angka lain.
- Jangan menyuruh membeli atau menjual. Tulis sebagai bacaan kondisi pasar, bukan saran.
- Kalau data_tertunda bernilai true, jangan menyebut harga itu sebagai harga sekarang.
- Tulis angka dengan format Indonesia (titik pemisah ribuan, koma desimal).

Balas HANYA dengan satu objek JSON valid, tanpa teks lain, berbentuk:
{"headline": "satu kalimat, paling panjang 90 karakter, tentang suasana pasar hari ini",
 "summary": "dua sampai tiga kalimat tentang gambaran umum semua aset",
 "assets": [{"symbol": "symbol persis seperti di data", "bias": "naik" atau "turun" atau "netral", "bull": "satu kalimat argumen kenaikan dari data", "bear": "satu kalimat argumen penurunan dari data", "watch": "satu kalimat level atau kondisi yang perlu dipantau, dengan angka dari data"}],
 "risk": "satu kalimat tentang risiko utama yang terlihat dari data"}

Urutan assets sama dengan urutan aset di data.

DATA:
"""


def write_brief(llm, data: dict) -> dict:
    reply = llm.invoke(PROMPT + json.dumps(data, ensure_ascii=False))
    text = getattr(reply, "content", reply)
    if isinstance(text, list):
        text = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in text)
    text = str(text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model tidak membalas JSON")
    return json.loads(text[start : end + 1])
