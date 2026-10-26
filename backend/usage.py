"""Token prices, per-agent usage, a run log, and the daily spending cap.

Prices are per 1M tokens, from the course's tokenomics lecture (lecture 11).
OpenAI counts cached tokens inside input_tokens, so those are billed at the
cached rate and only the rest at the full input rate.

Every AI call is appended to data/usage_log.jsonl (one JSON object per run),
which is the evidence for the report's tokenomics section. Before any run, the
daily cap is checked: once today's spend or request count passes the limit,
new runs are refused until tomorrow. Set the limits in .env if needed.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from pathlib import Path

from pydantic import BaseModel, Field

from llm import MODEL_NAME

PRICES = {"gpt-6-luna": {"input": 0.10, "cached_input": 0.01, "output": 0.50}}  # $ per 1M tokens
LOG_FILE = Path(__file__).resolve().parent.parent / "data" / "usage_log.jsonl"
DAILY_BUDGET_USD = float(os.getenv("GIFT_DAILY_BUDGET_USD", "0.50"))
DAILY_REQUEST_LIMIT = int(os.getenv("GIFT_DAILY_REQUEST_LIMIT", "400"))


def cost_usd(input_tokens: int, cached_tokens: int, output_tokens: int, model: str = MODEL_NAME) -> float:
    p = PRICES.get(model, PRICES["gpt-6-luna"])
    fresh = max(input_tokens - cached_tokens, 0)
    return (fresh * p["input"] + cached_tokens * p["cached_input"] + output_tokens * p["output"]) / 1_000_000


class AgentUsage(BaseModel):
    agent: str
    requests: int = 0
    input_tokens: int = 0
    cache_read_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class UsageSummary(BaseModel):
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0  # input tokens served from the provider's prompt cache
    cost_usd: float = 0.0
    by_agent: list[AgentUsage] = Field(default_factory=list)

    def add(self, agent: str, u) -> None:
        """Add one PydanticAI RunUsage under an agent's name."""
        row = next((r for r in self.by_agent if r.agent == agent), None)
        if row is None:
            row = AgentUsage(agent=agent)
            self.by_agent.append(row)
        cached = u.cache_read_tokens or 0
        c = cost_usd(u.input_tokens, cached, u.output_tokens)
        for target in (row, self):
            target.requests += u.requests
            target.input_tokens += u.input_tokens
            target.cache_read_tokens += cached
            target.output_tokens += u.output_tokens
            target.cost_usd += c


class SpendingCapReached(Exception):
    pass


def today_totals() -> tuple[float, int]:
    """(dollars, requests) spent today, from the run log."""
    spent, requests = 0.0, 0
    today = date.today().isoformat()
    try:
        for line in LOG_FILE.read_text().splitlines():
            row = json.loads(line)
            if row.get("time", "").startswith(today):
                spent += row["usage"]["cost_usd"]
                requests += row["usage"]["requests"]
    except FileNotFoundError:
        pass
    return spent, requests


def check_cap() -> None:
    spent, requests = today_totals()
    if spent >= DAILY_BUDGET_USD or requests >= DAILY_REQUEST_LIMIT:
        raise SpendingCapReached(
            f"Daily AI limit reached (${spent:.3f} of ${DAILY_BUDGET_USD:.2f}, {requests} of {DAILY_REQUEST_LIMIT} calls). "
            "New AI runs are paused until tomorrow so a bug or abuse can't run up the bill. Cached results still work."
        )


def log_run(kind: str, usage: UsageSummary, **extra) -> None:
    if usage.requests == 0:
        return
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    row = {"time": datetime.now().isoformat(timespec="seconds"), "kind": kind, "model": MODEL_NAME,
           "usage": usage.model_dump(), **extra}
    with LOG_FILE.open("a") as f:
        f.write(json.dumps(row) + "\n")


def status() -> dict:
    spent, requests = today_totals()
    return {"spent_today_usd": round(spent, 4), "requests_today": requests,
            "daily_budget_usd": DAILY_BUDGET_USD, "daily_request_limit": DAILY_REQUEST_LIMIT}
