"""PoB BYSTRA gold setups as a deterministic engine, built from the spec
"Spesifikasi Indikator PoB BYSTRA Gold" with its proposed defaults: five
building blocks (swings/structure, base zones, strong A/V, trendlines, HTF
engulfing) feed six setups (SNR V1/V2, QM Continuation, QM Reversal, QM Failed,
Manipulation) plus the CK2/CK3 labels. One signal per bar at most, levels
frozen at the signal bar, every signal followed to its outcome.

Bars are walked once, oldest first, and only closed bars are used (the newest
may still be forming). Mirrors web/client/src/lib/indicators/pob.ts line for
line; change both together so the chart and the agent agree.
"""

from __future__ import annotations

POB_DEFAULTS = {
    "pivot_len": 3, "break_atr": 0.1, "choch_move_atr": 1.5, "reversal_window": 60,
    "impulse_body": 0.6, "impulse_atr": 0.7, "base_body": 0.5, "base_atr": 0.35, "max_base": 3,
    "leg_out_atr": 1.0, "leg_out_bars": 3, "max_touches": 2, "strong_reaction_atr": 2.0,
    "strong_reaction_bars": 10, "align_atr": 0.3, "touch_atr": 0.15, "touch_gap": 5,
    "touch_away_atr": 0.5, "line_max_age": 200, "tl_break_atr": 0.2, "engulf_atr": 0.8,
    "engulf_life": 3, "sl_buffer_atr": 0.2, "risk_reward": 2.0, "cooldown": 3, "expiry_bars": 96,
    "failed_memory": 3, "failed_life": 200, "warmup": 30,
}

SETUPS = [
    ("SNR1", "SNR Continuation V1", "Low"), ("SNR2", "SNR Continuation V2", "Low"),
    ("QMC", "QM Continuation", "Low"), ("QMR", "QM Reversal", "High"),
    ("QMF", "QM Failed", "High"), ("MANIP", "Manipulation", "High"),
]
ORDER = [sid for sid, _, _ in SETUPS]
RISK = {sid: risk for sid, _, risk in SETUPS}


def htf_key(time: str, timeframe: str) -> str:
    """HTF bucket of a bar: the hour for 15-minute bars, a 4-hour block for hourly bars."""
    if timeframe == "15m":
        return time[:13]
    return f"{time[:10]}/{int(time[11:13]) // 4}"


def _rma_next(prev, value, length):
    return value if prev is None else (prev * (length - 1) + value) / length


