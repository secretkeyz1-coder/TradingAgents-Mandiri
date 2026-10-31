"""Supply and demand zones, for the chart agent to draw as boxes.

A zone is the base (one to three small candles) right before an impulse candle
whose body is at least `impulse_atr` ATRs. A bullish impulse leaves a demand
zone, a bearish one a supply zone; the zone spans the base's wicks. Each zone is
then followed bar by bar: price coming back inside counts a test, a close
beyond its far side flips it (demand becomes supply and the other way round),
and a close beyond the far side of a flipped zone breaks it for good. Only
closed bars count (the newest bar is ignored), so the result does not change
while a bar is forming.
"""

from __future__ import annotations


def _atr(highs: list[float], lows: list[float], closes: list[float], length: int = 14) -> list[float]:
    out: list[float] = []
    for i in range(len(closes)):
        tr = highs[i] - lows[i] if i == 0 else max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        out.append(tr if i == 0 else (out[-1] * (length - 1) + tr) / length)
    return out


def _label(kind: str, flipped: bool) -> str:
    return f"{'DEMAND ZONE | BUY' if kind == 'demand' else 'SUPPLY ZONE | SELL'}{' (FLIPPED)' if flipped else ''}"


def find_zones(bars: list[dict], impulse_atr: float = 1.5, base_atr: float = 0.6, max_base: int = 3, per_side: int = 3) -> dict | None:
    """Live zones nearest to the last close: up to `per_side` demand zones and `per_side` supply zones."""
    n = len(bars) - 1  # closed bars only
    if n < 30:
        return None
    o = [b["open"] for b in bars[:n]]
    h = [b["high"] for b in bars[:n]]
    lo = [b["low"] for b in bars[:n]]
    c = [b["close"] for b in bars[:n]]
    t = [b["time"] for b in bars[:n]]
    atr = _atr(h, lo, c)

    zones = []
    for i in range(15, n):
        body = c[i] - o[i]
        if abs(body) < impulse_atr * atr[i - 1]:
            continue
        base = []
        j = i - 1
        while j >= max(0, i - max_base) and abs(c[j] - o[j]) <= base_atr * atr[i - 1]:
            base.append(j)
            j -= 1
        if not base:
            continue
        zones.append({
            "kind": "demand" if body > 0 else "supply",
            "start": min(base),
            "formed": i,
            "top": max(h[k] for k in base),
            "bottom": min(lo[k] for k in base),
        })

    live = []
    for z in zones:
        kind, flipped, flip_at, tests, broken = z["kind"], False, None, 0, False
        inside = True  # the impulse leaves the zone first; a test is a later return
        for k in range(z["formed"] + 1, n):
            beyond = c[k] < z["bottom"] if kind == "demand" else c[k] > z["top"]
            if beyond:
                if flipped:
                    broken = True
                    break
                kind, flipped, flip_at, inside = ("supply" if kind == "demand" else "demand"), True, k, True
                continue
            now_inside = lo[k] <= z["top"] and h[k] >= z["bottom"]
            if now_inside and not inside:
                tests += 1
            inside = now_inside
        if not broken:
            live.append({**z, "kind": kind, "flipped": flipped, "flip_at": flip_at, "tests": tests})

    last = c[-1]
    picked: list[dict] = []
    for kind in ("demand", "supply"):
        # Nearest to price first; a zone overlapping one already picked is the same area.
        side = sorted((z for z in live if z["kind"] == kind), key=lambda z: min(abs(last - z["top"]), abs(last - z["bottom"])))
        chosen: list[dict] = []
        for z in side:
            if any(z["bottom"] <= x["top"] and z["top"] >= x["bottom"] for x in chosen):
                continue
            chosen.append(z)
            if len(chosen) >= per_side:
                break
        picked += chosen

    def out(z: dict) -> dict:
        mid = (z["top"] + z["bottom"]) / 2
        return {
            "type": z["kind"],
            "label": _label(z["kind"], z["flipped"]),
            "flipped": z["flipped"],
            "from_time": t[z["start"]],
            "formed_time": t[z["formed"]],
            "flipped_time": t[z["flip_at"]] if z["flip_at"] is not None else None,
            "top": z["top"],
            "bottom": z["bottom"],
            "tests": z["tests"],
            "price_inside": z["bottom"] <= last <= z["top"],
            "distance_pct": (mid - last) / last * 100,
        }

    return {"last_close": last, "last_bar": t[-1], "bars": n, "zones": [out(z) for z in picked]}
