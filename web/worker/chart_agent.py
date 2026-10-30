"""The chart agent: a tool-calling LLM that reads the market with deterministic
skills, draws its analysis on the chart, and remembers what the user tells it.

Numbers never come from the model. Every price and date it draws must come
from a skill's output, and every drawing is checked against the real price
history before it is sent. The agent analyses; it cannot place orders.

Run through ``ta_worker.py agent`` with one job as JSON on stdin; events go to
stdout as JSON lines (see ``run_agent``).
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Callable
from datetime import date, timedelta

import pandas as pd

MAX_STEPS = 8
# Scalper Pro+ reads recent intraday bars; same window the page's chart loads, so both find the same signal.
SCALPER_BARS = {"15m": ("15m", "1mo"), "1h": ("60m", "1y")}
MAX_TOOL_CALLS = 24
FIB_RATIOS = (0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0)

Emit = Callable[..., None]


# --------------------------------------------------------------------------- market data


class Market:
    """Daily candles for one symbol, up to today, loaded once per turn."""

    def __init__(self, symbol: str):
        from tradingagents.dataflows.vendors.yahoo.ohlcv import load_ohlcv

        df = load_ohlcv(symbol, date.today().isoformat())
        df = df.dropna(subset=["Close"]).copy()
        df["Date"] = pd.to_datetime(df["Date"]).dt.strftime("%Y-%m-%d")
        self.symbol = symbol
        self.df = df.reset_index(drop=True)
        self.first_date = self.df["Date"].iloc[0]
        self.last_date = self.df["Date"].iloc[-1]
        self.low = float(self.df["Low"].min())
        self.high = float(self.df["High"].max())

    def window(self, lookback: int) -> pd.DataFrame:
        return self.df.tail(max(20, min(int(lookback), len(self.df)))).reset_index(drop=True)

    @property
    def last_close(self) -> float:
        return float(self.df["Close"].iloc[-1])


def _r(x: float) -> float:
    """Round a price for the model: enough digits for forex and crypto, not noise."""
    x = float(x)
    return round(x, 2 if abs(x) >= 10 else 5)


# --------------------------------------------------------------------------- analysis skills


def market_summary(m: Market) -> dict:
    df = m.df
    close = df["Close"]
    last = m.last_close
    year = df.tail(252)
    return {
        "symbol": m.symbol,
        "last_date": m.last_date,
        "last_close": _r(last),
        "change_1d_pct": round((last / float(close.iloc[-2]) - 1) * 100, 2) if len(df) > 1 else None,
        "change_20d_pct": round((last / float(close.iloc[-21]) - 1) * 100, 2) if len(df) > 21 else None,
        "high_52w": _r(year["High"].max()),
        "low_52w": _r(year["Low"].min()),
        "data_from": m.first_date,
    }


def find_pivots(m: Market, lookback: int = 120, window: int = 5) -> dict:
    df = m.window(lookback)
    w = max(2, min(int(window), 15))
    highs, lows = [], []
    for i in range(w, len(df) - w):
        seg = df.iloc[i - w : i + w + 1]
        if df["High"].iloc[i] == seg["High"].max():
            highs.append({"date": df["Date"].iloc[i], "price": _r(df["High"].iloc[i])})
        if df["Low"].iloc[i] == seg["Low"].min():
            lows.append({"date": df["Date"].iloc[i], "price": _r(df["Low"].iloc[i])})
    return {"swing_highs": highs[-10:], "swing_lows": lows[-10:], "lookback_days": len(df)}


def support_resistance(m: Market, lookback: int = 180, tolerance_pct: float = 1.5) -> dict:
    piv = find_pivots(m, lookback, 5)
    points = [(p["price"], p["date"]) for p in piv["swing_highs"] + piv["swing_lows"]]
    # Pivots from the whole window, not only the last ten, for touch counts.
    df = m.window(lookback)
    for i in range(5, len(df) - 5):
        seg = df.iloc[i - 5 : i + 6]
        if df["High"].iloc[i] == seg["High"].max():
            points.append((float(df["High"].iloc[i]), df["Date"].iloc[i]))
        if df["Low"].iloc[i] == seg["Low"].min():
            points.append((float(df["Low"].iloc[i]), df["Date"].iloc[i]))
    tol = max(0.1, float(tolerance_pct)) / 100
    clusters: list[dict] = []
    for price, day in sorted(set(points)):
        if clusters and abs(price - clusters[-1]["mean"]) / clusters[-1]["mean"] <= tol:
            c = clusters[-1]
            c["prices"].append(price)
            c["mean"] = sum(c["prices"]) / len(c["prices"])
            c["last"] = max(c["last"], day)
        else:
            clusters.append({"prices": [price], "mean": price, "last": day})
    last = m.last_close
    levels = [
        {
            "price": _r(c["mean"]),
            "touches": len(c["prices"]),
            "last_touch": c["last"],
            "role": "support" if c["mean"] < last else "resistance",
            "distance_pct": round((c["mean"] / last - 1) * 100, 2),
        }
        for c in clusters
    ]
    levels.sort(key=lambda lv: (-lv["touches"], abs(lv["distance_pct"])))
    return {"last_close": _r(last), "levels": levels[:8]}


def fit_trendline(m: Market, kind: str = "support", lookback: int = 120) -> dict:
    piv = find_pivots(m, lookback, 4)
    pts = piv["swing_lows"] if kind == "support" else piv["swing_highs"]
    df = m.window(lookback)
    index = {d: i for i, d in enumerate(df["Date"])}
    best = None
    pts = pts[-6:]
    for a in range(len(pts)):
        for b in range(a + 1, len(pts)):
            p1, p2 = pts[a], pts[b]
            i1, i2 = index[p1["date"]], index[p2["date"]]
            slope = (p2["price"] - p1["price"]) / (i2 - i1)
            violations = 0
            for i in range(i1, len(df)):
                line = p1["price"] + slope * (i - i1)
                v = df["Low"].iloc[i] if kind == "support" else df["High"].iloc[i]
                if (kind == "support" and v < line * 0.99) or (kind == "resistance" and v > line * 1.01):
                    violations += 1
            score = (violations, -(i2 - i1))
            if best is None or score < best[0]:
                best = (score, p1, p2, slope, i1)
    if best is None:
        return {"found": False, "reason": "kurang dari dua pivot di rentang ini"}
    (violations, _), p1, p2, slope, i1 = best
    now = p1["price"] + slope * (len(df) - 1 - i1)
    return {
        "found": True,
        "kind": kind,
        "from": {"date": p1["date"], "price": p1["price"]},
        "to": {"date": p2["date"], "price": p2["price"]},
        "projected_today": {"date": m.last_date, "price": _r(now)},
        "slope_per_day": _r(slope),
        "violations_since_start": violations,
    }


def fibonacci(m: Market, lookback: int = 120) -> dict:
    df = m.window(lookback)
    hi_i, lo_i = int(df["High"].idxmax()), int(df["Low"].idxmin())
    high, low = float(df["High"].iloc[hi_i]), float(df["Low"].iloc[lo_i])
    up = lo_i < hi_i
    return {
        "trend": "naik (low lalu high)" if up else "turun (high lalu low)",
        "high": {"date": df["Date"].iloc[hi_i], "price": _r(high)},
        "low": {"date": df["Date"].iloc[lo_i], "price": _r(low)},
        "levels": [{"ratio": r, "price": _r(high - (high - low) * r)} for r in FIB_RATIOS],
    }


def indicators(m: Market) -> dict:
    df = m.df
    c = df["Close"]
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rsi = 100 - 100 / (1 + gain / loss.replace(0, float("nan")))
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    sma20, std20 = c.rolling(20).mean(), c.rolling(20).std()
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - c.shift()).abs(), (df["Low"] - c.shift()).abs()], axis=1).max(axis=1)
    vol20 = df["Volume"].rolling(20).mean()

    def last(s):
        v = s.iloc[-1]
        return None if pd.isna(v) else _r(v)

    return {
        "date": m.last_date,
        "close": _r(c.iloc[-1]),
        "sma20": last(sma20),
        "sma50": last(c.rolling(50).mean()),
        "sma200": last(c.rolling(200).mean()),
        "rsi14": None if pd.isna(rsi.iloc[-1]) else round(float(rsi.iloc[-1]), 1),
        "macd": last(macd),
        "macd_signal": last(signal),
        "bb_upper": last(sma20 + 2 * std20),
        "bb_lower": last(sma20 - 2 * std20),
        "atr14": last(tr.rolling(14).mean()),
        "volume_vs_20d": None if pd.isna(vol20.iloc[-1]) or not vol20.iloc[-1] else round(float(df["Volume"].iloc[-1] / vol20.iloc[-1]), 2),
    }


# One download per symbol and timeframe per worker process: a signal scan reads
# the same bars for Scalper Pro+ and PoB BYSTRA.
_BARS_CACHE: dict[tuple[str, str], pd.DataFrame] = {}


def _scalper_bars(m: Market, timeframe: str) -> pd.DataFrame:
    """Daily bars from the turn's market, or recent intraday bars from Yahoo."""
    if timeframe == "1d":
        return m.df[["Date", "Open", "High", "Low", "Close"]].copy()
    if timeframe not in SCALPER_BARS:
        raise ValueError("timeframe harus 15m, 1h atau 1d")
    cached = _BARS_CACHE.get((m.symbol, timeframe))
    if cached is not None:
        return cached.copy()
    import yfinance as yf

    interval, period = SCALPER_BARS[timeframe]
    df = yf.Ticker(m.symbol).history(period=period, interval=interval, auto_adjust=False)
    if df.empty:
        raise ValueError(f"Yahoo tidak punya candle {timeframe} untuk {m.symbol}")
    df = df.reset_index()
    # Exchange-local wall-clock time, as the page's chart shows it.
    df["Date"] = pd.to_datetime(df[df.columns[0]]).dt.strftime("%Y-%m-%d %H:%M")
    df = df[["Date", "Open", "High", "Low", "Close"]].dropna().reset_index(drop=True)
    _BARS_CACHE[(m.symbol, timeframe)] = df
    return df.copy()


