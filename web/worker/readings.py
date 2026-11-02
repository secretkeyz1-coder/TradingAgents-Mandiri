"""The indicators an analysis reads (``ta_worker.py run`` and ``backtest``; ADR 0017).

A request may carry up to three indicators the user picked, copied in by the server
(web/server/src/readings.ts): a built-in engine with the user's own Scalper inputs, or a
script's source. Before the engine starts, each is computed on its own candles cut at every
analysis date, so a reading on a past date sees nothing after it. The Market Analyst gets
the readings of its cell with its instrument context (``install``); the other agents read
its report. The log says what was read and what could not be.

Candles come from the server's own loader through web/server/src/script-cli.ts (the strategy
lab's long history: Binance for crypto, Yahoo otherwise). The engines run here as the chart
agent runs them (chart_agent); scripts run in the chart's sandbox, through the same CLI.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, timedelta

import chart_agent as ca
import pandas as pd
from signals import EXPIRY_BARS, SCALPER_ARGS

# How far back one reading looks, in days: the chart's own windows for 15m (a month) and
# hourly bars (a year), two years of daily bars. Also the history loaded before the first date.
WINDOW_DAYS = {"15m": 30, "1h": 365, "1d": 730}
TIMEFRAME_LABELS = {"15m": "15 menit", "1h": "1 jam", "1d": "harian"}
CLI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server", "src", "script-cli.ts")


def _cli(job: dict, timeout: float) -> dict:
    """One job for script-cli.ts; its answer is the last line it prints."""
    bun = os.environ.get("TA_BUN_BIN") or "bun"
    done = subprocess.run([bun, CLI], input=json.dumps(job), capture_output=True, text=True, timeout=timeout,
                          encoding="utf-8")
    lines = done.stdout.strip().splitlines()
    if not lines:
        raise ValueError(done.stderr.strip()[-300:] or f"script-cli berhenti (exit {done.returncode})")
    answer = json.loads(lines[-1])
    if not answer.get("ok"):
        raise ValueError(answer.get("error") or "gagal")
    return answer


def cut(bars: list[dict], day: str, timeframe: str) -> tuple[int, int]:
    """The bars a reading on ``day`` sees, as [start, end): up to and including that day, WINDOW_DAYS back."""
    first = (date.fromisoformat(day) - timedelta(days=WINDOW_DAYS[timeframe])).isoformat()
    start = next((i for i, b in enumerate(bars) if b["time"][:10] > first), len(bars))
    end = next((i for i, b in enumerate(bars) if b["time"][:10] > day), len(bars))
    return start, max(start, end)


@contextmanager
def _candles(df: pd.DataFrame) -> Iterator[None]:
    """The chart agent's engines read their candles through _scalper_bars: these, instead of a download."""
    original = ca._scalper_bars
    ca._scalper_bars = lambda _m, _tf: df.copy()
    try:
        yield
    finally:
        ca._scalper_bars = original


def engine_reading(pick: dict, symbol: str, bars: list[dict]) -> dict:
    """A built-in engine on these bars, answered as the chart agent's tools answer."""
    df = pd.DataFrame([[b["time"], b["open"], b["high"], b["low"], b["close"]] for b in bars],
                      columns=["Date", "Open", "High", "Low", "Close"])
    m = ca.Market.__new__(ca.Market)
    m.symbol = symbol
    timeframe = pick["timeframe"]
    with _candles(df):
        if pick["engine"] == "pob":
            return ca.pob_signal(m, timeframe, recent=3)
        if pick["engine"] == "fib":
            return ca.fib_golden_zone(m, timeframe, recent=3)
        settings = {SCALPER_ARGS[k]: v for k, v in (pick.get("settings") or {}).items() if k in SCALPER_ARGS}
        return ca.scalper_signal(m, timeframe, **settings, history_bars=EXPIRY_BARS, history_count=3)


def _tidy(value):
    """A reading as the model reads it: prices rounded as the chart agent rounds them, without the
    sandbox's bar indexes, empty tally rows and the note the prompt already makes."""
    if isinstance(value, float):
        return ca._r(value)
    if isinstance(value, list):
        return [_tidy(v) for v in value if not (isinstance(v, dict) and v.get("count") == 0)]
    if isinstance(value, dict):
        return {k: _tidy(v) for k, v in value.items() if k not in ("note", "index", "exitIndex")}
    return value


def _state(reading: dict) -> str:
    """One reading in a few words, for the log."""
    if "error" in reading:
        return f"tidak terbaca ({reading['error']})"
    active = reading.get("active_signal") or next(
        (s for s in reversed(reading.get("recent_signals") or []) if s.get("outcome") == "open"), None)
    if active:
        return f"sinyal {active.get('label') or active.get('side')} aktif"
    last = reading.get("last_signal")
    if last:
        return f"sinyal terakhir {last['side']}, {last['bars_ago']} candle sebelumnya"
    leg = reading.get("waiting_leg")
    if leg:
        return f"menunggu pullback, arah {leg['direction']}"
    return "tidak ada sinyal aktif"


