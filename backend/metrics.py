"""Timings recorded by the browser (how long tasks take in the app), for the
report's impact numbers. Stored locally in data/metrics.jsonl; nothing personal."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from statistics import median

from models import Metric

FILE = Path(__file__).resolve().parent.parent / "data" / "metrics.jsonl"


def record(m: Metric) -> None:
    FILE.parent.mkdir(parents=True, exist_ok=True)
    with FILE.open("a") as f:
        f.write(json.dumps({"time": datetime.now().isoformat(timespec="seconds"), **m.model_dump()}) + "\n")


def summary() -> dict:
    rows: dict[str, list[float]] = {}
    try:
        for line in FILE.read_text().splitlines():
            r = json.loads(line)
            if "(cached)" in (r.get("detail") or ""):
                continue  # instant cache replays would flatter the numbers
            rows.setdefault(r["event"], []).append(r["seconds"])
    except FileNotFoundError:
        pass
    return {e: {"count": len(v), "median_seconds": round(median(v), 1), "fastest_seconds": round(min(v), 1)} for e, v in rows.items()}