def pob(bars: list[dict], timeframe: str, s: dict | None = None) -> dict | None:
    """bars: [{time, open, high, low, close}], oldest first."""
    s = {**POB_DEFAULTS, **(s or {})}
    n = len(bars)
    if n < 60:
        return None
    o = [b["open"] for b in bars]
    h = [b["high"] for b in bars]
    # o, h, l, c as pob.ts names them, so the two engines read alike line by line.
    l = [b["low"] for b in bars]  # noqa: E741
    c = [b["close"] for b in bars]
    atr: list[float] = []
    for i in range(n):
        tr = h[0] - l[0] if i == 0 else max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
        atr.append(_rma_next(None if i == 0 else atr[i - 1], tr, 14))

    def body(k):
        return abs(c[k] - o[k])

    def rng(k):
        return h[k] - l[k]

    def is_impulse(k):
        return body(k) >= s["impulse_body"] * rng(k) and body(k) >= s["impulse_atr"] * atr[k] and c[k] != o[k]

    def is_base(k):
        return rng(k) == 0 or body(k) <= s["base_body"] * rng(k) or body(k) <= s["base_atr"] * atr[k]

    L = s["pivot_len"]
    swings: list[dict] = []
    last_h = last_l = None
    trend = "none"
    bos = 0
    rev = None
    zones: list[dict] = []
    h1: list[dict] = []
    h1_atr = None
    acc = None
    engulf = {1: None, -1: None}
    armed = {1: None, -1: None}
    armed_line = {1: -1, -1: -1}
    qmc = None
    failed: list[dict] = []
    signals: list[dict] = []
    last_side = {1: -10**9, -1: -10**9}

    def engulf_valid(d):
        e = engulf[d]
        return bool(e) and e["valid"] and len(h1) - 1 - e["h1_index"] <= s["engulf_life"]

    def near(z, lo, hi, tol):
        return max(lo - z["top"], z["bottom"] - hi, 0) <= tol

    def ck2_at(d, lo, hi, i):
        count = 0
        for k in range(len(swings) - 1, max(-1, len(swings) - 61), -1):
            sw = swings[k]
            if sw["idx"] >= i or sw["kind"] != ("H" if d == 1 else "L"):
                continue
            if max(lo - sw["price"], sw["price"] - hi, 0) > s["align_atr"] * atr[i]:
                continue
            flipped = any((c[j] > sw["price"]) if d == 1 else (c[j] < sw["price"]) for j in range(sw["idx"] + 1, i + 1))
            if flipped:
                count += 1
            if count >= 2:
                return True
        return False

    def take_profit(d, entry, risk, i):
        tp = entry + d * risk * s["risk_reward"]
        for sw in swings:
            if sw["idx"] >= i or sw["kind"] != ("H" if d == 1 else "L"):
                continue
            dist = (sw["price"] - entry) * d
            if dist >= risk and dist < (tp - entry) * d:
                tp = sw["price"]
        return tp

    for i in range(1, n - 1):
        # 1. Outcomes of open signals on this bar (stop first when both are touched).
        for sig in signals:
            if sig["outcome"] != "open" or sig["index"] >= i:
                continue
            buy = sig["side"] == "BUY"
            risk = abs(sig["entry"] - sig["stop_loss"])
            if (l[i] <= sig["stop_loss"]) if buy else (h[i] >= sig["stop_loss"]):
                sig.update(outcome="loss", r=-1.0, exit_index=i)
                if sig["setup"] in ("QMR", "QMF"):
                    failed.append({"dir": 1 if buy else -1, "top": sig["zone_top"], "bottom": sig["zone_bottom"], "idx": i})
                    if len(failed) > s["failed_memory"]:
                        failed.pop(0)
            elif (h[i] >= sig["take_profit"]) if buy else (l[i] <= sig["take_profit"]):
                sig.update(outcome="win", r=abs(sig["take_profit"] - sig["entry"]) / risk, exit_index=i)
            elif i - sig["index"] >= s["expiry_bars"]:
                sig.update(outcome="expired", r=(c[i] - sig["entry"]) * (1 if buy else -1) / risk, exit_index=i)

        # 2. HTF candles: a bucket is closed once a bar of the next bucket arrives.
        key = htf_key(bars[i]["time"], timeframe)
        if acc is None:
            acc = {"o": o[i - 1], "h": h[i - 1], "l": l[i - 1], "c": c[i - 1], "start": i - 1}
        if key != htf_key(bars[i - 1]["time"], timeframe):
            prev_close = h1[-1]["c"] if h1 else None
            tr = acc["h"] - acc["l"] if prev_close is None else max(acc["h"] - acc["l"], abs(acc["h"] - prev_close), abs(acc["l"] - prev_close))
            h1_atr = _rma_next(h1_atr, tr, 14)
            h1.append(acc)
            m = len(h1) - 1
            if m >= 1:
                p, cur = h1[m - 1], h1[m]
                big = abs(cur["c"] - cur["o"]) >= s["engulf_atr"] * h1_atr
                if big and cur["c"] > cur["o"] and p["c"] < p["o"] and cur["o"] <= p["c"] and cur["c"] >= p["o"]:
                    engulf[1] = {"dir": 1, "high": cur["h"], "low": cur["l"], "start": cur["start"], "known": i, "h1_index": m, "valid": True}
                elif big and cur["c"] < cur["o"] and p["c"] > p["o"] and cur["o"] >= p["c"] and cur["c"] <= p["o"]:
                    engulf[-1] = {"dir": -1, "high": cur["h"], "low": cur["l"], "start": cur["start"], "known": i, "h1_index": m, "valid": True}
            acc = {"o": o[i], "h": h[i], "l": l[i], "c": c[i], "start": i}
        else:
            acc = {"o": acc["o"], "h": max(acc["h"], h[i]), "l": min(acc["l"], l[i]), "c": c[i], "start": acc["start"]}
        if engulf[1] and c[i] < engulf[1]["low"]:
            engulf[1]["valid"] = False
        if engulf[-1] and c[i] > engulf[-1]["high"]:
            engulf[-1]["valid"] = False

        # 3. Swing confirmed L bars after it; highs and lows alternate.
        j = i - L
        if j >= L:
            is_h = all(h[k] < h[j] for k in range(j - L, j + L + 1) if k != j)
            is_l = all(l[k] > l[j] for k in range(j - L, j + L + 1) if k != j)
            for ok, kind, price in ((is_h, "H", h[j]), (is_l, "L", l[j])):
                if not ok:
                    continue
                last = swings[-1] if swings else None
                sw = {"idx": j, "price": price, "kind": kind, "broken": False}
                if last and last["kind"] == kind:
                    if (price <= last["price"]) if kind == "H" else (price >= last["price"]):
                        continue
                    swings[-1] = sw
                else:
                    swings.append(sw)
                if kind == "H":
                    last_h = sw
                else:
                    last_l = sw
                if qmc and not qmc["done"] and kind == ("L" if qmc["dir"] == 1 else "H") and j > qmc["rev"]:
                    if not qmc["t1"]:
                        qmc["t1"] = sw
                    elif not qmc["t2"] and (price - qmc["t1"]["price"]) * qmc["dir"] > 0 and j - qmc["t1"]["idx"] >= s["touch_gap"]:
                        slope = (price - qmc["t1"]["price"]) / (j - qmc["t1"]["idx"])
                        clean = True
                        for k in range(qmc["t1"]["idx"] + 1, j):
                            line = qmc["t1"]["price"] + slope * (k - qmc["t1"]["idx"])
                            clean = c[k] >= line if qmc["dir"] == 1 else c[k] <= line
                            if not clean:
                                break
                        if clean:
                            qmc["t2"] = sw
                            qmc["t2_known"] = i

        # 4. QM Reversal arming: a mature trend's trendline breaks (trend as of the previous bar).
        for d in (1, -1):
            if trend != ("down" if d == 1 else "up") or bos < 2:
                continue
            pts = [sw for sw in swings if sw["kind"] == ("H" if d == 1 else "L")][-2:]
            if len(pts) < 2:
                continue
            a, b = pts
            if (b["price"] - a["price"]) * d >= 0 or i - a["idx"] > s["line_max_age"]:
                continue
            line = a["price"] + (b["price"] - a["price"]) / (b["idx"] - a["idx"]) * (i - a["idx"])
            if (c[i] - line) * d > s["tl_break_atr"] * atr[i]:
                ref = last_l if d == 1 else last_h
                if ref and armed_line[d] != b["idx"]:
                    armed[d] = {"dir": d, "idx": i, "ref_idx": ref["idx"], "ref_price": ref["price"]}
                    armed_line[d] = b["idx"]

        # 5. Structure: BOS continues a trend; CHoCH (with a 1.5 ATR leg) reverses it.
        for d in (1, -1):
            sw = last_h if d == 1 else last_l
            if not sw or sw["broken"] or (c[i] - sw["price"]) * d <= s["break_atr"] * atr[i]:
                continue
            if trend == ("down" if d == 1 else "up"):
                p = sw["idx"]
                for k in range(sw["idx"], i + 1):
                    if (l[k] < l[p]) if d == 1 else (h[k] > h[p]):
                        p = k
                move = c[i] - l[p] if d == 1 else h[p] - c[i]
                if move < s["choch_move_atr"] * atr[i]:
                    continue
                sw["broken"] = True
                trend = "up" if d == 1 else "down"
                bos = 0
                reaction = 0.0
                for k in range(p + 1, min(p + s["strong_reaction_bars"], i) + 1):
                    reaction = max(reaction, h[k] - l[p] if d == 1 else h[p] - l[k])
                wick = min(o[p], c[p]) - l[p] if d == 1 else h[p] - max(o[p], c[p])
                engulfs = p + 1 <= i and (
                    (c[p + 1] > o[p + 1] and o[p] > c[p] and c[p + 1] >= o[p] and o[p + 1] <= c[p]) if d == 1
                    else (c[p + 1] < o[p + 1] and o[p] < c[p] and c[p + 1] <= o[p] and o[p + 1] >= c[p])
                )
                score = 1 + (1 if reaction >= s["strong_reaction_atr"] * atr[p] else 0) + (1 if (wick >= 0.5 * rng(p) or engulfs) else 0)
                ks = [k for k in (p - 1, p, p + 1) if 0 <= k <= i]
                if d == 1:
                    bottom = l[p]
                    top = min(min(o[k], c[k]) for k in ks)
                    top = min(max(top, bottom), bottom + atr[p])
                else:
                    top = h[p]
                    bottom = max(max(o[k], c[k]) for k in ks)
                    bottom = max(min(bottom, top), top - atr[p])
                rev = {"dir": d, "idx": i, "point": p, "strong": score >= 2, "top": top, "bottom": bottom, "zone_valid": True}
                qmc = {"dir": d, "rev": i, "t1": None, "t2": None, "t2_known": -1, "away": False, "done": False}
            else:
                sw["broken"] = True
                bos = bos + 1 if trend == ("up" if d == 1 else "down") else 1
                trend = "up" if d == 1 else "down"
        if rev and rev["zone_valid"] and ((c[i] < rev["bottom"]) if rev["dir"] == 1 else (c[i] > rev["top"])):
            rev["zone_valid"] = False

        # 6. Base zones: impulse in, 1-3 base bars, impulse out beyond the base.
        if is_impulse(i):
            d = 1 if c[i] > o[i] else -1
            base: list[int] = []
            k = i - 1
            while k >= 0 and len(base) < s["max_base"] and is_base(k):
                base.append(k)
                k -= 1
            if base and k >= 0 and is_impulse(k):
                din = 1 if c[k] > o[k] else -1
                bh = max(h[b] for b in base)
                bl = min(l[b] for b in base)
                if (c[i] > bh) if d == 1 else (c[i] < bl):
                    kind = ("RBR" if d == 1 else "RBD") if din == 1 else ("DBR" if d == 1 else "DBD")
                    top = max(max(o[b], c[b]) for b in base) if d == 1 else bh
                    bottom = bl if d == 1 else min(min(o[b], c[b]) for b in base)
                    zones.append({"dir": d, "kind": kind, "top": top, "bottom": bottom, "leg_out": i,
                                  "ready_by": i + s["leg_out_bars"] - 1, "ready_at": -1, "touches": 0, "inside": False, "dead": False})
                    if len(zones) > 40:
                        zones = zones[-40:]
        confirming: list[dict] = []
        for z in zones:
            if z["dead"]:
                continue
            if z["ready_at"] < 0:
                if (h[i] - z["top"] if z["dir"] == 1 else z["bottom"] - l[i]) >= s["leg_out_atr"] * atr[z["leg_out"]]:
                    z["ready_at"] = i
                elif i >= z["ready_by"]:
                    z["dead"] = True
                continue
            if i <= z["ready_at"]:
                continue
            if (c[i] < z["bottom"]) if z["dir"] == 1 else (c[i] > z["top"]):
                z["dead"] = True
                continue
            touched = l[i] <= z["top"] if z["dir"] == 1 else h[i] >= z["bottom"]
            if touched and not z["inside"]:
                z["touches"] += 1
            if (touched or z["inside"]) and z["touches"] <= s["max_touches"] and ((c[i] > z["top"]) if z["dir"] == 1 else (c[i] < z["bottom"])):
                confirming.append(z)
            z["inside"] = c[i] <= z["top"] if z["dir"] == 1 else c[i] >= z["bottom"]

        # 7. Setups, in priority order; at most one signal per bar.
        if i < s["warmup"]:
            continue
        cands: list[dict] = []
        buf = s["sl_buffer_atr"] * atr[i]
        rev_on = rev if rev and rev["idx"] < i <= rev["idx"] + s["reversal_window"] else None

        for z in confirming:
            d = z["dir"]
            sl = z["bottom"] - buf if d == 1 else z["top"] + buf
            if rev_on and rev_on["dir"] == d and rev_on["strong"] and rev_on["zone_valid"] and z["leg_out"] >= rev_on["point"] \
                    and near(z, rev_on["bottom"], rev_on["top"], s["align_atr"] * atr[i]):
                setup = "SNR1" if z["kind"] == ("RBR" if d == 1 else "DBD") else "SNR2" if z["kind"] == ("DBR" if d == 1 else "RBD") else None
                if setup:
                    sl_snr = min(z["bottom"], rev_on["bottom"]) - buf if d == 1 else max(z["top"], rev_on["top"]) + buf
                    cands.append({"setup": setup, "dir": d, "plus": False, "sl": sl_snr, "zone": z, "band": (z["bottom"], z["top"])})
            a = armed[d]
            continuation = z["kind"] == ("RBR" if d == 1 else "DBD")
            if a and a["idx"] < i <= a["idx"] + s["reversal_window"] and continuation and z["leg_out"] >= a["ref_idx"]:
                if near(z, a["ref_price"], a["ref_price"], s["align_atr"] * atr[i]):
                    cands.append({"setup": "QMR", "dir": d, "plus": engulf_valid(d), "sl": sl, "zone": z, "band": (z["bottom"], z["top"])})
                elif any(f["dir"] == d and i - f["idx"] <= s["failed_life"] and near(z, f["bottom"], f["top"], s["align_atr"] * atr[i]) for f in failed):
                    cands.append({"setup": "QMF", "dir": d, "plus": engulf_valid(d), "sl": sl, "zone": z, "band": (z["bottom"], z["top"])})
            e = engulf[d]
            if rev_on and rev_on["dir"] == d and continuation and e and e["valid"] and e["known"] >= rev_on["idx"] \
                    and z["leg_out"] > e["start"] and z["bottom"] >= e["low"] and z["top"] <= e["high"]:
                cands.append({"setup": "MANIP", "dir": d, "plus": False, "sl": sl, "zone": z, "band": (z["bottom"], z["top"])})

        if qmc and not qmc["done"] and qmc["t1"] and qmc["t2"] and i > qmc["t2_known"]:
            q = qmc
            slope = (q["t2"]["price"] - q["t1"]["price"]) / (q["t2"]["idx"] - q["t1"]["idx"])
            line = q["t1"]["price"] + slope * (i - q["t1"]["idx"])
            if i - q["rev"] > s["reversal_window"] or i - q["t1"]["idx"] > s["line_max_age"] or (c[i] - line) * q["dir"] < -s["tl_break_atr"] * atr[i]:
                q["done"] = True
            else:
                gap = l[i] - line if q["dir"] == 1 else line - h[i]
                touch = gap <= s["touch_atr"] * atr[i] and (c[i] - line) * q["dir"] > 0
                if touch and q["away"] and i - q["t2"]["idx"] >= s["touch_gap"]:
                    sl = l[i] - buf if q["dir"] == 1 else h[i] + buf
                    cands.append({"setup": "QMC", "dir": q["dir"], "plus": False, "sl": sl, "zone": None, "band": (line, line)})
                if gap >= s["touch_away_atr"] * atr[i]:
                    q["away"] = True

        cands.sort(key=lambda x: (ORDER.index(x["setup"]), -int(x["plus"]) if x["setup"] == "QMR" else 0))
        pick = next((x for x in cands if i - last_side[x["dir"]] >= s["cooldown"] and ((x["sl"] < c[i]) if x["dir"] == 1 else (x["sl"] > c[i]))), None)
        if not pick:
            continue

        entry = c[i]
        risk = abs(entry - pick["sl"])
        ck_used = pick["setup"] in ("SNR1", "SNR2", "QMC", "MANIP")
        ck2 = ck_used and ck2_at(pick["dir"], pick["band"][0], pick["band"][1], i)
        ck3 = ck2 and engulf_valid(pick["dir"])
        side = "BUY" if pick["dir"] == 1 else "SELL"
        label = f"{side} · {pick['setup']}{'+' if pick['plus'] else ''}{' · CK3' if ck3 else ' · CK2' if ck2 else ''} · {RISK[pick['setup']]} Risk"
        signals.append({
            "index": i, "time": bars[i]["time"], "side": side, "setup": pick["setup"], "plus": pick["plus"], "ck2": ck2, "ck3": ck3,
            "label": label, "entry": entry, "stop_loss": pick["sl"], "take_profit": take_profit(pick["dir"], entry, risk, i),
            "zone_top": pick["zone"]["top"] if pick["zone"] else None, "zone_bottom": pick["zone"]["bottom"] if pick["zone"] else None,
            "outcome": "open", "r": None, "exit_index": None,
        })
        last_side[pick["dir"]] = i
        if pick["zone"]:
            pick["zone"]["dead"] = True
        if pick["setup"] == "QMC":
            qmc["done"] = True
        if pick["setup"] in ("QMR", "QMF"):
            armed[pick["dir"]] = None

    stats = []
    for sid, name, risk_class in SETUPS:
        mine = [x for x in signals if x["setup"] == sid]
        closed = [x for x in mine if x["r"] is not None]
        stats.append({
            "setup": sid, "name": name, "risk_class": risk_class, "count": len(mine),
            "wins": sum(1 for x in mine if x["outcome"] == "win"), "losses": sum(1 for x in mine if x["outcome"] == "loss"),
            "expired": sum(1 for x in mine if x["outcome"] == "expired"), "open": sum(1 for x in mine if x["outcome"] == "open"),
            "avg_r": round(sum(x["r"] for x in closed) / len(closed), 2) if closed else None,
        })
    return {"signals": signals, "stats": stats, "trend": trend, "htf": "H1" if timeframe == "15m" else "H4"}