def scalper_signal(
    m: Market,
    timeframe: str = "15m",
    sensitivity: float = 1.0,
    atr_period: int = 10,
    use_heikin_ashi: int = 0,
    ema_fast: int = 20,
    ema_slow: int = 50,
    rsi_period: int = 14,
    rsi_buy_min: float = 50,
    rsi_sell_max: float = 50,
    use_trend_filter: int = 1,
    use_rsi_filter: int = 1,
    use_sweep: int = 0,
    pivot_len: int = 5,
    atr_risk: int = 14,
    sl_atr: float = 1.5,
    risk_reward: float = 2.0,
    entry_zone_atr: float = 0.25,
    history_bars: int = 0,
) -> dict:
    """Scalper Pro+ (the user's Pine script): UT Bot trail crossings, filtered by
    the EMA trend, RSI and optionally a liquidity sweep, with ATR stop/target.
    Mirrors web/client/src/lib/indicators/scalper.ts; change both together.
    Signals come only from closed bars: the newest bar may still be forming.
    history_bars > 0 adds the last ten signals, each followed for at most that
    many bars to its stop, target or the next signal (for notifications)."""
    df = _scalper_bars(m, timeframe)
    n = len(df)
    if n < max(int(ema_slow), int(atr_risk)) + 5:
        return {"timeframe": timeframe, "error": f"baru {n} candle {timeframe}, kurang untuk menghitung"}
    o, h, lo, c = (df[k].astype(float).tolist() for k in ("Open", "High", "Low", "Close"))
    src = [(o[i] + h[i] + lo[i] + c[i]) / 4 for i in range(n)] if use_heikin_ashi else c

    def rma(values: list[float], length: int) -> list[float]:
        out = [values[0]]
        for v in values[1:]:
            out.append((out[-1] * (length - 1) + v) / length)
        return out

    def ema(values: list[float], length: int) -> list[float]:
        k = 2 / (length + 1)
        out = [values[0]]
        for v in values[1:]:
            out.append(v * k + out[-1] * (1 - k))
        return out

    tr = [h[0] - lo[0]] + [max(h[i] - lo[i], abs(h[i] - c[i - 1]), abs(lo[i] - c[i - 1])) for i in range(1, n)]
    atr_ut, atr_rk = rma(tr, int(atr_period)), rma(tr, int(atr_risk))
    trail = [src[0] - float(sensitivity) * atr_ut[0]]
    for i in range(1, n):
        prev, s, s1, loss = trail[-1], src[i], src[i - 1], float(sensitivity) * atr_ut[i]
        if s > prev and s1 > prev:
            trail.append(max(prev, s - loss))
        elif s < prev and s1 < prev:
            trail.append(min(prev, s + loss))
        else:
            trail.append(s - loss if s > prev else s + loss)
    fast, slow = ema(c, int(ema_fast)), ema(c, int(ema_slow))
    gain = rma([0.0] + [max(c[i] - c[i - 1], 0.0) for i in range(1, n)], int(rsi_period))
    drop = rma([0.0] + [max(c[i - 1] - c[i], 0.0) for i in range(1, n)], int(rsi_period))
    rsi = [100.0 if d == 0 else 100 - 100 / (1 + g / d) for g, d in zip(gain, drop)]
    L = max(2, int(pivot_len))

    def bull(i: int) -> bool:
        return fast[i] > slow[i] and c[i] > slow[i]

    def bear(i: int) -> bool:
        return fast[i] < slow[i] and c[i] < slow[i]

    def sweep_low(i: int) -> bool:
        return i >= L and lo[i] < min(lo[i - L : i]) < c[i]

    def sweep_high(i: int) -> bool:
        return i >= L and h[i] > max(h[i - L : i]) > c[i]

    signals = []
    for i in range(1, n - 1):  # the last bar is still forming
        up = src[i] > trail[i] and src[i - 1] <= trail[i - 1]
        down = src[i] < trail[i] and src[i - 1] >= trail[i - 1]
        if up and (not use_trend_filter or bull(i)) and (not use_rsi_filter or rsi[i] >= rsi_buy_min) and (not use_sweep or sweep_low(i)):
            signals.append((i, "BUY"))
        elif down and (not use_trend_filter or bear(i)) and (not use_rsi_filter or rsi[i] <= rsi_sell_max) and (not use_sweep or sweep_high(i)):
            signals.append((i, "SELL"))

    def pivots(values: list[float], high: bool) -> list[int]:
        out = []
        for i in range(L, n - L):
            side = values[i - L : i] + values[i + 1 : i + L + 1]
            if (high and all(values[i] > v for v in side)) or (not high and all(values[i] < v for v in side)):
                out.append(i)
        return out

    def trendline(idx: list[int], values: list[float]) -> dict | None:
        if len(idx) < 2:
            return None
        a, b = idx[-2], idx[-1]
        slope = (values[b] - values[a]) / (b - a)
        return {"from": {"time": df["Date"].iloc[a], "price": _r(values[a])}, "to": {"time": df["Date"].iloc[b], "price": _r(values[b])},
                "projected_last_bar": _r(values[a] + slope * (n - 1 - a))}

    last = n - 1
    # Each recent signal with the levels it would have had, followed on closed bars
    # to its stop, target, the next signal (which replaces it, as on the chart) or expiry.
    history = []
    first = max(0, len(signals) - 10) if history_bars else len(signals)
    for pos in range(first, len(signals)):
        i, side = signals[pos]
        risk = atr_rk[i] * float(sl_atr)
        sign = 1 if side == "BUY" else -1
        entry, stop, target = c[i], c[i] - sign * risk, c[i] + sign * risk * float(risk_reward)
        nxt = signals[pos + 1][0] if pos + 1 < len(signals) else None
        outcome, exit_at = "open", None
        for k in range(i + 1, n - 1):
            if nxt is not None and k >= nxt:
                outcome, exit_at = "replaced", k
                break
            if (lo[k] <= stop) if sign == 1 else (h[k] >= stop):
                outcome, exit_at = "loss", k
                break
            if (h[k] >= target) if sign == 1 else (lo[k] <= target):
                outcome, exit_at = "win", k
                break
            if k - i >= history_bars:
                outcome, exit_at = "expired", k
                break
        history.append({"time": df["Date"].iloc[i], "side": side, "entry": entry, "stop_loss": stop, "take_profit": target,
                        "outcome": outcome, "exit_time": None if exit_at is None else df["Date"].iloc[exit_at], "bars_ago": last - i})
    result: dict = {
        "timeframe": timeframe,
        "bars": n,
        "last_bar": df["Date"].iloc[last],
        "close": _r(c[last]),
        "trend": "BULLISH" if bull(last) else "BEARISH" if bear(last) else "SIDEWAYS",
        "rsi": round(rsi[last], 1),
        "sweep": "LOW SWEPT" if sweep_low(last) else "HIGH SWEPT" if sweep_high(last) else "NONE",
        "ut_trail": _r(trail[last]),
        "ema_fast": _r(fast[last]),
        "ema_slow": _r(slow[last]),
        "resistance_line": trendline(pivots(h, True), h),
        "support_line": trendline(pivots(lo, False), lo),
        "recent_signals": [{"time": df["Date"].iloc[i], "side": s, "price": _r(c[i])} for i, s in signals[-5:]],
        "last_signal": None,
    }
    if history_bars:
        result["history"] = history
    if signals:
        i, side = signals[-1]
        risk = atr_rk[i] * float(sl_atr)
        half = atr_rk[i] * float(entry_zone_atr)
        sign = 1 if side == "BUY" else -1
        entry = c[i]
        result["last_signal"] = {
            "side": side,
            "time": df["Date"].iloc[i],
            "bars_ago": last - i,
            "entry": _r(entry),
            "stop_loss": _r(entry - sign * risk),
            "take_profit": _r(entry + sign * risk * float(risk_reward)),
            "entry_zone": {"top": _r(entry + half), "bottom": _r(entry - half)},
            "risk_reward": float(risk_reward),
        }
    return result


