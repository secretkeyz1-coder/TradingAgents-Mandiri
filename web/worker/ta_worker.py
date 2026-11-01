"""Bridge between the Bun web server and the TradingAgents engine.

Run from the repository root (the engine reads ``.env`` from the working
directory) with the project's virtualenv:

    python web/worker/ta_worker.py catalog      # form options as one JSON object
    python web/worker/ta_worker.py run < job.json
    python web/worker/ta_worker.py backtest < sweep.json

``run`` and ``backtest`` read one job as JSON on stdin and write one JSON event per line on
stdout. Everything else the engine prints goes to stderr, so stdout carries
only the protocol.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import time
import traceback
from pathlib import Path

# Keep the protocol stream clean: anything printed by libraries lands on stderr.
_PROTOCOL = sys.stdout
sys.stdout = sys.stderr

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

MAX_MESSAGE_CHARS = 4000

ANALYST_ORDER = ["market", "social", "news", "fundamentals"]
ANALYST_LABELS = {
    "market": "Market Analyst",
    "social": "Sentiment Analyst",
    "news": "News Analyst",
    "fundamentals": "Fundamentals Analyst",
}
ANALYST_REPORTS = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "fundamentals": "fundamentals_report",
}
FIXED_AGENTS = [
    ("Research Team", ["Bull Researcher", "Bear Researcher", "Research Manager"]),
    ("Trading Team", ["Trader"]),
    ("Risk Management", ["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst"]),
    ("Portfolio Management", ["Portfolio Manager"]),
]
REPORT_SECTIONS = [
    "market_report",
    "sentiment_report",
    "news_report",
    "fundamentals_report",
    "investment_plan",
    "trader_investment_plan",
    "final_trade_decision",
]
DEPTHS = [
    {"value": 1, "label": "Shallow", "description": "Cepat, sedikit ronde debat"},
    {"value": 3, "label": "Medium", "description": "Seimbang"},
    {"value": 5, "label": "Deep", "description": "Debat dan diskusi strategi mendalam"},
]
LANGUAGES = [
    "Indonesian", "English", "Chinese", "Japanese", "Korean", "Hindi", "Spanish",
    "Portuguese", "French", "German", "Arabic", "Russian",
]
# Providers that need a sign-in or cloud credentials the web form cannot collect.
UNSUPPORTED_PROVIDERS = {"chatgpt", "azure", "bedrock"}


def emit(event_type: str, **payload) -> None:
    _PROTOCOL.write(json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=str) + "\n")
    _PROTOCOL.flush()


def _truncate(text: str) -> str:
    return text if len(text) <= MAX_MESSAGE_CHARS else text[:MAX_MESSAGE_CHARS] + " …"


# --------------------------------------------------------------------------- catalog


def catalog() -> dict:
    from cli.prompts import _llm_provider_table
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.llm_clients.api_key_env import get_api_key_env
    from tradingagents.llm_clients.model_catalog import MODEL_OPTIONS
    from tradingagents.llm_clients.openai_client import OPENAI_COMPATIBLE_PROVIDERS

    default_provider = DEFAULT_CONFIG["llm_provider"].lower()
    providers = []
    for label, key, url in _llm_provider_table():
        if key in UNSUPPORTED_PROVIDERS:
            continue
        env_var = get_api_key_env(key)
        spec = OPENAI_COMPATIBLE_PROVIDERS.get(key)
        key_optional = env_var is None or (spec is not None and spec.key_optional)
        models = MODEL_OPTIONS.get(key, {"quick": [], "deep": []})
        # The server's own endpoint for its default provider (TRADINGAGENTS_LLM_BACKEND_URL)
        # stands in for the URL a user would otherwise have to type.
        if key == default_provider and DEFAULT_CONFIG["backend_url"]:
            url = DEFAULT_CONFIG["backend_url"]
        providers.append({
            "key": key,
            "label": label,
            "defaultUrl": url,
            "apiKeyEnv": env_var,
            "hasKey": key_optional or bool(os.environ.get(env_var)),
            "needsUrl": url is None and key != "google",
            "models": {
                mode: [{"label": text, "value": value} for text, value in models.get(mode, [])]
                for mode in ("quick", "deep")
            },
        })
    return {
        "providers": providers,
        "analysts": [{"value": k, "label": ANALYST_LABELS[k]} for k in ANALYST_ORDER],
        "depths": DEPTHS,
        "languages": LANGUAGES,
        # From TRADINGAGENTS_LLM_PROVIDER / _QUICK_THINK_LLM / _DEEP_THINK_LLM /
        # _LLM_BACKEND_URL when set: what a browser with nothing remembered starts with.
        "defaults": {
            "provider": DEFAULT_CONFIG["llm_provider"],
            "quickModel": DEFAULT_CONFIG["quick_think_llm"],
            "deepModel": DEFAULT_CONFIG["deep_think_llm"],
            "backendUrl": DEFAULT_CONFIG["backend_url"],
        },
    }


# --------------------------------------------------------------------------- run


class Progress:
    """Agent statuses and report sections, derived from the streamed state the
    same way the CLI's live view does, and emitted only when they change."""

    def __init__(self, analysts: list[str]):
        self.analysts = analysts
        self.status: dict[str, str] = {ANALYST_LABELS[a]: "pending" for a in analysts}
        for _team, agents in FIXED_AGENTS:
            for agent in agents:
                self.status[agent] = "pending"
        self.reports: dict[str, str] = {}
        self._sent_status: dict[str, str] = {}

    def set(self, agent: str, status: str) -> None:
        if agent in self.status:
            self.status[agent] = status

    def report(self, section: str, content) -> None:
        if not content:
            return
        text = "\n".join(str(x) for x in content) if isinstance(content, list) else str(content)
        if text.strip() and self.reports.get(section) != text:
            self.reports[section] = text
            emit("report", section=section, content=text)

    def flush(self) -> None:
        if self.status != self._sent_status:
            self._sent_status = dict(self.status)
            emit("status", agents=self.status)

    def apply(self, chunk: dict) -> None:
        all_filed = True
        for key in self.analysts:
            report_key = ANALYST_REPORTS[key]
            if chunk.get(report_key):
                self.report(report_key, chunk[report_key])
            if self.reports.get(report_key):
                self.set(ANALYST_LABELS[key], "completed")
            else:
                self.set(ANALYST_LABELS[key], "in_progress")
                all_filed = False
        if all_filed and self.analysts and self.status.get("Bull Researcher") == "pending":
            self.set("Bull Researcher", "in_progress")

        debate = chunk.get("investment_debate_state") or {}
        bull = (debate.get("bull_history") or "").strip()
        bear = (debate.get("bear_history") or "").strip()
        judge = (chunk.get("investment_plan") or "").strip()
        if bull or bear:
            for agent in ("Bull Researcher", "Bear Researcher", "Research Manager"):
                if self.status[agent] != "completed":
                    self.set(agent, "in_progress")
        if judge:
            self.report("investment_plan", judge)
            for agent in ("Bull Researcher", "Bear Researcher", "Research Manager"):
                self.set(agent, "completed")
            if self.status["Trader"] == "pending":
                self.set("Trader", "in_progress")

        if chunk.get("trader_investment_plan"):
            self.report("trader_investment_plan", chunk["trader_investment_plan"])
            if self.status["Trader"] != "completed":
                self.set("Trader", "completed")
                self.set("Aggressive Analyst", "in_progress")

        risk = chunk.get("risk_debate_state") or {}
        for agent, field in (("Aggressive Analyst", "aggressive_history"),
                             ("Conservative Analyst", "conservative_history"),
                             ("Neutral Analyst", "neutral_history")):
            if (risk.get(field) or "").strip() and self.status[agent] != "completed":
                self.set(agent, "in_progress")
        decision = (chunk.get("final_trade_decision") or "").strip()
        if decision:
            self.report("final_trade_decision", decision)
            for agent in ("Aggressive Analyst", "Conservative Analyst", "Neutral Analyst",
                          "Portfolio Manager"):
                self.set(agent, "completed")

    def finish(self) -> None:
        for agent in self.status:
            self.status[agent] = "completed"
        self.flush()


