"""Pine Script to the app's indicator script language (web/shared/script.ts),
by an LLM. The result is only a draft: the page runs it on the chart and the
user reviews it before saving or switching on notifications."""

from __future__ import annotations

import re

_FENCE = re.compile(r"```(?:js|javascript)?\s*\n(.*?)```", re.S)


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


def translate_pine(llm, pine: str, reference: str, example: str, language: str) -> str:
    from langchain_core.messages import HumanMessage

    from cli.display import extract_content_string

    reply = llm.invoke([HumanMessage(content=_prompt(pine, reference, example, language))])
    text = extract_content_string(getattr(reply, "content", None)) or ""
    match = _FENCE.search(text)
    code = (match.group(1) if match else text).strip()
    if not code:
        raise ValueError("model tidak mengembalikan kode")
    return code
