"""Pine Script, or a prompt in plain words, to the app's indicator script
language (web/shared/script.ts), by an LLM. A Pine translation comes with a
report of what was kept, changed and dropped. A prompt goes in two steps: a plan
that splits it into rules a script can compute from prices, rules changed so
they can be tested, and what no script can do (an analyst's prose, judgement,
news); then a script from the rules the user kept. The server runs every draft
on real bars (server/src/script-check.ts) and sends what failed back here to be
repaired, a few times at most. The result is still a draft: the user reviews it
on the chart before saving or switching on notifications."""

from __future__ import annotations

import json
import re

_FENCE = re.compile(r"```(?:js|javascript)?\s*\n(.*?)```", re.S)
_JSON_FENCE = re.compile(r"```json\s*\n(.*?)```", re.S)
_OBJECT = re.compile(r"\{.*\}", re.S)
# What a plan or a report may hold, so a long reply cannot flood the page.
_MAX_RULES, _MAX_NOTES, _MAX_TEXT, _MAX_PARAM = 20, 10, 240, 60
_MAX_KEPT, _MAX_CHANGES = 30, 20

_TRANSLATE_RULES = """- Keep the logic exactly: the same conditions, the same order of steps within a bar, the same defaults. Every Pine
  input becomes input(name, default) with its Pine title as the name and the same default.
- Pine runs the script once per bar; here it runs once over arrays. Compute ta.* series once, outside the loop, then
  one for loop over i that does on bar i what the Pine does on a bar, in the same order. var and other state become
  variables declared before the loop; Pine types become plain objects, their methods functions taking the object.
- Never read a bar after i to decide anything at bar i. ta.pivothigh and ta.pivotlow already give a pivot on the bar
  that confirms it. Higher timeframes: request.security(..., expr[1], lookahead = barmerge.lookahead_on) becomes
  htf(minutes).closed(series), request.security(..., expr) becomes htf(minutes).value(series), with the series
  computed on the htf bars (h.close, h.high, ...).
- Sessions: not na(time(timeframe.period, spec, tz)) becomes session(spec, tz)[i]; the chart's timeframe in minutes is
  timeframe; syminfo.mintick is mintick.
- Orders: an entry at a price later bars must reach (strategy.entry with stop= or limit=, or the script's own pending
  order, such as high + mintick after a rejection bar) is signal(i, side, { entry, wait: N, ... }) where N is the
  number of bars the order stays. Without wait the entry must lie inside bar i, or it never fills. An entry at bar i's
  close needs no entry. Two exits on parts of the position (qty_percent, or TP1 and TP2) are tp: [tp1, tp2] with
  size (the part closed at tp1); a stop moved to the entry after tp1 is breakeven (the default). One position at a
  time (strategy.position_size == 0, or a state machine that ignores new signals while an order or trade runs) is
  exclusive: true; a trade with no time limit gets maxBars: 2000; an exit on a condition is exit: (a boolean array).
- signal() on every bar where the Pine decides a buy or sell (its entries, its buy or sell shapes and labels, its
  alerts), with the Pine's own stop and targets, and never with a NaN price.
- Drawings: line.new and label.new become line() and label() with the same bars, prices, colours and styles; their
  setters lineSet() and labelSet(); their deletes lineDelete() and labelDelete(). plot() and hline() stay. Tables,
  boxes, fills, background and bar colours cannot be drawn: leave them out.
- Plain JavaScript only: no imports, no network, no DOM."""

_REPORT = """{"kept": ["what works as in the Pine, one item per feature"], "changed": [{"what": "...", "how": "how it works here instead"}], "dropped": [{"what": "...", "why": "..."}]}"""


def _prompt(pine: str, reference: str, dictionary: str, example: str, language: str) -> str:
    return f"""Translate this TradingView Pine Script into the JavaScript indicator language below, so that on the same bars it
gives the same signals, levels and drawings.

THE LANGUAGE
{reference}

PINE TO THIS LANGUAGE
{dictionary}

A FULL TRANSLATION IN THAT LANGUAGE (a Pine indicator with trendlines, a higher timeframe, sessions, stop orders and
two targets)
```js
{example}
```

HOW TO TRANSLATE
{_TRANSLATE_RULES}

ANSWER WITH EXACTLY TWO BLOCKS
1. One ```js block: the whole script, opening with a short comment that says what it does and what it left out.
   Comments in {language}.
2. One ```json block reporting the translation, every text in {language}, in plain words a trader understands. Name every
   feature of the Pine in one of the three lists, and keep each item short:
   {_REPORT}

THE PINE SCRIPT
```pine
{pine}
```"""


