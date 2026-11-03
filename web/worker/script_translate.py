"""Pine Script, or a prompt in plain words, to the app's indicator script
language (web/shared/script.ts), by an LLM. A prompt goes in two steps: a plan
that splits it into rules a script can compute from prices, rules changed so
they can be tested, and what no script can do (an analyst's prose, judgement,
news); then a script from the rules the user kept. The result is only a draft:
the page runs it on the chart and the user reviews it before saving or
switching on notifications."""

from __future__ import annotations

import json
import re

_FENCE = re.compile(r"```(?:js|javascript)?\s*\n(.*?)```", re.S)
_OBJECT = re.compile(r"\{.*\}", re.S)
# What a plan may hold, so a long reply cannot flood the page.
_MAX_RULES, _MAX_NOTES, _MAX_TEXT, _MAX_PARAM = 20, 10, 240, 60


def _prompt(pine: str, reference: str, example: str, language: str) -> str:
    return f"""Translate this TradingView Pine Script indicator into the JavaScript indicator language below.

THE LANGUAGE
{reference}

AN EXAMPLE SCRIPT IN THAT LANGUAGE
```js
{example}
```

RULES
- Output exactly one ```js code block and nothing else.
- Keep the indicator's logic and default inputs: every Pine input(...) becomes input(name, default) with the same default.
- Work on whole arrays: compute series with ta.* or a for loop over i, never per-bar global state like Pine's implicit bar loop.
  Pine's x[1] is x[i - 1]; var/state variables become variables updated inside one for loop over i from 1 to n - 1.
- Signals: call signal(i, "BUY"|"SELL", {{ sl, tp, label }}) exactly where the Pine script decides a buy or sell
  (its buy/sell conditions, plotshape/label markers or alertcondition). Use the script's own stop loss and take profit;
  if it has none, use 1.5 * ATR(14) for the stop and 2R for the target, and say so in a comment.
- Pine strategies that close a position on a condition (strategy.close, strategy.exit with a condition, or a time limit):
  pass that condition as the signal's exit series (a boolean array over all bars) and the bar limit as maxBars, keep a protective
  stop as sl and a far target as tp; when the strategy holds one position at a time, add exclusive: true.
- barstate.isconfirmed / closed-bar logic: the runtime already ignores the forming bar.
- Keep only plot() lines and hline() levels; drop tables, labels, boxes, colors of backgrounds and other drawings, and say what was
  dropped in a short comment at the top.
- request.security / other timeframes cannot be read: build the higher timeframe from these bars if it is simple
  (e.g. group by hour from time), else leave it out and say so in a comment.
- No imports, no network, no DOM. Plain JavaScript only.
- Comments in {language}.

THE PINE SCRIPT
```pine
{pine}
```"""


def _plan_prompt(text: str, reference: str, language: str) -> str:
    return f"""A trader describes a strategy or pastes an analysis prompt written for an AI. Plan an indicator script for it
in the JavaScript indicator language below: one timeframe's bars (open, high, low, close, volume, time), ta.* helpers,
plot/hline lines, and signal(i, side, {{ sl, tp, entry }}) with one stop and one target per signal.

THE LANGUAGE
{reference}

SORT EVERY PART OF THE TEXT INTO ONE OF THREE LISTS
- "rules": what a script can compute from these bars, one rule per item, each with its main number as "param" when it has one
  (e.g. {{"text": "Swing high dan swing low yang sudah terkonfirmasi", "param": "Pivot 5 candle"}}). Market structure (swings,
  breaks of structure, order blocks, fair value gaps, liquidity sweeps, equal highs and lows, premium and discount), chart
  patterns, trendlines from swings, candle patterns, indicator divergences, entry, stop and target rules, a minimum
  risk-reward, and a confluence score in the signal's label all belong here. Higher timeframes can be built from these bars.
- "adapted": what must change to be testable, each saying the change in one sentence: several targets become one target
  per signal; a pending (limit or stop) order becomes a signal on the bar where price reaches the entry, cancelled after a
  number of bars; a timeframe below 15 minutes becomes 15 minutes; a broker's spread becomes the test's cost per trade.
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
- A waiting entry (a limit or stop order) is a signal on the first later bar whose range reaches the entry, with entry set
  to that price; drop it when it waits longer than its limit or when price breaks its invalidation first.
- One stop and one target per signal; for BUY sl < entry < tp, for SELL tp < entry < sl. Skip a signal whose risk-reward is
  below the rules' minimum, and never call signal() with a NaN price.
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
    code = (match.group(1) if match else text).strip()
    if not code:
        raise ValueError("model tidak mengembalikan kode")
    return code


def translate_pine(llm, pine: str, reference: str, example: str, language: str) -> str:
    return _code_of(_reply_text(llm, _prompt(pine, reference, example, language)))


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