def _build_config(job: dict) -> dict:
    from cli.prompts import resolve_backend_url
    from tradingagents.default_config import DEFAULT_CONFIG

    config = DEFAULT_CONFIG.copy()
    provider = job["provider"].lower()
    config["llm_provider"] = provider
    config["quick_think_llm"] = job["quickModel"]
    config["deep_think_llm"] = job["deepModel"]
    # The engine lets TRADINGAGENTS_LLM_BACKEND_URL override every provider. Here the
    # user picks the provider per run, so that URL only stands in for the server's
    # default provider when the request names none; a URL in the request always wins.
    env_url = DEFAULT_CONFIG["backend_url"] if provider == DEFAULT_CONFIG["llm_provider"].lower() else None
    config["backend_url"] = resolve_backend_url(provider, job.get("backendUrl") or env_url)
    config["max_debate_rounds"] = int(job["depth"])
    config["max_risk_discuss_rounds"] = int(job["depth"])
    config["output_language"] = job.get("language") or "English"
    # A call that hangs at a gateway must fail, not stall the job: the server
    # only sees progress through events. Retries stay small for the same reason.
    config["llm_timeout"] = float(os.environ.get("TA_LLM_TIMEOUT", "180"))
    config["llm_max_retries"] = int(os.environ.get("TA_LLM_MAX_RETRIES", "2"))
    # The engine's benchmark map has no IDX entry, so .JK decisions were scored
    # against SPY; score them against the Jakarta Composite instead.
    config["benchmark_map"] = {".JK": "^JKSE", **config["benchmark_map"]}
    return config