def pob_signal(m: Market, timeframe: str = "15m", recent: int = 5) -> dict:
    """PoB BYSTRA setups (pob.py): the latest signals with frozen entry/SL/TP and
    their outcomes, a per-setup tally over the loaded bars, and the trend."""
    from pob import pob

    if timeframe not in SCALPER_BARS:
        raise ValueError("PoB BYSTRA hanya untuk timeframe 15m atau 1h")
    df = _scalper_bars(m, timeframe)
    bars = [{"time": r.Date, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close)} for r in df.itertuples()]
    result = pob(bars, timeframe)
    if result is None:
        return {"timeframe": timeframe, "error": f"baru {len(bars)} candle {timeframe}, kurang untuk menghitung"}

    def level(x):
        return None if x is None else _r(x)

    signals = [
        {"time": x["time"], "label": x["label"], "side": x["side"], "setup": x["setup"], "entry": level(x["entry"]),
         "stop_loss": level(x["stop_loss"]), "take_profit": level(x["take_profit"]),
         "zone": None if x["zone_top"] is None else {"top": level(x["zone_top"]), "bottom": level(x["zone_bottom"])},
         "outcome": x["outcome"], "r": None if x["r"] is None else round(x["r"], 2)}
        for x in result["signals"]
    ]
    return {
        "timeframe": timeframe,
        "htf": result["htf"],
        "bars": len(bars),
        "from": bars[0]["time"],
        "last_bar": bars[-1]["time"],
        "trend": result["trend"],
        "active_signal": next((x for x in reversed(signals) if x["outcome"] == "open"), None),
        "recent_signals": signals[-max(1, min(int(recent), 20)):],
        "tally_on_loaded_bars": result["stats"],
        "note": "Tally = uji asap pada candle yang dimuat, tanpa biaya; bukan backtest. Sinyal hanya dari candle tutup.",
    }


