"""Demo people for a first look at the app (no AI call). Dates are relative to
today, so there is always one birthday in 2 days (same-day only), one in about
a week, and some further out."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import store
from models import ImportantDate, Person, SavedIdea


def _idea(title: str, details: str | None = None, status: str = "idea", year: int | None = None) -> SavedIdea:
    return SavedIdea(id=uuid.uuid4().hex[:10], title=title, details=details, status=status, year=year,
                     source_text="Demo data")


def _bday(days_from_now: int) -> ImportantDate:
    d = date.today() + timedelta(days=days_from_now)
    return ImportantDate(occasion="birthday", month=d.month, day=d.day, source_text="Demo data")


def demo_people() -> list[Person]:
    last_year = date.today().year - 1
    return [
        Person(id=uuid.uuid4().hex[:10], name="Maya", relationship="best friend", location="06511",
               interests=["baking", "matcha", "pottery"], dislikes=["candles"],
               ideas=[_idea("Matcha set", "she keeps buying matcha lattes"), _idea("Cute ceramic mug"),
                      _idea("Pottery class", status="given", year=last_year)],
               dates=[_bday(2)], notes=["Lives in New Haven; loves anything from a local bakery"]),
        Person(id=uuid.uuid4().hex[:10], name="Priya", relationship="friend", location="Boston, MA",
               interests=["running"], sizes=["S", "shoes 7.5"], dislikes=["hoodies"],
               ideas=[_idea("Running stuff"), _idea("Trader Joe's flowers", "she loves them"),
                      _idea("Water bottle", status="given", year=last_year)],
               dates=[_bday(9)]),
        Person(id=uuid.uuid4().hex[:10], name="Dad", relationship="dad", location="Chicago, IL",
               interests=["golf", "fishing"],
               ideas=[_idea("Golf balls", status="bought"), _idea("Fishing hat", status="given", year=last_year)],
               dates=[_bday(30)]),
        Person(id=uuid.uuid4().hex[:10], name="Mom", relationship="mom",
               interests=["pottery", "reading"],
               ideas=[_idea("Anthropologie candle", "the green one"), _idea("Silk scarf", "blue?")],
               dates=[_bday(48)]),
        Person(id=uuid.uuid4().hex[:10], name="Sam & Alex", relationship="friends getting married",
               ideas=[_idea("Wedding registry gift", "registry on Zola")],
               dates=[ImportantDate(occasion="wedding", month=6, day=14, source_text="Demo data")]),
    ]


def load_demo() -> list[Person]:
    """Add the demo people, skipping names already saved. Returns everyone."""
    people = store.load_people()
    have = {p.name.lower() for p in people}
    people += [p for p in demo_people() if p.name.lower() not in have]
    store.save_people(people)
    return people
