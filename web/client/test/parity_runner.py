"""Runs one of the server's indicator engines (web/worker) on candles read from
stdin and prints its signals as JSON, under the TypeScript engines' field
names, for indicators-parity.test.ts: the chart draws the TypeScript engines,
the notifications come from these, and the test checks that both agree.

stdin:  {"engine": "pob" | "fib" | "scalper", "timeframe": "15m" | "1h" | "1d", "candles": [Candle, ...]}
        a scalper job may add "settings": a user's own inputs, as the server passes them (shared/scalper.ts)
        {"engine": "defaults"} for the settings each engine runs with on the server
stdout: {"signals": [...]} or {"defaults": {...}}

Each engine runs as the signal scan runs it (web/worker/signals.py): bars
shaped as the scan shapes them (times as "2026-10-31 12:15", floats, no
volume), the engines' own defaults, and the scalper through signals._scalper
with the server's expiry. Field names are mapped here, never in the engines.
"""

from __future__ import annotations

import inspect
import json
import os
import re
import sys

WORKER = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "worker"))
sys.path.insert(0, WORKER)

# Settings of scalper_signal that only shape its output for notifications, not the signals themselves.
SCALPER_OUTPUT_ARGS = {"m", "timeframe", "history_bars", "history_count"}


def camel(key: str) -> str:
    """stop_loss -> stopLoss: the Python name of a field or setting as the TypeScript engines spell it."""
    return re.sub(r"_([a-z])", lambda m: m.group(1).upper(), key)


def camel_keys(row: dict) -> dict:
    return {camel(k): v for k, v in row.items()}


def scan_bars(candles: list[dict]) -> list[dict]:
    """The bars signals._pob and signals._fib hand the engines, for bars the server sends (signals._frame)."""
    return [{"time": str(c["time"]).replace("T", " ")[:16], "open": float(c["open"]), "high": float(c["high"]),
             "low": float(c["low"]), "close": float(c["close"])} for c in candles]


def run_pob(candles: list[dict], timeframe: str) -> list[dict]:
    from pob import pob

    result = pob(scan_bars(candles), timeframe)
    return [camel_keys(x) for x in (result or {}).get("signals", [])]


def run_fib(candles: list[dict], timeframe: str) -> list[dict]:
    from fib import fib

    result = fib(scan_bars(candles))
    return [camel_keys(x) for x in (result or {}).get("signals", [])]


def run_scalper(candles: list[dict], timeframe: str, settings: dict | None = None) -> list[dict]:
    """signals._scalper, the scan's own call (history_bars=EXPIRY_BARS), on these bars, with every signal kept,
    and with a user's own inputs when the job has them."""
    import signals as scan

    frame = scan._frame(candles)
    market = scan.ca.Market.__new__(scan.ca.Market)  # as scan() builds it for bars the server sends
    market.symbol = "PARITY"
    with scan._given(frame):
        _, history = scan._scalper(market, timeframe, len(candles), settings)
    last = len(frame) - 1
    row_of = {t: k for k, t in enumerate(frame["Date"])}
    out = []
    for x in history:
        sig = camel_keys(x)
        sig["index"] = last - x["bars_ago"]
        sig["exitIndex"] = None if x["exit_time"] is None else row_of[x["exit_time"]]
        out.append(sig)
    return out


def defaults() -> dict:
    """The settings each engine runs with in the scan: signals.py passes none, so the engines' own defaults."""
    import chart_agent
    from fib import FIB_DEFAULTS
    from pob import POB_DEFAULTS

    params = inspect.signature(chart_agent.scalper_signal).parameters.values()
    scalper = {p.name: p.default for p in params if p.name not in SCALPER_OUTPUT_ARGS}
    return {"pob": camel_keys(POB_DEFAULTS), "fib": camel_keys(FIB_DEFAULTS), "scalper": camel_keys(scalper)}


ENGINES = {"pob": run_pob, "fib": run_fib, "scalper": run_scalper}


def main() -> int:
    job = json.loads(sys.stdin.buffer.read())
    if job["engine"] == "defaults":
        out = {"defaults": defaults()}
    elif job["engine"] == "scalper":
        out = {"signals": run_scalper(job["candles"], job["timeframe"], job.get("settings"))}
    else:
        out = {"signals": ENGINES[job["engine"]](job["candles"], job["timeframe"])}
    sys.stdout.write(json.dumps(out, allow_nan=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