def fib_golden_zone(m: Market, timeframe: str = "1d", recent: int = 5) -> dict:
    """Fibonacci golden zone pullbacks (fib.py): the leg still waiting for its
    pullback, recent signals with frozen levels and outcomes, and a tally."""
    from fib import fib, fib_level

    df = _scalper_bars(m, timeframe)
    bars = [{"time": r.Date, "open": float(r.Open), "high": float(r.High), "low": float(r.Low), "close": float(r.Close)} for r in df.itertuples()]
    result = fib(bars)
    if result is None:
        return {"timeframe": timeframe, "error": f"baru {len(bars)} candle {timeframe}, kurang untuk menghitung"}
    leg = result["active"]
    return {
        "timeframe": timeframe,
        "bars": len(bars),
        "last_bar": bars[-1]["time"],
        "waiting_leg": None if not leg else {
            "direction": "naik (tunggu BUY)" if leg["dir"] == 1 else "turun (tunggu SELL)",
            "from": {"time": bars[leg["from"]]["time"], "price": _r(leg["from_price"])},
            "to": {"time": bars[leg["to"]]["time"], "price": _r(leg["to_price"])},
            "golden_zone": {"0.5": _r(fib_level(leg, 0.5)), "0.618": _r(fib_level(leg, 0.618))},
            "invalid_0.786": _r(fib_level(leg, 0.786)),
        },
        "recent_signals": [
            {"time": x["time"], "label": x["label"], "entry": _r(x["entry"]), "stop_loss": _r(x["stop_loss"]),
             "take_profit": _r(x["take_profit"]), "outcome": x["outcome"], "r": None if x["r"] is None else round(x["r"], 2)}
            for x in result["signals"][-max(1, min(int(recent), 20)):]
        ],
        "tally_on_loaded_bars": result["stats"],
        "note": "Tally = uji asap pada candle yang dimuat, tanpa biaya; bukan backtest. Sinyal hanya dari candle tutup.",
    }


def snapshot(m: Market) -> dict:
    """What the agent knows at the start of every turn: the same figures the tools
    return, computed up front, so a plain question ("RSI?", "draw S/R") costs no
    model round trip just to fetch them."""
    sr = support_resistance(m, lookback=126)

    def nearest(role: str) -> list[dict]:
        return sorted((lv for lv in sr["levels"] if lv["role"] == role), key=lambda lv: abs(lv["distance_pct"]))[:2]

    return {
        "market_summary": market_summary(m),
        "indicators": indicators(m),
        "support_resistance_126d": {"nearest_support": nearest("support"), "nearest_resistance": nearest("resistance")},
    }


