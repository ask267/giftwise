"""People store: a JSON file of gift profiles. Merging reviewed imports lives here."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from models import ImportantDate, ImportPerson, ImportResult, NewIdea, NewPerson, Person, PersonUpdate, SavedIdea

PEOPLE_FILE = Path(__file__).resolve().parent.parent / "data" / "people.json"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def load_people() -> list[Person]:
    try:
        return [Person.model_validate(p) for p in json.loads(PEOPLE_FILE.read_text())]
    except FileNotFoundError:
        return []


def save_people(people: list[Person]) -> None:
    PEOPLE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PEOPLE_FILE.write_text(json.dumps([p.model_dump() for p in people], indent=2))


def _add_unique(target: list[str], items: list[str]) -> None:
    seen = {_norm(t) for t in target}
    for item in items:
        if _norm(item) and _norm(item) not in seen:
            target.append(item)
            seen.add(_norm(item))


def import_people(cards: list[ImportPerson]) -> ImportResult:
    people = load_people()
    by_id = {p.id: p for p in people}
    created = updated = ideas_added = dupes = 0

    for card in cards:
        parsed = card.person
        person = by_id.get(card.match_id) if card.match_id else None
        if person is None:
            person = Person(id=uuid.uuid4().hex[:10], name=parsed.display_name, relationship=parsed.relationship)
            people.append(person)
            by_id[person.id] = person
            created += 1
        else:
            updated += 1
            person.relationship = person.relationship or parsed.relationship

        existing = {_norm(i.title) for i in person.ideas}
        for idea in parsed.ideas:
            if _norm(idea.title) in existing:
                dupes += 1
                continue
            person.ideas.append(SavedIdea(id=uuid.uuid4().hex[:10], **idea.model_dump()))
            existing.add(_norm(idea.title))
            ideas_added += 1

        _add_unique(person.dislikes, parsed.dislikes)
        _add_unique(person.interests, parsed.interests)
        _add_unique(person.sizes, parsed.sizes)
        if parsed.notes:
            _add_unique(person.notes, [parsed.notes])
        for d in parsed.dates:
            same = next((x for x in person.dates if x.occasion == d.occasion), None)
            if same is None:
                person.dates.append(d)
            else:  # fill in a missing month/day, never overwrite one
                same.month = same.month or d.month
                same.day = same.day or d.day

    save_people(people)
    return ImportResult(
        created=created, updated=updated, ideas_added=ideas_added, duplicates_skipped=dupes, people=people
    )


def delete_person(person_id: str) -> bool:
    people = load_people()
    kept = [p for p in people if p.id != person_id]
    save_people(kept)
    return len(kept) != len(people)


def get_person(person_id: str) -> Person | None:
    return next((p for p in load_people() if p.id == person_id), None)


def add_idea(person_id: str, idea: NewIdea) -> Person | None:
    """Save one gift-finder pick to a person's ideas (skips duplicates)."""
    people = load_people()
    person = next((p for p in people if p.id == person_id), None)
    if person is None:
        return None
    if _norm(idea.title) not in {_norm(i.title) for i in person.ideas}:
        person.ideas.append(SavedIdea(
            id=uuid.uuid4().hex[:10], title=idea.title, details=idea.details, link=idea.link,
            price_hint=idea.price_hint, occasion=idea.occasion, status="idea",
            source_text="Saved from the gift finder",
        ))
        save_people(people)
    return person


def set_date(person_id: str, d: ImportantDate) -> Person | None:
    """Add or replace one occasion date for a person (e.g. typing in a missing birthday)."""
    people = load_people()
    person = next((p for p in people if p.id == person_id), None)
    if person is None:
        return None
    person.dates = [x for x in person.dates if x.occasion != d.occasion] + [d]
    save_people(people)
    return person


def set_location(person_id: str, location: str | None) -> None:
    people = load_people()
    for p in people:
        if p.id == person_id and p.location != location:
            p.location = location
            save_people(people)


def set_idea_status(person_id: str, idea_id: str, status: str, year: int | None, spent: float | None = None) -> Person | None:
    """Mark an idea as bought or given (or back to idea), so agents never suggest it again."""
    people = load_people()
    person = next((p for p in people if p.id == person_id), None)
    idea = next((i for i in person.ideas if i.id == idea_id), None) if person else None
    if idea is None:
        return None
    idea.status, idea.year = status, year
    if spent is not None:
        idea.spent = spent
    save_people(people)
    return person


def create_person(new: NewPerson) -> Person:
    people = load_people()
    clean = lambda xs: [x.strip() for x in xs if x.strip()]  # noqa: E731
    person = Person(
        id=uuid.uuid4().hex[:10], name=new.name.strip(), relationship=(new.relationship or "").strip() or None,
        location=(new.location or "").strip() or None,
        interests=clean(new.interests), dislikes=clean(new.dislikes), sizes=clean(new.sizes),
        notes=[new.notes.strip()] if new.notes and new.notes.strip() else [],
        dates=[ImportantDate(occasion="birthday", month=new.birthday_month, day=new.birthday_day, source_text="Added by hand")]
        if new.birthday_month else [],
        ideas=[SavedIdea(id=uuid.uuid4().hex[:10], title=t, source_text="Added by hand") for t in clean(new.ideas)],
    )
    people.append(person)
    save_people(people)
    return person


def set_photo(person_id: str, data_url: str | None) -> Person | None:
    people = load_people()
    person = next((p for p in people if p.id == person_id), None)
    if person is None:
        return None
    person.photo = data_url
    save_people(people)
    return person


def update_person(person_id: str, u: PersonUpdate) -> Person | None:
    people = load_people()
    person = next((p for p in people if p.id == person_id), None)
    if person is None:
        return None
    clean = lambda xs: [x.strip() for x in xs if x.strip()]  # noqa: E731
    person.name = u.name.strip()
    person.relationship = (u.relationship or "").strip() or None
    person.location = (u.location or "").strip() or None
    person.interests, person.dislikes, person.sizes = clean(u.interests), clean(u.dislikes), clean(u.sizes)
    person.dates = [d for d in person.dates if d.occasion != "birthday"]
    if u.birthday_month:
        person.dates.append(ImportantDate(occasion="birthday", month=u.birthday_month, day=u.birthday_day, source_text="Edited by hand"))
    save_people(people)
    return person