def _repair_prompt(source: str, text: str, rules: list[str], code: str, problems: list[str], reference: str,
                   dictionary: str, language: str) -> str:
    listed = "\n".join(f"- {p}" for p in problems)
    if source == "pine":
        origin = f"THE PINE SCRIPT IT TRANSLATES\n```pine\n{text}\n```"
        report = f"""2. One ```json block with the report of the whole translation, updated, every text in {language}:
   {_REPORT}"""
    else:
        kept = "\n".join(f"- {r}" for r in rules)
        origin = f"THE RULES IT FOLLOWS\n{kept}\n\nTHE TRADER'S TEXT THEY COME FROM\n<<<\n{text}\n>>>"
        report = "2. Nothing else."
    return f"""This script, written in the JavaScript indicator language below, was run on real bars and has these problems:
{listed}

Fix every problem and keep everything else as it is.

THE LANGUAGE
{reference}

PINE TO THIS LANGUAGE
{dictionary}

HOW IT MUST BE WRITTEN
{_TRANSLATE_RULES}

{origin}

THE SCRIPT
```js
{code}
```

ANSWER WITH
1. One ```js block: the whole corrected script. Comments in {language}.
{report}"""


def _plan_prompt(text: str, reference: str, language: str) -> str:
    return f"""A trader describes a strategy or pastes an analysis prompt written for an AI. Plan an indicator script for it
in the JavaScript indicator language below: one timeframe's bars (open, high, low, close, volume, time) with higher
timeframes and sessions built from them, ta.* helpers, plot/hline/line/label drawings, and signal(i, side, {{ sl, tp,
entry, wait }}) with one stop, one or two targets, and orders that wait a number of bars for their price.

THE LANGUAGE
{reference}

SORT EVERY PART OF THE TEXT INTO ONE OF THREE LISTS
- "rules": what a script can compute from these bars, one rule per item, each with its main number as "param" when it has one
  (e.g. {{"text": "Swing high dan swing low yang sudah terkonfirmasi", "param": "Pivot 5 candle"}}). Market structure (swings,
  breaks of structure, order blocks, fair value gaps, liquidity sweeps, equal highs and lows, premium and discount), chart
  patterns, trendlines from swings, candle patterns, indicator divergences, entry, stop and target rules, a minimum
  risk-reward, and a confluence score in the signal's label all belong here. Higher timeframes can be built from these bars.
- "adapted": what must change to be testable, each saying the change in one sentence: more than two targets become two
  (the first closes part of the position); a pending (limit or stop) order with no expiry gets a number of bars to wait;
  a trailing stop becomes a fixed stop or an exit condition; a timeframe below 15 minutes becomes 15 minutes; a broker's
  spread becomes the test's cost per trade.
- "dropped": what no script can do, each with "why": the format and wording of an analyst's report, judgement calls
  (a market phase, ENTRY VALID / WAIT decisions, confidence in words), news and economic calendars, position size as a
  share of equity, reading screenshots, and any data not in the bars.
Never invent rules the text does not ask for. At most {_MAX_RULES} rules, {_MAX_NOTES} adapted and {_MAX_NOTES} dropped.

Write "summary" (one or two sentences) and every text in {language}, in plain words a trader understands.
Output one JSON object and nothing else:
{{"summary": "...", "rules": [{{"text": "...", "param": "..." or null}}], "adapted": ["..."], "dropped": [{{"text": "...", "why": "..."}}]}}

THE TEXT
<<<
{text}
>>>"""