def latest_decisions(symbol: str, limit: int = 3) -> dict:
    """The engine's own memory log: past TradingAgents decisions on this ticker and how they turned out."""
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.memory import TradingMemoryLog

    entries = [e for e in TradingMemoryLog(DEFAULT_CONFIG).load_entries() if e["ticker"] == symbol]
    return {
        "decisions": [
            {
                "date": e["date"],
                "rating": e["rating"],
                "pending": e["pending"],
                "return": e.get("raw"),
                "alpha": e.get("alpha"),
                "decision": (e.get("decision") or "")[:400],
            }
            for e in entries[-limit:]
        ]
    }


# --------------------------------------------------------------------------- drawings


class DrawingError(ValueError):
    pass


class Canvas:
    """Turns draw_* calls into checked drawings: prices inside the instrument's
    real range, dates inside its history (a trendline may project 90 days ahead)."""

    def __init__(self, m: Market, emit: Emit):
        self.m = m
        self.emit = emit
        self.count = 0

    def price(self, value, name: str) -> float:
        try:
            v = float(value)
        except (TypeError, ValueError) as exc:
            raise DrawingError(f"{name} bukan angka") from exc
        if not (self.m.low * 0.5 <= v <= self.m.high * 1.5):
            raise DrawingError(f"{name}={v} di luar rentang harga {self.m.symbol} ({_r(self.m.low)}–{_r(self.m.high)})")
        return _r(v)

    def day(self, value, name: str, future_days: int = 0) -> str:
        try:
            d = date.fromisoformat(str(value))
        except ValueError as exc:
            raise DrawingError(f"{name} harus YYYY-MM-DD") from exc
        latest = date.fromisoformat(self.m.last_date) + timedelta(days=future_days)
        if not (self.m.first_date <= d.isoformat() <= latest.isoformat()):
            raise DrawingError(f"{name}={d} di luar data ({self.m.first_date}–{self.m.last_date})")
        return d.isoformat()

    def add(self, kind: str, label: str, data: dict) -> str:
        if self.count >= 30:
            raise DrawingError("terlalu banyak gambar dalam satu jawaban")
        self.count += 1
        drawing = {"id": str(uuid.uuid4()), "kind": kind, "label": str(label or "")[:60], "data": data}
        self.emit("drawing", drawing=drawing)
        return f"digambar ({kind}, id {drawing['id'][:8]})"


# --------------------------------------------------------------------------- the agent


def _system_prompt(job: dict, m: Market) -> str:
    language = job.get("language") or "Indonesian"
    memories = job.get("memories") or []
    user_mem = "\n".join(f"- [{x['id'][:8]}] {x['content']}" for x in memories if x.get("scope") == "user") or "(belum ada)"
    sym_mem = "\n".join(f"- [{x['id'][:8]}] {x['content']}" for x in memories if x.get("scope") == "symbol") or "(belum ada)"
    drawings = job.get("drawings") or []
    on_chart = "\n".join(f"- {d['kind']}: {d.get('label') or ''}" for d in drawings[-15:]) or "(kosong)"
    summary = job.get("summary") or "(tidak ada)"
    skills = "\n".join(
        f"- {s['definition']['name']} (v{s['version']}): {s['definition']['description']} — dipakai saat: {s['definition']['when_to_use']}"
        for s in job.get("skills") or []
    ) or "(belum ada)"
    return f"""You are the chart analyst inside a trading research web app. Answer in {language}.

Symbol in focus: {m.symbol}. Latest daily close: {m.last_date}. Today: {date.today().isoformat()}.

Computed by the analysis tools at the start of this turn. These are tool results: for the price, recent change,
indicators, or the nearest support and resistance, answer and draw straight from them without calling a tool.
Call an analysis tool only for something not here (another lookback, more levels, pivots, trendlines,
fibonacci, past decisions); every tool call makes the user wait several seconds.
{json.dumps(snapshot(m), ensure_ascii=False)}

Rules:
- Every price or date you state or draw must come from a tool result or the data above. Never estimate numbers yourself.
- To show analysis on the chart, call the draw_* tools. Draw only what supports your answer; prefer a few clear drawings.
- You analyse; you never place, suggest placing, or simulate orders. This is research, not financial advice; say so briefly when you give a trade plan.
- When the user states a lasting preference or fact about themselves or this symbol, store it with remember. Use forget when asked.
- Keep answers short: what you found, what you drew, the key levels.

What you remember about the user:
{user_mem}

What you remember about {m.symbol}:
{sym_mem}

Already on the chart:
{on_chart}

Summary of earlier conversation:
{summary}

Saved skills (approved by the user; call use_skill to load one when it fits):
{skills}

Skills: when the user asks to save a way of working as a skill, or agrees when you offer, call propose_skill.
It is tested on real prices and saved as a draft; the user approves it in the Skill panel before it can be used.
Never claim a proposed skill is active."""


# --------------------------------------------------------------------------- recipe skills
#
# A recipe skill is data, never code: a few analysis steps (the skills above,
# with parameters) plus an instruction for the agent. use_skill runs the steps
# and hands back their results with the instruction; the agent then draws with
# the ordinary draw_* tools, so every number still comes from a tool.

SKILL_STEPS: dict[str, Callable] = {
    "get_market_summary": lambda m: market_summary(m),
    "find_pivots": find_pivots,
    "support_resistance": support_resistance,
    "fit_trendline": fit_trendline,
    "fibonacci": fibonacci,
    "indicators": lambda m: indicators(m),
    "latest_decisions": lambda m: latest_decisions(m.symbol),
    "scalper_signal": scalper_signal,
    "pob_signal": pob_signal,
    "fib_golden_zone": fib_golden_zone,
}
SKILL_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{2,39}$")


