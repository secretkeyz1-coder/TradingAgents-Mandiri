"""Signal scan for the notification scheduler (``ta_worker.py signals``).

For each (symbol, timeframe) the server asks about, the bars are downloaded
once and the same engines the chart and the agent use are run on them:
PoB BYSTRA (pob.py) and Scalper Pro+ (chart_agent.scalper_signal). Each
answers its last ten signals with frozen levels, their outcome so far and how
many bars ago they fired. Only closed bars count; the server decides what is
new and what to send.
"""

from __future__ import annotations

from collections.abc import Callable

import chart_agent as ca
from pob import pob

# Bars a scalper signal is followed before it counts as expired, as PoB does.
EXPIRY_BARS = 96


def _pob(m: ca.Market, timeframe: str) -> tuple[str | None, list[dict]]:
    df = ca._scalper_bars(m, timeframe)
    bars = [{"time": r.Date, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close)} for r in df.itertuples()]
    result = pob(bars, timeframe)
    if result is None:
        return (bars[-1]["time"] if bars else None), []
    out = [
        {"time": x["time"], "side": x["side"], "label": x["label"], "entry": x["entry"], "stop_loss": x["stop_loss"],
         "take_profit": x["take_profit"], "outcome": x["outcome"],
         "exit_time": None if x["exit_index"] is None else bars[x["exit_index"]]["time"], "bars_ago": len(bars) - 1 - x["index"]}
        for x in result["signals"][-10:]
    ]
    return bars[-1]["time"], out


def _fib(m: ca.Market, timeframe: str) -> tuple[str | None, list[dict]]:
    from fib import fib

    df = ca._scalper_bars(m, timeframe)
    bars = [{"time": r.Date, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close)} for r in df.itertuples()]
    result = fib(bars)
    if result is None:
        return (bars[-1]["time"] if bars else None), []
    out = [
        {"time": x["time"], "side": x["side"], "label": x["label"], "entry": x["entry"], "stop_loss": x["stop_loss"],
         "take_profit": x["take_profit"], "outcome": x["outcome"],
         "exit_time": None if x["exit_index"] is None else bars[x["exit_index"]]["time"], "bars_ago": len(bars) - 1 - x["index"]}
        for x in result["signals"][-10:]
    ]
    return bars[-1]["time"], out


def _scalper(m: ca.Market, timeframe: str) -> tuple[str | None, list[dict]]:
    result = ca.scalper_signal(m, timeframe, history_bars=EXPIRY_BARS)
    out = [{**x, "label": f"{x['side']} · UT Bot"} for x in result.get("history") or []]
    return result.get("last_bar"), out


ENGINES: dict[str, Callable[[ca.Market, str], tuple[str | None, list[dict]]]] = {"pob": _pob, "scalper": _scalper, "fib": _fib}


def scan(job: dict, emit: Callable[..., None]) -> int:
    for pair in job.get("pairs") or []:
        symbol, timeframe = str(pair.get("symbol") or ""), str(pair.get("timeframe") or "")
        try:
            # Daily bars come from the engine's own loader (adjusted, as the chart shows them); intraday ones are fetched per engine call.
            if timeframe == "1d":
                m = ca.Market(symbol)
            else:
                m = ca.Market.__new__(ca.Market)
                m.symbol = symbol
        except Exception as exc:
            emit("signals_error", symbol=symbol, timeframe=timeframe, indicator="*", message=f"{type(exc).__name__}: {exc}"[:300])
            continue
        for indicator in pair.get("indicators") or []:
            engine = ENGINES.get(indicator)
            if not engine:
                continue
            try:
                last_bar, signals = engine(m, timeframe)
                emit("signals", symbol=symbol, timeframe=timeframe, indicator=indicator, last_bar=last_bar, signals=signals)
            except Exception as exc:  # one symbol failing must not stop the others
                emit("signals_error", symbol=symbol, timeframe=timeframe, indicator=indicator, message=f"{type(exc).__name__}: {exc}"[:300])
    emit("done")
    return 0