class Readings:
    """Every pick's reading for every (ticker, day) of one run, computed before the engine starts."""

    def __init__(self, picks: list[dict], tickers: list[str], days: list[str]):
        self.picks = picks
        self.days = sorted(set(days))
        self.at: dict[tuple[str, str], list[tuple[dict, dict]]] = {}
        self._bars: dict[tuple[str, str], list[dict] | str] = {}
        for ticker in dict.fromkeys(tickers):
            for pick in picks:
                found = self._read(pick, ticker)
                for day in self.days:
                    self.at.setdefault((ticker, day), []).append((pick, found[day]))

    def _bars_of(self, ticker: str, timeframe: str) -> list[dict] | str:
        """The candles for every day of the run, loaded once per ticker and timeframe; why not, as text."""
        if (ticker, timeframe) not in self._bars:
            span = (date.today() - date.fromisoformat(self.days[0])).days
            try:
                answer = _cli({"mode": "bars", "symbol": ticker, "timeframe": timeframe,
                               "days": span + WINDOW_DAYS[timeframe] + 1}, timeout=180)
                self._bars[(ticker, timeframe)] = answer["bars"]
            except Exception as exc:  # the run goes on without this indicator
                self._bars[(ticker, timeframe)] = f"candle {timeframe} tidak bisa dimuat: {exc}"
        return self._bars[(ticker, timeframe)]

    def _read(self, pick: dict, ticker: str) -> dict[str, dict]:
        timeframe = pick["timeframe"]
        bars = self._bars_of(ticker, timeframe)
        if isinstance(bars, str):
            return dict.fromkeys(self.days, {"error": bars})
        cuts = {day: cut(bars, day, timeframe) for day in self.days}
        out: dict[str, dict] = {}
        for day, (start, end) in cuts.items():
            if end - start < 2:
                out[day] = {"error": f"belum ada candle {timeframe} sampai {day}"}
        todo = [day for day in self.days if day not in out]
        if "code" in pick and todo:
            job = {"mode": "script", "code": pick["code"], "timeframe": timeframe, "bars": bars,
                   "cuts": [{"day": day, "start": cuts[day][0], "end": cuts[day][1]} for day in todo]}
            try:
                out.update(_cli(job, timeout=60 + 30 * len(todo))["at"])
            except Exception as exc:
                out.update(dict.fromkeys(todo, {"error": str(exc)}))
        else:
            for day in todo:
                try:
                    out[day] = engine_reading(pick, ticker, bars[cuts[day][0]:cuts[day][1]])
                except Exception as exc:
                    out[day] = {"error": str(exc)}
        return out

    def prompt(self, ticker: str, day: str) -> str:
        """What the Market Analyst is told for this cell: the readings and how to use them; empty for none."""
        rows = self.at.get((ticker, day))
        if not rows:
            return ""
        lines = [
            "Indicators the user reads on their chart, which they asked this analysis to take into account. The app "
            f"computed them from candles up to and including {day}, nothing later. For each one, say what it shows as of "
            "that date (its active signal if any, its recent signals and how they ended, its levels), whether it agrees "
            "with your own indicators, and give it a row in your table. These are the app's figures: quote them, do not "
            "recompute or invent them. A tally is a quick count on the loaded candles without trading costs, not a backtest."
        ]
        for pick, reading in rows:
            kind = "built-in indicator" if pick.get("engine") else "user script"
            where = f"{pick['name']} ({kind}, {pick['timeframe']} candles)"
            if "error" in reading:
                lines.append(f"- {where}: not available for this date ({reading['error']}).")
            else:
                lines.append(f"- {where}: {json.dumps(_tidy(reading), ensure_ascii=False)}")
        return "\n".join(lines)

    def summary(self, ticker: str, day: str) -> str:
        """What was read for this cell, for the log."""
        rows = self.at.get((ticker, day)) or []
        parts = [f"{p['name']} ({TIMEFRAME_LABELS[p['timeframe']]}): {_state(r)}" for p, r in rows]
        return f"Indikator yang dibaca AI untuk {ticker}, dari candle sampai {day}: " + "; ".join(parts) + "."

    def overview(self) -> str:
        """What a sweep read across its cells, for the log: how many cells each indicator reached, and why not."""
        parts = []
        for pick in self.picks:
            cells = [(t, d, r) for (t, d), rows in self.at.items() for p, r in rows if p is pick]
            missed = [(t, d, r["error"]) for t, d, r in cells if "error" in r]
            text = f"{pick['name']} ({TIMEFRAME_LABELS[pick['timeframe']]}): {len(cells) - len(missed)} dari {len(cells)} sel"
            if missed:
                t, d, why = missed[0]
                text += f"; tidak terbaca misalnya {t} {d}: {why}"
            parts.append(text)
        return "Indikator yang dibaca AI, dari candle sampai tiap tanggal uji: " + "; ".join(parts) + "."


def install(readings: Readings) -> None:
    """Give the Market Analyst its cell's readings with its instrument context, in this worker process only."""
    import tradingagents.graph.setup as setup
    from tradingagents.agents.context import get_instrument_context_from_state

    create = setup.create_market_analyst

    def create_market_analyst(llm):
        node = create(llm)

        def market_analyst_node(state):
            note = readings.prompt(str(state["company_of_interest"]), str(state["trade_date"]))
            if not note:
                return node(state)
            return node({**state, "instrument_context": f"{get_instrument_context_from_state(state)}\n\n{note}"})

        return market_analyst_node

    # The graph builds its analysts through this module's name at build time (tradingagents/graph/setup.py).
    setup.create_market_analyst = create_market_analyst
