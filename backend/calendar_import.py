"""Read birthdays and anniversaries from calendar (.ics) and contacts (.vcf) exports.

Plain parsing, no AI: these formats are structured, so a model call would only
add cost and the chance of a wrong date.

- .ics (Google/Apple Calendar export): VEVENTs whose title mentions a birthday,
  anniversary or wedding. "Priya's Birthday", "Bday - Jake", "Mom & Dad anniversary".
- .vcf (iPhone/Google Contacts export): BDAY and ANNIVERSARY fields.
"""

from __future__ import annotations

import re

from models import ImportantDate, ParsedPerson, Person

OCCASION_WORDS = [
    ("birthday", re.compile(r"\b(birthday|bday|b-day|birth day)\b", re.I)),
    ("anniversary", re.compile(r"\banniversary\b", re.I)),
    ("wedding", re.compile(r"\bwedding\b", re.I)),
]
NOISE = re.compile(
    r"\b(birthday|bday|b-day|birth day|anniversary|wedding|party|celebration|happy|day|of|the)\b|'s\b|’s\b|[-–—:!🎂🎉🎁()]",
    re.I,
)


def _unfold(text: str) -> list[str]:
    """iCalendar/vCard lines can wrap: a line starting with a space continues the previous one."""
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def _date(value: str) -> tuple[int | None, int | None, int | None]:
    """'19950314', '1995-03-14', '--0314', '--03-14' -> (year, month, day)."""
    v = value.strip().split("T")[0]
    m = re.fullmatch(r"(\d{4}|--)-?(\d{2})-?(\d{2})", v)
    if not m:
        return None, None, None
    year = int(m[1]) if m[1] != "--" else None
    if year in (1604, 1900):  # Apple/Google placeholder years for "no year"
        year = None
    return year, int(m[2]), int(m[3])


def _name_from_title(title: str) -> str:
    name = re.sub(r"\s+", " ", NOISE.sub(" ", title)).strip(" ,.&")
    return name.title() if name.islower() else name


def parse_ics(text: str) -> list[ParsedPerson]:
    out: list[ParsedPerson] = []
    event: dict[str, str] = {}
    for line in _unfold(text):
        if line.startswith("BEGIN:VEVENT"):
            event = {}
        elif line.startswith("END:VEVENT"):
            title = event.get("SUMMARY", "")
            occasion = next((o for o, rx in OCCASION_WORDS if rx.search(title)), None)
            _, month, day = _date(event.get("DTSTART", ""))
            name = _name_from_title(title)
            if occasion and month and name:
                out.append(ParsedPerson(
                    name_as_written=title, display_name=name,
                    dates=[ImportantDate(occasion=occasion, month=month, day=day, source_text=title)],
                ))
        elif ":" in line:
            key, _, value = line.partition(":")
            event[key.split(";")[0].upper()] = value.replace("\\,", ",").strip()
    return out


def parse_vcf(text: str) -> list[ParsedPerson]:
    out: list[ParsedPerson] = []
    card: dict[str, str] = {}
    for line in _unfold(text):
        if line.upper().startswith("BEGIN:VCARD"):
            card = {}
        elif line.upper().startswith("END:VCARD"):
            name = card.get("FN") or " ".join(reversed([p for p in card.get("N", "").split(";")[:2] if p]))
            dates = []
            for field, occasion in (("BDAY", "birthday"), ("ANNIVERSARY", "anniversary")):
                _, month, day = _date(card.get(field, ""))
                if month:
                    dates.append(ImportantDate(occasion=occasion, month=month, day=day, source_text=f"{field} in contacts"))
            if name and dates:
                out.append(ParsedPerson(name_as_written=name, display_name=name.strip(), dates=dates))
        elif ":" in line:
            key, _, value = line.partition(":")
            key = key.split(";")[0].upper()
            key = key.split(".")[-1]  # Apple writes "item1.X-ABDATE"
            if key == "X-ANNIVERSARY":
                key = "ANNIVERSARY"
            card.setdefault(key, value.strip())
    return out


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", s.lower()).strip()


def match_people(found: list[ParsedPerson], saved: list[Person]) -> list[ParsedPerson]:
    """Suggest a saved person for each entry: full-name match, else unique first-name match."""
    for p in found:
        n = _norm(p.display_name)
        exact = [s for s in saved if _norm(s.name) == n]
        first = [s for s in saved if _norm(s.name).split(" ")[0] == n.split(" ")[0]] if n else []
        hit = exact or (first if len(first) == 1 else [])
        if hit:
            p.match_id, p.match_confidence = hit[0].id, "high" if exact else "low"
    return found


def parse_file(filename: str, text: str, saved: list[Person]) -> list[ParsedPerson]:
    if filename.lower().endswith(".vcf") or "BEGIN:VCARD" in text[:2000].upper():
        found = parse_vcf(text)
    else:
        found = parse_ics(text)
    # one row per person: merge duplicate names (e.g. a recurring event exported twice)
    merged: dict[str, ParsedPerson] = {}
    for p in found:
        key = _norm(p.display_name)
        if key in merged:
            have = {d.occasion for d in merged[key].dates}
            merged[key].dates += [d for d in p.dates if d.occasion not in have]
        else:
            merged[key] = p
    return match_people(list(merged.values()), saved)
