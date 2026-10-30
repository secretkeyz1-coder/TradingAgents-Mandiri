"""Fibonacci golden zone pullback. An impulse leg in the trend's direction
(swing low to a higher high, at least 3 ATR) is retraced into the 0.5-0.618
zone; a candle that closes back out of the zone in the leg's direction is the
signal. Stop beyond 0.786, target the leg's end (or the -0.272 extension when
that end is closer than 1R). A close beyond 0.786 kills the leg; each leg gives
at most one signal. Closed bars only; every signal is followed to its outcome.
Mirrors web/client/src/lib/indicators/fib.ts; change both together.
"""

from __future__ import annotations

FIB_DEFAULTS = {
    "pivot_len": 3, "min_leg_atr": 3.0, "zone_top": 0.5, "zone_bottom": 0.618, "invalid": 0.786,
    "extension": 0.272, "sl_buffer_atr": 0.1, "expiry_bars": 96, "warmup": 30,
}


def fib_level(leg: dict, ratio: float) -> float:
    """Price at a retracement ratio of a leg (0 = its end, 1 = its start, negative = beyond its end)."""
    return leg["to_price"] - (leg["to_price"] - leg["from_price"]) * ratio


def _rma_next(prev, value, length):
    return value if prev is None else (prev * (length - 1) + value) / length


def fib(bars: list[dict], s: dict | None = None) -> dict | None:
    """bars: [{time, open, high, low, close}], oldest first."""
    s = {**FIB_DEFAULTS, **(s or {})}
    n = len(bars)
    if n < 60:
        return None
    o = [b["open"] for b in bars]
    h = [b["high"] for b in bars]
    l = [b["low"] for b in bars]
    c = [b["close"] for b in bars]
    atr: list[float] = []
    for i in range(n):
        tr = h[0] - l[0] if i == 0 else max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
        atr.append(_rma_next(None if i == 0 else atr[i - 1], tr, 14))

    L = s["pivot_len"]
    swings: list[dict] = []
    legs = {1: None, -1: None}
    signals: list[dict] = []

    for i in range(1, n - 1):
        for sig in signals:
            if sig["outcome"] != "open" or sig["index"] >= i:
                continue
            buy = sig["side"] == "BUY"
            risk = abs(sig["entry"] - sig["stop_loss"])
            if (l[i] <= sig["stop_loss"]) if buy else (h[i] >= sig["stop_loss"]):
                sig.update(outcome="loss", r=-1.0, exit_index=i)
            elif (h[i] >= sig["take_profit"]) if buy else (l[i] <= sig["take_profit"]):
                sig.update(outcome="win", r=abs(sig["take_profit"] - sig["entry"]) / risk, exit_index=i)
            elif i - sig["index"] >= s["expiry_bars"]:
                sig.update(outcome="expired", r=(c[i] - sig["entry"]) * (1 if buy else -1) / risk, exit_index=i)

        j = i - L
        if j >= L:
            is_h = all(h[k] < h[j] for k in range(j - L, j + L + 1) if k != j)
            is_l = all(l[k] > l[j] for k in range(j - L, j + L + 1) if k != j)
            for ok, kind, price in ((is_h, "H", h[j]), (is_l, "L", l[j])):
                if not ok:
                    continue
                last = swings[-1] if swings else None
                if last and last["kind"] == kind:
                    if (price <= last["price"]) if kind == "H" else (price >= last["price"]):
                        continue
                    swings[-1] = {"idx": j, "price": price, "kind": kind}
                else:
                    swings.append({"idx": j, "price": price, "kind": kind})
                d = 1 if kind == "H" else -1
                start = next((sw for sw in reversed(swings) if sw["kind"] != kind and sw["idx"] < j), None)
                prev_same = next((sw for sw in reversed(swings) if sw["kind"] == kind and sw["idx"] < j), None)
                if not start or not prev_same:
                    continue
                extreme = price > prev_same["price"] if d == 1 else price < prev_same["price"]
                if extreme and abs(price - start["price"]) >= s["min_leg_atr"] * atr[j]:
                    legs[d] = {"dir": d, "from": start["idx"], "to": j, "from_price": start["price"], "to_price": price,
                               "known": i, "dead": False, "fired": False}

        if i < s["warmup"]:
            continue
        for d in (1, -1):
            leg = legs[d]
            if not leg or leg["dead"] or leg["fired"] or i <= leg["known"]:
                continue
            top = fib_level(leg, s["zone_top"])
            bottom = fib_level(leg, s["zone_bottom"])
            invalid = fib_level(leg, s["invalid"])
            if (c[i] - invalid) * d < 0 or (c[i] - leg["to_price"]) * d > 0:
                leg["dead"] = True
                continue
            touched = l[i] <= top if d == 1 else h[i] >= top
            rejects = (c[i] > o[i] and c[i] > top) if d == 1 else (c[i] < o[i] and c[i] < top)
            if not touched or not rejects:
                continue
            entry = c[i]
            stop = invalid - d * s["sl_buffer_atr"] * atr[i]
            risk = abs(entry - stop)
            target = leg["to_price"] if (leg["to_price"] - entry) * d >= risk else fib_level(leg, -s["extension"])
            deepest = l[i] <= bottom if d == 1 else h[i] >= bottom
            side = "BUY" if d == 1 else "SELL"
            signals.append({
                "index": i, "time": bars[i]["time"], "side": side, "label": f"{side} · Fib {'0,618' if deepest else '0,5'}",
                "entry": entry, "stop_loss": stop, "take_profit": target, "leg_from": leg["from_price"], "leg_to": leg["to_price"],
                "outcome": "open", "r": None, "exit_index": None,
            })
            leg["fired"] = True

    closed = [x for x in signals if x["r"] is not None]
    live = sorted([x for x in (legs[1], legs[-1]) if x and not x["dead"] and not x["fired"]], key=lambda x: -x["to"])
    return {
        "signals": signals,
        "active": live[0] if live else None,
        "stats": {
            "count": len(signals), "wins": sum(1 for x in signals if x["outcome"] == "win"),
            "losses": sum(1 for x in signals if x["outcome"] == "loss"), "expired": sum(1 for x in signals if x["outcome"] == "expired"),
            "open": sum(1 for x in signals if x["outcome"] == "open"),
            "avg_r": round(sum(x["r"] for x in closed) / len(closed), 2) if closed else None,
        },
    }
