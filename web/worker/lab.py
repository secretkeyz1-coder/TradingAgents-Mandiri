"""Strategy lab (``ta_worker.py lab``): one built-in engine on the bars the server sends.

The server (web/server/src/lab.ts) fetches the long history and scores the trades (costs, the
in-sample and out-of-sample split); this only runs the engine, the same code the chart, the alerts
and the agent use, and answers every signal with its index, frozen levels, outcome and R.
"""

from __future__ import annotations

from collections.abc import Callable

import chart_agent as ca
import pandas as pd


def run(job: dict, emit: Callable[..., None]) -> int:
    engine, timeframe = str(job.get("engine") or ""), str(job.get("timeframe") or "")
    bars = job.get("bars") or []
    expiry = max(1, min(int(job.get("expiry") or 96), 2000))
    signals: list[dict] = []
    if engine == "pob":
        from pob import pob

        result = pob(bars, timeframe, {"expiry_bars": expiry})
        signals = (result or {}).get("signals", [])
    elif engine == "fib":
        from fib import fib

        result = fib(bars, {"expiry_bars": expiry})
        signals = (result or {}).get("signals", [])
    elif engine == "scalper":
        df = pd.DataFrame([[b["time"], b["open"], b["high"], b["low"], b["close"]] for b in bars], columns=["Date", "Open", "High", "Low", "Close"])
        m = ca.Market.__new__(ca.Market)
        m.symbol = str(job.get("symbol") or "LAB")
        # The engine reads its bars through _scalper_bars; hand it these instead of downloading.
        original = ca._scalper_bars
        ca._scalper_bars = lambda _m, _tf: df.copy()
        try:
            result = ca.scalper_signal(m, timeframe, history_bars=expiry, history_count=10**6)
        finally:
            ca._scalper_bars = original
        n = len(bars)
        signals = [{**x, "index": n - 1 - x["bars_ago"]} for x in result.get("history") or []]
    else:
        emit("error", message=f"mesin tidak dikenal: {engine}")
        return 1
    emit(
        "lab_signals",
        signals=[
            {"index": x["index"], "side": x["side"], "entry": x["entry"], "stop_loss": x["stop_loss"],
             "take_profit": x["take_profit"], "outcome": x["outcome"], "r": x.get("r")}
            for x in signals
        ],
    )
    emit("done")
    return 0