class SkillError(ValueError):
    pass


def validate_skill(raw: dict) -> dict:
    """A clean skill definition, or SkillError naming what is wrong."""
    import inspect

    name = str(raw.get("name") or "").strip().lower()
    if not SKILL_NAME.match(name):
        raise SkillError("name: 3–40 huruf kecil, angka, atau tanda hubung")
    text = {k: str(raw.get(k) or "").strip() for k in ("title", "description", "when_to_use", "instruction")}
    # Models often leave the title out; the name says the same thing.
    text["title"] = text["title"] or name.replace("-", " ").capitalize()
    for key, limit in (("title", 60), ("description", 200), ("when_to_use", 200), ("instruction", 1500)):
        if not text[key]:
            raise SkillError(f"{key} wajib diisi")
        if len(text[key]) > limit:
            raise SkillError(f"{key} maksimal {limit} karakter")
    params = raw.get("params") or {}
    # The chat tools take a free-text `reason` for the reader; a model copies it into skills. It is not a parameter.
    if isinstance(params, dict):
        params = {k: v for k, v in params.items() if k != "reason"}
    if not isinstance(params, dict) or len(params) > 6:
        raise SkillError("params: objek dengan maksimal 6 parameter")
    for key, value in params.items():
        if not SKILL_NAME.match(key.replace("_", "-")) or not isinstance(value, (int, float, str)) or isinstance(value, bool):
            raise SkillError(f"parameter {key}: nama huruf kecil, nilai angka atau teks")
    steps = raw.get("steps") or []
    if not isinstance(steps, list) or not 1 <= len(steps) <= 6:
        raise SkillError("steps: 1–6 langkah analisa")
    clean_steps = []
    for i, step in enumerate(steps, 1):
        tool = (step or {}).get("tool")
        if tool not in SKILL_STEPS:
            raise SkillError(f"langkah {i}: alat {tool!r} tidak boleh; pilih dari {', '.join(SKILL_STEPS)}")
        args = {k: v for k, v in (step.get("args") or {}).items() if k != "reason"}
        accepted = set(inspect.signature(SKILL_STEPS[tool]).parameters) - {"m"}
        unknown = set(args) - accepted
        if unknown:
            raise SkillError(f"langkah {i} ({tool}): argumen tidak dikenal {sorted(unknown)}")
        for value in args.values():
            if isinstance(value, str) and value.startswith("$") and value[1:] not in params:
                raise SkillError(f"langkah {i}: {value} tidak ada di params")
        clean_steps.append({"tool": tool, "args": args})
    return {"name": name, **text, "params": params, "steps": clean_steps}


def _fill(value, params: dict):
    """Replace $param references with their values (whole-value in args, inline in text)."""
    if isinstance(value, str) and value.startswith("$") and value[1:] in params:
        return params[value[1:]]
    if isinstance(value, str):
        for key, v in params.items():
            value = value.replace(f"${key}", str(v))
    return value


def run_skill(m: Market, definition: dict, overrides: dict | None = None) -> dict:
    """Run a skill's analysis steps; returns the filled instruction and each step's output or error."""
    params = {**definition["params"], **{k: v for k, v in (overrides or {}).items() if k in definition["params"]}}
    results = []
    for step in definition["steps"]:
        args = {k: _fill(v, params) for k, v in step["args"].items()}
        try:
            results.append({"tool": step["tool"], "args": args, "output": SKILL_STEPS[step["tool"]](m, **args)})
        except Exception as exc:  # report, do not abort: the instruction may still be usable
            results.append({"tool": step["tool"], "args": args, "error": f"{type(exc).__name__}: {exc}"})
    return {"skill": definition["name"], "params": params, "instruction": _fill(definition["instruction"], params), "results": results}