def _clip(value: object, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _clean_plan(data: object) -> dict:
    """The plan as the page shows it: known keys only, strings clipped, empty items dropped."""
    if not isinstance(data, dict):
        raise ValueError("rencana bukan objek JSON")
    rules = []
    for item in data.get("rules") or []:
        item = item if isinstance(item, dict) else {"text": item}
        text = _clip(item.get("text"), _MAX_TEXT)
        if text:
            rules.append({"text": text, "param": _clip(item.get("param"), _MAX_PARAM) or None})
    if not rules:
        raise ValueError("rencana tidak berisi aturan yang bisa dihitung dari harga")
    adapted = [t for t in (_clip(x, _MAX_TEXT) for x in data.get("adapted") or []) if t]
    dropped = []
    for item in data.get("dropped") or []:
        item = item if isinstance(item, dict) else {"text": item}
        text = _clip(item.get("text"), _MAX_TEXT)
        if text:
            dropped.append({"text": text, "why": _clip(item.get("why"), _MAX_TEXT)})
    return {
        "summary": _clip(data.get("summary"), 2 * _MAX_TEXT),
        "rules": rules[:_MAX_RULES],
        "adapted": adapted[:_MAX_NOTES],
        "dropped": dropped[:_MAX_NOTES],
    }


def _compose_prompt(text: str, rules: list[str], reference: str, example: str, language: str) -> str:
    listed = "\n".join(f"- {r}" for r in rules)
    return f"""Write an indicator script in the JavaScript indicator language below that follows exactly these rules,
taken from the trader's text further down. Use the text only to understand the rules; do not add rules it lists but the
trader did not keep.

THE RULES
{listed}

THE LANGUAGE
{reference}

AN EXAMPLE SCRIPT IN THAT LANGUAGE
```js
{example}
```

HOW TO WRITE IT
- Output exactly one ```js code block and nothing else.
- Every number a rule names becomes input(name, default) with that default, named in {language}.
- Work on whole arrays: ta.* helpers, then one or more for loops over i. Keep state (the last swings, a waiting entry) in
  variables updated inside the loop; never read a bar after i to decide a signal at i.
- ta.pivothigh and ta.pivotlow give a pivot only on the bar where it is confirmed: use that bar, not the pivot's own.
- A waiting entry (a limit or stop order) is signal(i, side, {{ entry, wait: N, ... }}) on the bar the order is placed,
  with N the bars it may wait; the runtime fills it on the first later bar that reaches the entry, or drops it. Without
  wait, an entry must lie inside bar i.
- One stop and one or two targets per signal: tp: [tp1, tp2] with size (the part closed at tp1), the stop moving to the
  fill price after tp1 (breakeven, the default). For BUY sl < entry < tp1 <= tp2, for SELL the reverse. Skip a signal whose
  risk-reward is below the rules' minimum, and never call signal() with a NaN price.
- One position at a time is exclusive: true. Sessions are session("HHMM-HHMM", tz)[i]; higher timeframes htf(minutes)
  with h.closed(series), never a bar that has not closed.
- Draw the levels the rules use with plot() as step lines (a value per bar, NaN where there is none), at most 8 plots.
- Put the setup's name and its confluence score (LOW, MEDIUM or HIGH) in the signal's label when the rules ask for one.
- A short comment at the top says what the script does and what the rules left out. Comments in {language}.
- No imports, no network, no DOM. Plain JavaScript only.

THE TRADER'S TEXT
<<<
{text}
>>>"""


def _reply_text(llm, prompt: str) -> str:
    from langchain_core.messages import HumanMessage

    from cli.display import extract_content_string

    reply = llm.invoke([HumanMessage(content=prompt)])
    return extract_content_string(getattr(reply, "content", None)) or ""


def _code_of(text: str) -> str:
    match = _FENCE.search(text)
    # A reply with a report but no code block holds no script, only the report.
    code = (match.group(1) if match else "" if _JSON_FENCE.search(text) else text).strip()
    if not code:
        raise ValueError("model tidak mengembalikan kode")
    return code


def _report_of(text: str) -> dict | None:
    """The translation's report as the page shows it: known keys only, strings clipped; None when there is none."""
    match = _JSON_FENCE.search(text)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None

    def pairs(items: object, key: str) -> list[dict]:
        out = []
        for item in items if isinstance(items, list) else []:
            item = item if isinstance(item, dict) else {"what": item}
            what = _clip(item.get("what"), _MAX_TEXT)
            if what:
                out.append({"what": what, key: _clip(item.get(key), _MAX_TEXT)})
        return out[:_MAX_CHANGES]

    kept = [t for t in (_clip(x, _MAX_TEXT) for x in data.get("kept") or [] if isinstance(data.get("kept"), list)) if t]
    return {"kept": kept[:_MAX_KEPT], "changed": pairs(data.get("changed"), "how"), "dropped": pairs(data.get("dropped"), "why")}


def translate_pine(llm, pine: str, reference: str, dictionary: str, example: str, language: str) -> tuple[str, dict | None]:
    """A Pine script in the app's language, and the report of what was kept, changed and dropped."""
    reply = _reply_text(llm, _prompt(pine, reference, dictionary, example, language))
    return _code_of(reply), _report_of(reply)


def repair_script(llm, source: str, text: str, rules: list[str], code: str, problems: list[str], reference: str,
                  dictionary: str, language: str) -> tuple[str, dict | None]:
    """A draft that failed the server's check, fixed; with a Pine source, its updated report too."""
    reply = _reply_text(llm, _repair_prompt(source, text, rules, code, problems, reference, dictionary, language))
    return _code_of(reply), _report_of(reply) if source == "pine" else None


def plan_from_prompt(llm, text: str, reference: str, language: str) -> dict:
    """A trader's text split into rules a script computes, rules changed to be testable, and what it cannot do."""
    reply = _reply_text(llm, _plan_prompt(text, reference, language))
    match = _OBJECT.search(reply)
    if not match:
        raise ValueError("model tidak mengembalikan rencana")
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise ValueError("rencana dari model bukan JSON yang sah") from exc
    return _clean_plan(data)


def script_from_rules(llm, text: str, rules: list[str], reference: str, example: str, language: str) -> str:
    """A script that follows the rules the trader kept from a plan."""
    return _code_of(_reply_text(llm, _compose_prompt(text, rules, reference, example, language)))
