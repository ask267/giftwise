"""Gift-decision memory: what you searched for each person, what you did with
the picks (saved, shopped, found delivery...), and notes like "leaning toward
the bakery cake". The chat reads this to tell you where you left off.

Stored locally: data/history.jsonl (append-only events) and
data/decisions.json (notes per person). Nothing here is sent anywhere except,
in short summaries, to the chat agent when you ask it something.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
EVENTS = DATA / "history.jsonl"
DECISIONS = DATA / "decisions.json"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _append(row: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    with EVENTS.open("a") as f:
        f.write(json.dumps({"time": _now(), **row}) + "\n")


def log_search(person_id: str, person_name: str, occasion: str, event_date: str, budget: float,
               vibes: list[str], picks: list[dict], cached: bool) -> None:
    _append({"type": "search", "person_id": person_id, "person": person_name, "occasion": occasion,
             "event_date": event_date, "budget": budget, "vibes": vibes, "cached": cached,
             "picks": [{"title": p["title"], "store": p["store"], "price": p["price"], "tier": p["tier_label"],
                        "local": p.get("is_local", False)} for p in picks]})


def log_action(person_id: str, person_name: str, action: str, title: str, store: str | None) -> None:
    _append({"type": "action", "person_id": person_id, "person": person_name, "action": action,
             "title": title, "store": store})


def events(person_id: str | None = None, limit: int = 50) -> list[dict]:
    try:
        rows = [json.loads(line) for line in EVENTS.read_text().splitlines() if line.strip()]
    except FileNotFoundError:
        return []
    if person_id:
        rows = [r for r in rows if r.get("person_id") == person_id]
    return rows[-limit:]


def _load_decisions() -> dict[str, list[dict]]:
    try:
        return json.loads(DECISIONS.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def add_decision(person_id: str, person_name: str, note: str) -> None:
    d = _load_decisions()
    d.setdefault(person_id, []).append({"time": _now(), "person": person_name, "note": note.strip()[:300]})
    DATA.mkdir(parents=True, exist_ok=True)
    DECISIONS.write_text(json.dumps(d, indent=1))


def decisions(person_id: str | None = None) -> list[dict]:
    d = _load_decisions()
    if person_id:
        return d.get(person_id, [])
    return sorted((n for notes in d.values() for n in notes), key=lambda n: n["time"])


ACTION_WORDS = {"saved idea": "saved", "shop": "opened the store for", "find delivery": "looked up delivery for",
                "card": "wrote a card for", "chip in": "started a group gift for"}


def where_you_left_off(names: dict[str, str]) -> dict:
    """A plain-code summary (no AI) of the most recent decision work, for the chat greeting."""
    rows = events(limit=200)
    notes = decisions()
    if not rows and not notes:
        return {"text": None, "person_id": None}
    last_time = max([r["time"] for r in rows] + [n["time"] for n in notes])
    last_pid = next((r["person_id"] for r in reversed(rows) if r["time"] == last_time), None)
    if last_pid is None:
        last_pid = next((pid for pid, ns in _load_decisions().items() if any(n["time"] == last_time for n in ns)), None)
    name = names.get(last_pid, "someone")
    mine = [r for r in rows if r.get("person_id") == last_pid]
    search = next((r for r in reversed(mine) if r["type"] == "search"), None)
    acts = [r for r in mine if r["type"] == "action" and (not search or r["time"] >= search["time"])]
    parts = []
    when = datetime.fromisoformat(last_time).strftime("%b %d at %-I:%M %p")
    if search:
        top = ", ".join(f"{p['title']} ({p['store']})" for p in search["picks"][:3]) or "no strong picks"
        parts.append(f"Last time ({when}) you were finding a {search['occasion']} gift for {name} "
                     f"(budget ${search['budget']:.0f}). The agents suggested: {top}.")
    if acts:
        parts.append("You " + "; ".join(f"{ACTION_WORDS.get(a['action'], a['action'])} {a['title']}" for a in acts[-3:]) + ".")
    pn = [n for n in notes if n["person"] == name]
    if pn:
        parts.append(f'Your note: "{pn[-1]["note"].rstrip(".")}."')
    if not acts:
        parts.append("You hadn't picked one yet.")
    return {"text": " ".join(parts), "person_id": last_pid, "person": name}
