"""Signal scan for the notification scheduler (``ta_worker.py signals``).

For each (symbol, timeframe) the server asks about, the bars are downloaded
once and the same engines the chart and the agent use are run on them:
PoB BYSTRA (pob.py) and Scalper Pro+ (chart_agent.scalper_signal). Each
answers its last ten signals with frozen levels, their outcome so far and how
many bars ago they fired. Only closed bars count; the server decides what is
new and what to send. A pair on another crypto venue (Bybit, OKX, ...) brings
its own bars from the server, which reaches the exchanges (server/src/venues.ts).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager

import chart_agent as ca
import pandas as pd
from pob import pob

# Bars a scalper signal is followed before it counts as expired, as PoB does.
# Crypto bars come from Binance inside chart_agent._scalper_bars, for every engine here.
EXPIRY_BARS = 96


def _pob(m: ca.Market, timeframe: str, recent: int = 10) -> tuple[str | None, list[dict]]:
    df = ca._scalper_bars(m, timeframe)
    bars = [{"time": r.Date, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close)} for r in df.itertuples()]
    result = pob(bars, timeframe)
    if result is None:
        return (bars[-1]["time"] if bars else None), []
    out = [
        {"time": x["time"], "side": x["side"], "label": x["label"], "entry": x["entry"], "stop_loss": x["stop_loss"],
         "take_profit": x["take_profit"], "outcome": x["outcome"],
         "exit_time": None if x["exit_index"] is None else bars[x["exit_index"]]["time"], "bars_ago": len(bars) - 1 - x["index"],
         "r": x["r"]}
        for x in result["signals"][-recent:]
    ]
    return bars[-1]["time"], out


def _fib(m: ca.Market, timeframe: str, recent: int = 10) -> tuple[str | None, list[dict]]:
    from fib import fib

    df = ca._scalper_bars(m, timeframe)
    bars = [{"time": r.Date, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close)} for r in df.itertuples()]
    result = fib(bars)
    if result is None:
        return (bars[-1]["time"] if bars else None), []
    out = [
        {"time": x["time"], "side": x["side"], "label": x["label"], "entry": x["entry"], "stop_loss": x["stop_loss"],
         "take_profit": x["take_profit"], "outcome": x["outcome"],
         "exit_time": None if x["exit_index"] is None else bars[x["exit_index"]]["time"], "bars_ago": len(bars) - 1 - x["index"],
         "r": x["r"]}
        for x in result["signals"][-recent:]
    ]
    return bars[-1]["time"], out


def _scalper(m: ca.Market, timeframe: str, recent: int = 10) -> tuple[str | None, list[dict]]:
    result = ca.scalper_signal(m, timeframe, history_bars=EXPIRY_BARS, history_count=recent)
    out = [{**x, "label": f"{x['side']} · UT Bot"} for x in result.get("history") or []]
    return result.get("last_bar"), out


ENGINES: dict[str, Callable[[ca.Market, str, int], tuple[str | None, list[dict]]]] = {"pob": _pob, "scalper": _scalper, "fib": _fib}


def _frame(bars: list[dict]) -> pd.DataFrame:
    """The server's bars in the loader's shape, times as the Binance loader prints them ("2026-10-31 12:15")."""
    rows = [[str(b["time"]).replace("T", " ")[:16], float(b["open"]), float(b["high"]), float(b["low"]), float(b["close"])] for b in bars]
    return pd.DataFrame(rows, columns=["Date", "Open", "High", "Low", "Close"])


@contextmanager
def _given(frame: pd.DataFrame | None) -> Iterator[None]:
    """The engines read their bars through _scalper_bars; hand them these instead of downloading (as lab.py does)."""
    if frame is None:
        yield
        return
    original = ca._scalper_bars
    ca._scalper_bars = lambda _m, _tf: frame.copy()
    try:
        yield
    finally:
        ca._scalper_bars = original


def scan(job: dict, emit: Callable[..., None]) -> int:
    for pair in job.get("pairs") or []:
        symbol, timeframe, venue = str(pair.get("symbol") or ""), str(pair.get("timeframe") or ""), str(pair.get("venue") or "")
        frame = None
        try:
            if pair.get("bars"):
                frame = _frame(pair["bars"])
            # Daily bars come from the engine's own loader (adjusted, as the chart shows them); intraday ones are fetched per engine call.
            if timeframe == "1d" and frame is None:
                m = ca.Market(symbol)
            else:
                m = ca.Market.__new__(ca.Market)
                m.symbol = symbol
        except Exception as exc:
            emit("signals_error", symbol=symbol, timeframe=timeframe, venue=venue, indicator="*", message=f"{type(exc).__name__}: {exc}"[:300])
            continue
        for indicator in pair.get("indicators") or []:
            engine = ENGINES.get(indicator)
            if not engine:
                continue
            try:
                # The ledger asks a pair it has never seen for its history (up to 300 signals).
                recent = max(1, min(int(pair.get("recent") or 10), 300))
                with _given(frame):
                    last_bar, signals = engine(m, timeframe, recent)
                emit("signals", symbol=symbol, timeframe=timeframe, venue=venue, indicator=indicator, last_bar=last_bar, signals=signals)
            except Exception as exc:  # one symbol failing must not stop the others
                emit("signals_error", symbol=symbol, timeframe=timeframe, venue=venue, indicator=indicator, message=f"{type(exc).__name__}: {exc}"[:300])
    emit("done")
    return 0