def _resolve(raw_ticker: str, requested: list[str]) -> tuple[str, str, list[str]]:
    """Canonical ticker, asset type, and the requested analysts that apply to it."""
    from cli.models import AnalystType
    from cli.prompts import (
        detect_asset_type,
        filter_analysts_for_asset_type,
        normalize_ticker_symbol,
    )

    ticker = normalize_ticker_symbol(raw_ticker)
    asset_type = detect_asset_type(ticker)
    kept = filter_analysts_for_asset_type([AnalystType(a) for a in requested], asset_type)
    analysts = [a for a in ANALYST_ORDER if a in {k.value for k in kept}]
    # The engine only drops fundamentals for crypto; forex (EURUSD=X), futures
    # (GC=F) and indices (^JKSE) have no company statements either.
    if ticker.endswith(("=X", "=F")) or ticker.startswith("^"):
        analysts = [a for a in analysts if a != "fundamentals"]
    if not analysts:
        raise ValueError(f"Pilih minimal satu analyst yang berlaku untuk {ticker}.")
    return ticker, asset_type.value, analysts


def run(job: dict) -> int:
    from cli.display import classify_message_type
    from cli.stats_handler import StatsCallbackHandler
    from tradingagents.agents.rating import is_review, run_rating
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    ticker, asset_type, analysts = _resolve(job["ticker"], job["analysts"])
    trade_date = job["date"]

    config = _build_config(job)
    stats = StatsCallbackHandler()
    emit("started", ticker=ticker, assetType=asset_type, date=trade_date, analysts=analysts)

    graph = TradingAgentsGraph(analysts, config=config, debug=True, callbacks=[stats])
    progress = Progress(analysts)
    for key in analysts:
        progress.set(ANALYST_LABELS[key], "in_progress")
    progress.flush()

    init_state = graph.create_run_state(ticker, trade_date, asset_type)
    args = graph.propagator.get_graph_args(callbacks=[stats])
    seen: set = set()
    final_state: dict = {}
    last_stats = 0.0

    for messages, chunk in graph.stream_run(init_state, **args):
        for message in messages:
            msg_id = getattr(message, "id", None)
            if msg_id is not None:
                if msg_id in seen:
                    continue
                seen.add(msg_id)
            kind, content = classify_message_type(message)
            if content and content.strip() and kind != "Control":
                emit("message", kind=kind, content=_truncate(content))
            for call in getattr(message, "tool_calls", None) or []:
                name = call["name"] if isinstance(call, dict) else call.name
                call_args = call["args"] if isinstance(call, dict) else call.args
                emit("tool_call", name=name, args=call_args)

        if chunk is not None:
            # Inside an analyst's graph the chunk is only that analyst's report;
            # at the top level it is the whole state. Either way it merges in.
            final_state.update(chunk)
            progress.apply(chunk)
            progress.flush()

        now = time.monotonic()
        if now - last_stats > 2:
            last_stats = now
            emit("stats", llmCalls=stats.llm_calls, toolCalls=stats.tool_calls,
                 tokensIn=stats.tokens_in, tokensOut=stats.tokens_out)

    graph.record_decision(ticker, trade_date, final_state)

    for section in REPORT_SECTIONS:
        progress.report(section, final_state.get(section))
    progress.finish()

    report_dir = graph.default_report_path(ticker)
    html = None
    try:
        graph.save_reports(final_state, ticker, report_dir, html=True)
        html = (report_dir / "complete_report.html").read_text(encoding="utf-8")
    except Exception as exc:  # the run's result stands even if the files could not be written
        emit("message", kind="System", content=f"Laporan tidak bisa disimpan: {exc}")

    rating = run_rating(final_state)
    emit("stats", llmCalls=stats.llm_calls, toolCalls=stats.tool_calls,
         tokensIn=stats.tokens_in, tokensOut=stats.tokens_out)
    emit("done", rating=rating, review=is_review(rating), reportDir=str(report_dir), html=html)
    return 0


