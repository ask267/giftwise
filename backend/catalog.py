"""Gift catalog + search, used as a tool by the Shopping agents.

Product descriptions come from sellers, so they are untrusted: search results
are scrubbed of sentences aimed at an AI, and scrubbed listings are flagged so
the Critic and the UI can see it.
"""

from __future__ import annotations

import re

from pydantic import BaseModel

from catalog_data import ROWS
from store_links import store_link
from safety import scrub

Tier = str  # "same_day" | "fast" | "planned"

TIER_LABEL = {"same_day": "Same day", "fast": "2–3 days", "planned": "7–14 days"}
TIER_MIN_DAYS = {"same_day": 0, "fast": 3, "planned": 10}  # days needed before the event


class Product(BaseModel):
    id: str
    title: str
    store: str
    price: float
    tiers: list[str]
    vibes: list[str]
    tags: list[str]
    description: str
    seller_text_flagged: bool = False  # description contained text aimed at an AI (removed)

    @property
    def link(self) -> str:
        """The store's own site (its search results for this item, or its shop page)."""
        return store_link(self.store, self.title, self.id)[0]


def _build() -> dict[str, Product]:
    out = {}
    for pid, title, store, price, tiers, vibes, tags, desc in ROWS:
        clean, flagged = scrub(desc)
        out[pid] = Product(
            id=pid, title=title, store=store, price=price, tiers=tiers, vibes=vibes, tags=tags,
            description=clean, seller_text_flagged=flagged,
        )
    return out


CATALOG = _build()


def feasible_tiers(days_left: int) -> list[str]:
    return [t for t, need in TIER_MIN_DAYS.items() if days_left >= need]


def _words(s: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z0-9']+", s.lower()) if len(w) > 2}


def search(query: str, tier: str, max_price: float, exclude_ids: set[str] | None = None, limit: int = 6) -> list[Product]:
    """Keyword search over title/tags/vibes/description, filtered by tier and price."""
    q = _words(query)
    scored = []
    for p in CATALOG.values():
        if tier not in p.tiers or p.price > max_price or (exclude_ids and p.id in exclude_ids):
            continue
        title, tags = _words(p.title), _words(" ".join(p.tags + p.vibes))
        score = 3 * len(q & title) + 2 * len(q & tags) + len(q & _words(p.description))
        if score:
            scored.append((score, p))
    scored.sort(key=lambda x: (-x[0], x[1].price))
    return [p for _, p in scored[:limit]]