def build_tools(m: Market, canvas: Canvas, emit: Emit, memories: list[dict], skills: list[dict] | None = None):
    from langchain_core.tools import tool

    @tool
    def get_market_summary() -> str:
        """Latest close, 1-day and 20-day change, and the 52-week high/low of the symbol."""
        return json.dumps(market_summary(m))

    @tool("find_pivots")
    def find_pivots_tool(lookback: int = 120, window: int = 5) -> str:
        """Swing highs and lows (date, price) over the last `lookback` trading days; `window` bars each side."""
        return json.dumps(find_pivots(m, lookback, window))

    @tool("support_resistance")
    def support_resistance_tool(lookback: int = 180, tolerance_pct: float = 1.5) -> str:
        """Support/resistance levels: pivots clustered within `tolerance_pct`, with touch counts and distance from the last close."""
        return json.dumps(support_resistance(m, lookback, tolerance_pct))

    @tool("fit_trendline")
    def fit_trendline_tool(kind: str = "support", lookback: int = 120) -> str:
        """Best trendline through two swing lows (kind=support) or highs (kind=resistance), with its projected value today."""
        return json.dumps(fit_trendline(m, "resistance" if kind == "resistance" else "support", lookback))

    @tool("fibonacci")
    def fibonacci_tool(lookback: int = 120) -> str:
        """Fibonacci retracement levels between the highest high and lowest low of the last `lookback` days."""
        return json.dumps(fibonacci(m, lookback))

    @tool("indicators")
    def indicators_tool() -> str:
        """Latest SMA20/50/200, RSI14, MACD and signal, Bollinger bands, ATR14 and volume versus its 20-day average."""
        return json.dumps(indicators(m))

    @tool("latest_decisions")
    def latest_decisions_tool() -> str:
        """Past TradingAgents team decisions on this symbol (rating, outcome) from the engine's memory log."""
        return json.dumps(latest_decisions(m.symbol))

    @tool("scalper_signal")
    def scalper_signal_tool(timeframe: str = "15m", sensitivity: float = 1.0, atr_period: int = 10, sl_atr: float = 1.5,
                            risk_reward: float = 2.0, use_sweep: int = 0) -> str:
        """Scalper Pro+ indicator on 15m, 1h or 1d bars: UT Bot signal filtered by EMA 20/50 trend and RSI 14 (use_sweep=1
        also requires a liquidity sweep), the last confirmed BUY/SELL with entry, ATR stop loss, take profit and entry zone,
        plus trend, RSI, sweep and auto trendlines on the latest bar."""
        return json.dumps(scalper_signal(m, timeframe, sensitivity, atr_period, sl_atr=sl_atr, risk_reward=risk_reward, use_sweep=use_sweep))

    @tool("pob_signal")
    def pob_signal_tool(timeframe: str = "15m", recent: int = 5) -> str:
        """PoB BYSTRA setups on 15m (HTF H1) or 1h (HTF H4) bars: SNR Continuation V1/V2, QM Continuation, QM Reversal,
        QM Failed, Manipulation, with CK2/CK3 labels. Returns the active signal and recent ones with frozen entry, stop loss,
        take profit and outcome, plus a per-setup tally over the loaded bars (a quick check, not a backtest)."""
        return json.dumps(pob_signal(m, timeframe, recent))

    @tool("fib_golden_zone")
    def fib_golden_zone_tool(timeframe: str = "1d", recent: int = 5) -> str:
        """Fibonacci golden zone pullback signals on 15m, 1h or 1d bars: the impulse leg waiting for a pullback into
        0.5-0.618 (with its levels), recent BUY/SELL signals with entry, stop (beyond 0.786), target and outcome,
        and a tally over the loaded bars (a quick check, not a backtest)."""
        return json.dumps(fib_golden_zone(m, timeframe, recent))

    @tool
    def draw_level(price: float, label: str, role: str = "neutral") -> str:
        """Draw a horizontal level. role: support, resistance or neutral."""
        return canvas.add("level", label, {"price": canvas.price(price, "price"), "role": role if role in ("support", "resistance") else "neutral"})

    @tool
    def draw_trendline(from_date: str, from_price: float, to_date: str, to_price: float, label: str, role: str = "neutral") -> str:
        """Draw a straight line between two (date YYYY-MM-DD, price) points; the end may be up to 90 days ahead."""
        return canvas.add("trendline", label, {
            "from": {"time": canvas.day(from_date, "from_date"), "price": canvas.price(from_price, "from_price")},
            "to": {"time": canvas.day(to_date, "to_date", 90), "price": canvas.price(to_price, "to_price")},
            "role": role if role in ("support", "resistance") else "neutral",
        })

    @tool
    def draw_zone(top: float, bottom: float, label: str, role: str = "neutral") -> str:
        """Draw a horizontal price zone between `bottom` and `top`. role: supply, demand or neutral."""
        t, b = canvas.price(top, "top"), canvas.price(bottom, "bottom")
        return canvas.add("zone", label, {"top": max(t, b), "bottom": min(t, b), "role": role if role in ("supply", "demand") else "neutral"})

    @tool
    def draw_fib(high: float, low: float, label: str = "Fibonacci") -> str:
        """Draw Fibonacci retracement levels between a swing `high` and swing `low` price."""
        h, lo = canvas.price(high, "high"), canvas.price(low, "low")
        h, lo = max(h, lo), min(h, lo)
        return canvas.add("fib", label, {"high": h, "low": lo, "levels": [{"ratio": r, "price": _r(h - (h - lo) * r)} for r in FIB_RATIOS]})

    @tool
    def draw_trade_plan(entry: float, stop: float, target: float, side: str = "long", note: str = "") -> str:
        """Draw entry, stop and target lines for a hypothetical long or short idea (research only)."""
        e, s, t = canvas.price(entry, "entry"), canvas.price(stop, "stop"), canvas.price(target, "target")
        long_ = side != "short"
        if long_ and not (s < e < t) or not long_ and not (t < e < s):
            raise DrawingError("untuk long: stop < entry < target; untuk short: target < entry < stop")
        rr = round(abs(t - e) / abs(e - s), 2)
        return canvas.add("trade_plan", note or f"Rencana {'long' if long_ else 'short'}", {"side": "long" if long_ else "short", "entry": e, "stop": s, "target": t, "rr": rr})

    @tool
    def annotate(on_date: str, text: str) -> str:
        """Put a short note on the chart at a date (YYYY-MM-DD)."""
        return canvas.add("note", text, {"time": canvas.day(on_date, "on_date"), "text": str(text)[:60]})

    @tool
    def remember(content: str, scope: str = "user") -> str:
        """Store a lasting fact or preference. scope=user for the person, scope=symbol for this symbol."""
        memory = {"id": str(uuid.uuid4()), "scope": "symbol" if scope == "symbol" else "user", "content": str(content)[:300]}
        emit("memory", memory=memory)
        memories.append(memory)
        return "disimpan"

    @tool
    def forget(memory_id: str) -> str:
        """Delete a stored memory by the id prefix shown in brackets."""
        match = next((x for x in memories if x["id"].startswith(memory_id.strip("[] "))), None)
        if not match:
            return "memori tidak ditemukan"
        emit("forget", id=match["id"])
        return "dihapus"

    approved = {s["definition"]["name"]: s["definition"] for s in skills or []}

    @tool
    def use_skill(name: str, params: dict | None = None) -> str:
        """Load an approved skill: runs its analysis steps on this symbol and returns its instruction and their results. Then follow the instruction, drawing with the draw_* tools."""
        definition = approved.get(name)
        if not definition:
            return f"ditolak: skill {name!r} tidak ada atau belum disetujui; yang aktif: {', '.join(approved) or 'tidak ada'}"
        return json.dumps(run_skill(m, definition, params))

    @tool
    def propose_skill(
        name: str, description: str, when_to_use: str, instruction: str, steps: list[dict], params: dict | None = None, title: str = ""
    ) -> str:
        """Save a reusable way of working as a draft skill (only when the user asks or agrees).
        name: lowercase-with-dashes. steps: 1-6 of {"tool": one of get_market_summary, find_pivots, support_resistance,
        fit_trendline, fibonacci, indicators, latest_decisions, scalper_signal, pob_signal, fib_golden_zone, "args": {...}}; an arg may be "$param".
        instruction: what to conclude and draw from the step results; may use $param. params: defaults, e.g. {"lookback": 120}.
        It is tested on this symbol now; the user approves it before it can be used."""
        try:
            definition = validate_skill(
                {"name": name, "title": title, "description": description, "when_to_use": when_to_use,
                 "instruction": instruction, "steps": steps, "params": params or {}}
            )
        except SkillError as exc:
            return f"ditolak: {exc}"
        test = run_skill(m, definition)
        errors = [r["error"] for r in test["results"] if "error" in r]
        report = {"symbol": m.symbol, "ok": not errors, "errors": errors,
                  "steps": [{"tool": r["tool"], "output": json.dumps(r.get("output"))[:240]} for r in test["results"]]}
        emit("skill_proposed", definition=definition, test=report)
        return ("diuji dan disimpan sebagai draf; tunggu persetujuan pengguna" if not errors
                else f"disimpan sebagai draf tetapi uji gagal: {errors}")

    return [
        get_market_summary, find_pivots_tool, support_resistance_tool, fit_trendline_tool, fibonacci_tool,
        indicators_tool, latest_decisions_tool, scalper_signal_tool, pob_signal_tool, fib_golden_zone_tool, draw_level, draw_trendline, draw_zone, draw_fib,
        draw_trade_plan, annotate, remember, forget, use_skill, propose_skill,
    ]