def _percent(text: str | None) -> float | None:
    """The memory log keeps returns as text like "+1.2%"; as a fraction, or None."""
    try:
        return float((text or "").strip().rstrip("%")) / 100
    except ValueError:
        return None


def backtest_result(log_path: Path, run_id: str, failures: list, settlement_failures: list) -> dict:
    """The sweep's cells and per-rating scores, read back from its memory log."""
    from tradingagents.backtest import summarize
    from tradingagents.memory import TradingMemoryLog

    entries = TradingMemoryLog({"memory_log_path": str(log_path)}).load_entries() if log_path.is_file() else []
    cells = [
        {
            "ticker": e["ticker"],
            "date": e["date"],
            "rating": e["rating"],
            "pending": e["pending"],
            "return": _percent(e.get("raw")),
            "alpha": _percent(e.get("alpha")),
            "holding": e.get("holding"),
        }
        for e in entries
    ]
    summary = None
    if log_path.is_file():
        s = summarize(log_path)
        summary = {
            "resolved": s.resolved,
            "pending": s.pending,
            "unscored": s.unscored,
            "holding": s.holding,
            "byRating": {
                rating: {"count": r.count, "hitRate": r.hit_rate, "meanAlpha": r.mean_alpha}
                for rating, r in s.by_rating.items()
            },
        }
    return {
        "runId": run_id,
        "cells": sorted(cells, key=lambda c: (c["ticker"], c["date"])),
        "summary": summary,
        "failures": [{"ticker": t, "date": d, "error": err} for t, d, err in failures],
        "settlementFailures": [{"ticker": t, "error": err} for t, err in settlement_failures],
    }


def backtest(job: dict) -> int:
    """Run the engine's own sweep (tradingagents.backtest) over tickers x dates.

    Every cell is a full analysis, scored later against its benchmark over the
    holding window. Each ticker runs in its own call because a sweep takes one
    asset type; they share one run id, so they share one memory log, and a
    re-run with the same id skips the cells already done.
    """
    from tradingagents.backtest import iter_grid, run_backtest

    every = int(job.get("everyNDays") or 7)
    dates = iter_grid(job["start"], job["end"], every)
    # One entry per canonical ticker: BBCA.JK typed twice is one ticker.
    resolved = list({r[0]: r for r in (_resolve(t, job["analysts"]) for t in job["tickers"])}.values())
    config = _build_config(job)
    total = len(resolved) * len(dates)
    emit("started", tickers=[r[0] for r in resolved], dates=dates, total=total, everyNDays=every)

    def progress_from(offset: int):
        # run_backtest counts only the cells it still has to run for one ticker:
        # (n-th of todo). Cells it skipped as already done come before them.
        def progress(n, todo, cell_ticker, cell_date):
            emit("progress", done=offset + (len(dates) - todo) + n - 1, total=total,
                 ticker=cell_ticker, date=cell_date)
        return progress

    run_id = job.get("runId")
    failures: list = []
    settlement_failures: list = []
    log_path = None
    for index, (ticker, asset_type, analysts) in enumerate(resolved):
        offset = index * len(dates)
        result = run_backtest([ticker], dates, config, asset_type=asset_type,
                              selected_analysts=analysts, run_id=run_id, progress=progress_from(offset))
        run_id, log_path = result.run_id, result.log_path
        failures += result.failures
        settlement_failures += result.settlement_failures
        emit("progress", done=offset + len(dates), total=total, ticker=ticker, date=None)

    emit("done", result=backtest_result(log_path, run_id, failures, settlement_failures))
    return 0


def agent(job: dict) -> int:
    """One chat turn with the chart agent (web/worker/chart_agent.py), on the deep model tier."""
    from chart_agent import run_agent

    from tradingagents.dataflows.config import run_config
    from tradingagents.llm_clients import create_tier_client

    config = _build_config({**job, "depth": 1})
    # Someone is waiting on this turn: one retry, and a shorter clock than a run gets.
    config["llm_timeout"] = float(os.environ.get("TA_AGENT_LLM_TIMEOUT", "120"))
    config["llm_max_retries"] = 1
    with run_config(config):
        llm = create_tier_client(config, "deep").get_llm()
        try:
            run_agent(llm, job, emit)
        except Exception as exc:
            emit("error", message=_provider_error(exc, job["deepModel"], config["backend_url"], config["llm_timeout"]))
            return 1
    emit("done")
    return 0


