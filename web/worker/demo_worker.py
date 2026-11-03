"""A stand-in for ta_worker.py that replays a scripted run: no LLM calls, no API keys.

For working on the web UI. Start the server with
``TA_WORKER_SCRIPT=web/worker/demo_worker.py``. ``catalog`` is the real one, and so are the
indicator readings a request asks for (readings.py): the market report quotes them.
"""

from __future__ import annotations

import json
import sys
import time

import ta_worker
from ta_worker import ANALYST_LABELS, ANALYST_ORDER, ANALYST_REPORTS, FIXED_AGENTS, emit

STEP_SECONDS = 0.6


def run(job: dict) -> int:
    ticker = job["ticker"].upper()
    analysts = [a for a in ANALYST_ORDER if a in job["analysts"]]
    emit("started", ticker=ticker, assetType="stock", date=job["date"], analysts=analysts)
    readings = ta_worker._read_indicators(job, [ticker], [job["date"]])
    if readings:
        emit("message", kind="Data", content=readings.summary(ticker, job["date"]))

    status = {ANALYST_LABELS[a]: "in_progress" for a in analysts}
    for _team, agents in FIXED_AGENTS:
        status.update(dict.fromkeys(agents, "pending"))
    emit("status", agents=dict(status))

    calls = 0
    for key in analysts:
        time.sleep(STEP_SECONDS)
        emit("tool_call", name="get_stock_data", args={"symbol": ticker, "end_date": job["date"]})
        emit("message", kind="Data", content=f"(demo) data harga {ticker} 90 hari terakhir")
        time.sleep(STEP_SECONDS)
        emit("message", kind="Agent", content=f"(demo) {ANALYST_LABELS[key]} menyusun laporan.")
        read = f" {readings.summary(ticker, job['date'])}" if readings and key == "market" else ""
        emit("report", section=ANALYST_REPORTS[key],
             content=f"## {ANALYST_LABELS[key]}\n\n(demo) Ringkasan untuk **{ticker}**.{read}\n\n"
                     "| Indikator | Nilai |\n|---|---|\n| RSI | 54 |\n| MACD | positif |")
        status[ANALYST_LABELS[key]] = "completed"
        calls += 3
        emit("status", agents=dict(status))
        emit("stats", llmCalls=calls, toolCalls=calls // 3, tokensIn=calls * 1800, tokensOut=calls * 400)

    stages = [
        (["Bull Researcher", "Bear Researcher", "Research Manager"], "investment_plan",
         "### Research Manager Decision\n(demo) Argumen bull lebih kuat: **Overweight**."),
        (["Trader"], "trader_investment_plan", "(demo) Akumulasi bertahap, stop loss 7%."),
        (["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst", "Portfolio Manager"],
         "final_trade_decision",
         "**Rating: Overweight**\n\n(demo) Tambah posisi secara bertahap; risiko utama: suku bunga."),
    ]
    for agents, section, text in stages:
        for agent in agents:
            status[agent] = "in_progress"
        emit("status", agents=dict(status))
        time.sleep(STEP_SECONDS * 2)
        emit("message", kind="Agent", content=f"(demo) {', '.join(agents)} selesai berdiskusi.")
        emit("report", section=section, content=text)
        for agent in agents:
            status[agent] = "completed"
        calls += 4
        emit("status", agents=dict(status))
        emit("stats", llmCalls=calls, toolCalls=calls // 3, tokensIn=calls * 1800, tokensOut=calls * 400)

    html = (f"<!doctype html><meta charset='utf-8'><title>{ticker}</title>"
            f"<body style='font-family:sans-serif;padding:2rem'><h1>{ticker} (demo)</h1>"
            "<p>Laporan lengkap dari engine muncul di sini.</p></body>")
    emit("done", rating="Overweight", review=False, reportDir="(demo)", html=html)
    return 0


def backtest(job: dict) -> int:
    """A scripted sweep: one cell per ticker and grid date, with made-up outcomes."""
    from datetime import date, timedelta

    start, end = date.fromisoformat(job["start"]), min(date.fromisoformat(job["end"]), date.today())
    step = int(job.get("everyNDays") or 7)
    dates = []
    while start <= end:
        dates.append(start.isoformat())
        start += timedelta(days=step)
    tickers = [t.upper() for t in job["tickers"]]
    total = len(tickers) * len(dates)
    emit("started", tickers=tickers, dates=dates, total=total, everyNDays=step)
    readings = ta_worker._read_indicators(job, tickers, dates)
    if readings:
        emit("message", kind="Data", content=readings.overview())

    ratings = ["Buy", "Overweight", "Hold", "Underweight", "Sell"]
    cells, done = [], 0
    for ticker in tickers:
        for i, day in enumerate(dates):
            emit("progress", done=done, total=total, ticker=ticker, date=day)
            time.sleep(STEP_SECONDS / 2)
            done += 1
            seed = sum(map(ord, ticker + day))
            rating = ratings[seed % 5]
            pending = (date.today() - date.fromisoformat(day)).days < 8
            ret = ((seed % 21) - 10) / 100
            cells.append({
                "ticker": ticker, "date": day, "rating": rating, "pending": pending,
                "return": None if pending else ret,
                "alpha": None if pending else ret - 0.01 * (i % 3),
                "holding": None if pending else "5d",
            })
    emit("progress", done=total, total=total, ticker=None, date=None)

    by_rating: dict = {}
    direction = {"Buy": 1, "Overweight": 1, "Hold": 0, "Underweight": -1, "Sell": -1}
    resolved = [c for c in cells if not c["pending"]]
    for rating in dict.fromkeys(c["rating"] for c in resolved):
        alphas = [c["alpha"] for c in resolved if c["rating"] == rating]
        d = direction[rating]
        by_rating[rating] = {
            "count": len(alphas),
            "hitRate": (sum(a * d > 0 for a in alphas) / len(alphas)) if d else None,
            "meanAlpha": sum(alphas) / len(alphas),
        }
    emit("done", result={
        "runId": "demo",
        "cells": cells,
        "summary": {"resolved": len(resolved), "pending": len(cells) - len(resolved), "unscored": 0,
                    "holding": "5 trading days", "byRating": by_rating},
        "failures": [],
        "settlementFailures": [],
    })
    return 0


def agent(job: dict) -> int:
    """The real chart agent and its real skills, driven by a scripted model instead of an LLM."""
    import chart_agent
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    def call(name, args, i):
        return {"name": name, "args": args, "id": f"demo{i}", "type": "tool_call"}

    def draw(messages):
        levels = json.loads(messages[-1].content)["levels"]
        sup = next((lv for lv in levels if lv["role"] == "support"), levels[-1])
        res = next((lv for lv in levels if lv["role"] == "resistance"), levels[0])
        steps = [
            call("draw_level", {"price": sup["price"], "label": f"Support ({sup['touches']}× sentuh)", "role": "support"}, 2),
            call("draw_level", {"price": res["price"], "label": f"Resistance ({res['touches']}× sentuh)", "role": "resistance"}, 3),
        ]
        if sup["price"] < res["price"]:
            steps.append(call("draw_trade_plan", {"entry": sup["price"] * 1.01, "stop": sup["price"] * 0.97, "target": res["price"], "side": "long", "note": "(demo) rencana long"}, 4))
        return AIMessage(content="", tool_calls=steps)

    class Scripted(BaseChatModel):
        script: list = []

        @property
        def _llm_type(self):
            return "demo"

        def bind_tools(self, tools, **kw):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kw):
            time.sleep(STEP_SECONDS)
            step = self.script.pop(0)
            return ChatResult(generations=[ChatGeneration(message=step(messages) if callable(step) else step)])

    def draw_from_skill(messages):
        try:
            loaded = json.loads(messages[-1].content)
        except ValueError:
            return AIMessage(content=f"(demo) {messages[-1].content}")
        levels = next(r["output"]["levels"] for r in loaded["results"] if r["tool"] == "support_resistance")
        return AIMessage(content="", tool_calls=[
            call("draw_level", {"price": lv["price"], "label": f"{loaded['skill']}: {lv['role']}", "role": lv["role"]}, 10 + i)
            for i, lv in enumerate(levels[:2])
        ])

    text = job["message"].lower()
    # "pakai skill" loads the first approved skill; any other mention of "skill" proposes one.
    if "pakai skill" in text or "gunakan skill" in text:
        name = next((s["definition"]["name"] for s in job.get("skills") or []), "sr-ringkas")
        script = [
            AIMessage(content="", tool_calls=[call("use_skill", {"name": name}, 1)]),
            draw_from_skill,
            AIMessage(content=f"(demo) Saya menjalankan skill {name} di {job['symbol']} dan menggambar levelnya."),
        ]
    elif "skill" in text:
        script = [
            AIMessage(content="", tool_calls=[call("propose_skill", {
                "name": "sr-ringkas",
                "title": "Support resistance ringkas",
                "description": "Dua level terkuat dari 120 hari terakhir, plus RSI untuk konteks.",
                "when_to_use": "Saat pengguna minta peta level cepat sebelum masuk posisi.",
                "instruction": "Gambar support terdekat di bawah harga dan resistance terdekat di atasnya dari $lookback hari. "
                               "Sebut RSI bila di atas 70 atau di bawah 30.",
                "steps": [{"tool": "support_resistance", "args": {"lookback": "$lookback"}}, {"tool": "indicators", "args": {}}],
                "params": {"lookback": 120},
            }, 1)]),
            AIMessage(content="(demo) Saya mengusulkan skill sr-ringkas dan sudah mengujinya di chart ini. "
                              "Buka panel Skill untuk meninjau dan menyetujuinya."),
        ]
    else:
        script = [
            AIMessage(content="", tool_calls=[call("support_resistance", {"lookback": 180}, 1)]),
            draw,
            AIMessage(content=f"(demo) Saya menggambar support dan resistance utama {job['symbol']} dari 180 hari terakhir, "
                              "plus rencana long hipotetis. Ini riset, bukan saran investasi."),
        ]
    llm = Scripted(script=script)
    chart_agent.run_agent(llm, job, emit)
    emit("done")
    return 0


DEMO_PLAN = {
    "summary": "(demo) Prompt ini berisi aturan struktur pasar yang bisa dihitung dari harga, dan cara AI menulis analisa yang tidak bisa jadi skrip.",
    "rules": [
        {"text": "Swing high dan swing low yang sudah terkonfirmasi", "param": "Pivot 5 candle"},
        {"text": "Break of structure: close menembus swing terakhir", "param": None},
        {"text": "Entry saat harga kembali ke level yang ditembus; batal bila terlalu lama", "param": "Tunggu maks 12 candle"},
        {"text": "SL di balik swing berlawanan, TP pada risk-reward minimum", "param": "RR minimum 2"},
    ],
    "adapted": ["TP1, TP2 dan TP3 menjadi satu target per sinyal.", "Buy limit dan sell limit menjadi sinyal di candle saat harga menyentuh entry."],
    "dropped": [
        {"text": "Format CALL AI AGENT dan alasan entry", "why": "Tulisan analisa adalah tugas Tanya AI, bukan skrip."},
        {"text": "Hindari berita ekonomi berdampak tinggi", "why": "Aplikasi belum punya data kalender ekonomi."},
    ],
}

DEMO_SCRIPT = """// (demo) Dari rencana: swing terkonfirmasi, break of structure, lalu entry saat harga kembali ke level yang ditembus.
// Tidak ikut: format analisa AI dan filter berita.
const len = input("Panjang pivot", 5);
const rr = input("RR minimum", 2);
const wait = input("Tunggu maks (candle)", 12);
const ph = ta.pivothigh(len);
const pl = ta.pivotlow(len);
const swingHigh = new Array(n).fill(NaN);
const swingLow = new Array(n).fill(NaN);
let lastHigh = NaN, lastLow = NaN, pending = null;
for (let i = 1; i < n; i++) {
  if (!isNaN(ph[i])) lastHigh = ph[i];
  if (!isNaN(pl[i])) lastLow = pl[i];
  swingHigh[i] = lastHigh;
  swingLow[i] = lastLow;
  if (!isNaN(lastHigh) && close[i] > lastHigh && close[i - 1] <= lastHigh) pending = { side: "BUY", level: lastHigh, stop: lastLow, since: i };
  else if (!isNaN(lastLow) && close[i] < lastLow && close[i - 1] >= lastLow) pending = { side: "SELL", level: lastLow, stop: lastHigh, since: i };
  else if (pending && i - pending.since > wait) pending = null;
  else if (pending && pending.side === "BUY" && low[i] <= pending.level && pending.stop < pending.level) {
    const risk = pending.level - pending.stop;
    signal(i, "BUY", { entry: pending.level, sl: pending.stop, tp: pending.level + rr * risk, label: "Retest BOS" });
    pending = null;
  } else if (pending && pending.side === "SELL" && high[i] >= pending.level && pending.stop > pending.level) {
    const risk = pending.stop - pending.level;
    signal(i, "SELL", { entry: pending.level, sl: pending.stop, tp: pending.level - rr * risk, label: "Retest BOS" });
    pending = null;
  }
}
plot(swingHigh, "Swing high", "teal");
plot(swingLow, "Swing low", "orange");
"""


def translate(job: dict) -> int:
    """Without a model: a prompt's plan and its script are fixed examples. Pine still goes to the real translator."""
    mode = job.get("mode")
    if mode == "plan":
        emit("plan", plan=DEMO_PLAN)
    elif mode == "compose":
        emit("code", code=DEMO_SCRIPT)
    else:
        return ta_worker.translate(job)
    emit("done")
    return 0


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command in ("run", "backtest", "agent", "translate"):
        code = {"run": run, "backtest": backtest, "agent": agent, "translate": translate}[command](json.loads(sys.stdin.read()))
        # Made-up tokens, so the server's token meter can be tried without a model (server/src/tokens.ts).
        emit("usage", models={"demo-model": {"input": 1800, "output": 400}})
        sys.exit(code)
    sys.exit(ta_worker.main(sys.argv))