def _text(message) -> str:
    from cli.display import extract_content_string

    return extract_content_string(getattr(message, "content", None)) or ""


def summarize(llm, previous: str, messages: list[dict], language: str) -> str:
    """Fold older turns into the running summary, so long sessions keep their gist without the tokens."""
    from langchain_core.messages import HumanMessage

    transcript = "\n".join(f"{x['role']}: {x['content'][:1500]}" for x in messages)
    prompt = (
        f"Update this running summary of a chart-analysis chat in {language}. Keep the user's goals, "
        f"the levels and conclusions reached, and open questions. At most 120 words.\n\n"
        f"Current summary:\n{previous or '(none)'}\n\nNew turns:\n{transcript}"
    )
    return _text(llm.invoke([HumanMessage(content=prompt)])).strip()


def _stream(bound, messages: list, emit: Emit):
    """One model step, streamed: answer text goes out as `delta` events while it is
    written, so the reader is not left waiting for the last word. A step that turns
    out to call tools stops sending text (the page drops what it showed)."""
    from langchain_core.messages.utils import message_chunk_to_message

    reply = None
    for chunk in bound.stream(messages):
        reply = chunk if reply is None else reply + chunk
        piece = _text(chunk)
        if piece and not getattr(reply, "tool_call_chunks", None):
            emit("delta", text=piece)
    return message_chunk_to_message(reply) if reply is not None else bound.invoke(messages)


def run_agent(llm, job: dict, emit: Emit, market: Market | None = None) -> str:
    """One user turn: optional summary refresh, then the tool loop. Returns the final answer."""
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

    m = market or Market(job["symbol"])
    canvas = Canvas(m, emit)
    memories = list(job.get("memories") or [])

    if job.get("toSummarize"):
        summary = summarize(llm, job.get("summary") or "", job["toSummarize"], job.get("language") or "Indonesian")
        emit("summary", summary=summary)
        job = {**job, "summary": summary}

    tools = build_tools(m, canvas, emit, memories, job.get("skills"))
    by_name = {t.name: t for t in tools}
    bound = llm.bind_tools(tools)

    messages = [SystemMessage(content=_system_prompt(job, m))]
    for turn in job.get("history") or []:
        messages.append(HumanMessage(content=turn["content"]) if turn["role"] == "user" else AIMessage(content=turn["content"]))
    messages.append(HumanMessage(content=job["message"]))

    calls = 0
    for _ in range(MAX_STEPS):
        reply = _stream(bound, messages, emit)
        messages.append(reply)
        tool_calls = getattr(reply, "tool_calls", None) or []
        if not tool_calls:
            answer = _text(reply)
            emit("message", content=answer)
            return answer
        for call in tool_calls:
            calls += 1
            name, args = call["name"], call.get("args") or {}
            emit("tool_call", name=name, args=args)
            if calls > MAX_TOOL_CALLS:
                result = "batas pemanggilan alat tercapai; jawab dengan yang sudah ada"
            elif name not in by_name:
                result = f"alat {name} tidak ada"
            else:
                try:
                    result = by_name[name].invoke(args)
                except DrawingError as exc:
                    result = f"ditolak: {exc}"
                except Exception as exc:  # a skill failing must not end the turn
                    result = f"gagal: {type(exc).__name__}: {exc}"
            emit("tool_result", name=name, summary=str(result)[:300])
            messages.append(ToolMessage(content=str(result), tool_call_id=call["id"]))

    answer = "Batas langkah tercapai sebelum jawaban selesai. Coba persempit pertanyaannya."
    emit("message", content=answer)
    return answer