def _provider_error(exc: Exception, model: str, url: str | None, timeout: float) -> str:
    """What went wrong at the model provider, in the user's terms: the SDK's own
    wording (``Request timed out.``, ``Error code: 503 - {...}``) hides whether the
    model name, the URL, or the service itself is the problem."""
    name = type(exc).__name__
    where = f"model '{model}' di {url or 'endpoint bawaan provider'}"
    if "Timeout" in name:
        return f"Provider tidak menjawab dalam {timeout:.0f} detik ({where}). Periksa nama model dan URL, atau coba lagi."
    if "Connection" in name:
        return f"Tidak bisa terhubung ke provider ({where}): {exc}"
    status = getattr(exc, "status_code", None)
    body = getattr(exc, "body", None)
    detail = body.get("error", body) if isinstance(body, dict) else None
    if isinstance(detail, dict):
        detail = detail.get("message") or json.dumps(detail, ensure_ascii=False)
    if status:
        hint = " Nama model tidak dikenal provider." if status in (404, 503) and "not found" in str(detail).lower() else ""
        return f"Provider menjawab HTTP {status} ({where}): {str(detail or exc)[:500]}.{hint}"
    return f"{name}: {str(exc)[:500]}"


def signals(job: dict) -> int:
    """Scan symbols for new indicator signals (notifications); see signals.py."""
    from signals import scan

    return scan(job, emit)


def translate(job: dict) -> int:
    """Pine Script to the app's indicator script language, on the deep model tier (script_translate.py)."""
    from script_translate import translate_pine

    from tradingagents.dataflows.config import run_config
    from tradingagents.llm_clients import create_tier_client

    config = _build_config({**job, "depth": 1})
    config["llm_timeout"] = float(os.environ.get("TA_AGENT_LLM_TIMEOUT", "120")) * 2
    config["llm_max_retries"] = 1
    with run_config(config):
        llm = create_tier_client(config, "deep").get_llm()
        try:
            code = translate_pine(llm, job["pine"], job.get("reference") or "", job.get("example") or "", job.get("language") or "Indonesian")
        except Exception as exc:
            emit("error", message=_provider_error(exc, job["deepModel"], config["backend_url"], config["llm_timeout"]))
            return 1
    emit("code", code=code)
    emit("done")
    return 0


def lab(job: dict) -> int:
    """Run one built-in engine on the bars the strategy lab sends; see lab.py."""
    from lab import run as run_lab

    return run_lab(job, emit)


def market_brief(job: dict) -> int:
    """The public site's market brief, on the quick model tier (brief.py)."""
    from brief import write_brief

    from tradingagents.dataflows.config import run_config
    from tradingagents.llm_clients import create_tier_client

    config = _build_config({**job, "depth": 1})
    config["llm_timeout"] = float(os.environ.get("TA_AGENT_LLM_TIMEOUT", "120"))
    config["llm_max_retries"] = 1
    with run_config(config):
        llm = create_tier_client(config, "quick").get_llm()
        try:
            content = write_brief(llm, job["data"])
        except Exception as exc:
            emit("error", message=_provider_error(exc, job["quickModel"], config["backend_url"], config["llm_timeout"]))
            return 1
    emit("brief", content=content)
    emit("done")
    return 0


COMMANDS = {"run": run, "backtest": backtest, "agent": agent, "signals": signals, "translate": translate, "lab": lab, "brief": market_brief}
# The commands that call a model; each reports its tokens when it ends, per model (server/src/tokens.ts).
METERED = {"run", "backtest", "agent", "translate", "brief"}


def _token_meter():
    """Totals every model call made while it is open, through LangChain's callback context."""
    try:
        from langchain_core.callbacks import get_usage_metadata_callback
    except ImportError:
        return contextlib.nullcontext()
    return get_usage_metadata_callback()


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    if command == "catalog":
        _PROTOCOL.write(json.dumps(catalog(), ensure_ascii=False) + "\n")
        _PROTOCOL.flush()
        return 0
    if command in COMMANDS:
        with _token_meter() if command in METERED else contextlib.nullcontext() as usage:
            try:
                job = json.loads(sys.stdin.read())
                return COMMANDS[command](job)
            except Exception as exc:
                traceback.print_exc()
                emit("error", message=f"{type(exc).__name__}: {exc}")
                return 1
            finally:
                # Tokens are spent whether the command succeeded or not.
                if usage is not None and usage.usage_metadata:
                    emit("usage", models={model: {"input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0)}
                                          for model, u in usage.usage_metadata.items()})
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
