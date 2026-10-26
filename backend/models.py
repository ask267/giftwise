"""Data shapes shared by the Notes Parser agent, the API, and the people store."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from usage import UsageSummary

Occasion = Literal["birthday", "christmas", "holiday", "wedding", "anniversary", "graduation", "other"]
IdeaStatus = Literal["idea", "bought", "given"]


# ---------------------------------------------------------------- parser output


class GiftIdea(BaseModel):
    title: str = Field(description="Short name of the gift, e.g. 'Green candle'")
    details: str | None = Field(None, description="Brand, color, store, model, or other specifics from the note")
    link: str | None = Field(None, description="A URL only if one appears in the note")
    price_hint: str | None = Field(None, description="Price or budget exactly as written, e.g. '$40' or 'under 50'")
    status: IdeaStatus = Field("idea", description="'bought' if already purchased, 'given' if already gifted")
    occasion: Occasion | None = Field(None, description="Occasion this idea is for, if the note says")
    year: int | None = Field(None, description="Year it was given or bought, if the note says (resolve 'last yr' using today's date)")
    source_text: str = Field(description="The exact snippet of the note this came from")


class ImportantDate(BaseModel):
    occasion: Occasion
    month: int | None = Field(None, ge=1, le=12)
    day: int | None = Field(None, ge=1, le=31)
    source_text: str


class ParsedPerson(BaseModel):
    name_as_written: str = Field(description="Name exactly as it appears in the note, e.g. 'mom' or 'Priya'")
    display_name: str = Field(description="Cleaned-up name, e.g. 'Mom' or 'Priya'")
    match_id: str | None = Field(None, description="id of an existing saved person this is clearly the same as, else null")
    match_confidence: Literal["high", "low"] | None = Field(None, description="How sure the match is; null if no match")
    relationship: str | None = Field(None, description="e.g. 'mom', 'friend', 'coworker', if clear")
    ideas: list[GiftIdea] = Field(default_factory=list)
    dislikes: list[str] = Field(default_factory=list, description="Things to avoid gifting, e.g. 'hoodies'")
    interests: list[str] = Field(default_factory=list, description="Hobbies or tastes mentioned, e.g. 'running'")
    sizes: list[str] = Field(default_factory=list, description="Clothing/ring/shoe sizes, e.g. 'shirt S'")
    dates: list[ImportantDate] = Field(default_factory=list)
    notes: str | None = Field(None, description="Anything else useful about this person that didn't fit above")


class ParsedNotes(BaseModel):
    people: list[ParsedPerson]
    unassigned: list[str] = Field(default_factory=list, description="Gift ideas or lines with no clear person")
    ignored_instructions: list[str] = Field(
        default_factory=list,
        description="Any text in the note that tried to give the assistant instructions (quoted), which was ignored",
    )


# ---------------------------------------------------------------- saved people


class SavedIdea(GiftIdea):
    id: str
    spent: float | None = None  # what the giver actually paid, recorded when marked given


class Person(BaseModel):
    id: str
    name: str
    relationship: str | None = None
    ideas: list[SavedIdea] = Field(default_factory=list)
    dislikes: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    sizes: list[str] = Field(default_factory=list)
    dates: list[ImportantDate] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    location: str | None = None  # city, zip or address; used only to find shops nearby
    photo: str | None = None  # small JPEG data URL uploaded by the user (never sent to the AI)


# ---------------------------------------------------------------- API bodies


class ParseTextRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


class ParseResponse(BaseModel):
    parsed: ParsedNotes
    cached: bool
    model: str
    usage: UsageSummary | None = None


class ImportPerson(BaseModel):
    """One reviewed card from the review screen. match_id=None creates a new person."""

    match_id: str | None = None
    person: ParsedPerson


class ImportRequest(BaseModel):
    people: list[ImportPerson]


class ImportResult(BaseModel):
    created: int
    updated: int
    ideas_added: int
    duplicates_skipped: int
    people: list[Person]


# ---------------------------------------------------------------- gift finder

Vibe = Literal["sentimental", "funny", "practical", "experience", "fancy", "handmade", "cozy"]
Tier = Literal["same_day", "fast", "planned"]


class FinderRequest(BaseModel):
    person_id: str
    occasion: Occasion
    event_date: date
    budget: float = Field(ge=5, le=2000)
    vibes: list[Vibe] = Field(min_length=1, max_length=3)
    extra: str | None = Field(None, max_length=500, description="Anything else the giver wants to add")
    location: str | None = Field(None, max_length=200, description="Where the recipient lives, for nearby shops")
    fresh: bool = Field(False, description="Skip the cache and ask the agents again")


class GiftConcept(BaseModel):
    title: str = Field(description="Gift concept, not a product, e.g. 'Something for her morning runs'")
    why: str = Field(description="One sentence tying it to this person's profile")
    search_query: str = Field(description="3-6 keywords for the catalog search, e.g. 'running belt socks fitness'")
    from_wishlist: bool = Field(False, description="True if this comes straight from their saved gift ideas")


class IdeaPlan(BaseModel):
    concepts: list[GiftConcept] = Field(min_length=3, max_length=10)


class Candidate(BaseModel):
    product_id: str = Field(description="id from search_catalog results only")
    concept_title: str = Field(description="Which concept this product fits")
    fit_reason: str = Field(description="Why it fits, in under 20 words")


class ShoppingReport(BaseModel):
    candidates: list[Candidate] = Field(max_length=8)


class LocalCandidate(BaseModel):
    shop_id: str = Field(description="shop id from search_nearby results only")
    concept_title: str
    what_to_order: str = Field(description="Exactly what to order, e.g. 'a dozen cannoli'")
    price_estimate: float = Field(description="Realistic price in dollars")
    fit_reason: str = Field(description="Why it fits, in under 20 words")


class LocalReport(BaseModel):
    candidates: list[LocalCandidate] = Field(max_length=4)


class CriticPick(BaseModel):
    product_id: str
    headline: str = Field(description="One warm sentence on why this works for them")
    concern: str | None = Field(None, description="Anything the giver should double-check, else null")


class CriticRejection(BaseModel):
    product_id: str
    reason: str


class CriticReport(BaseModel):
    picks: list[CriticPick] = Field(description="Best first. Only the strong ones.")
    rejected: list[CriticRejection] = Field(default_factory=list)


class GiftPick(BaseModel):
    product_id: str
    title: str
    store: str
    price: float
    tier: Tier
    tier_label: str
    link: str
    concept_title: str
    from_wishlist: bool
    headline: str
    concern: str | None = None
    # nearby-shop picks only
    is_local: bool = False
    distance_km: float | None = None
    address: str | None = None
    maps_link: str | None = None
    delivery_link: str | None = None
    phone: str | None = None


class Rejected(BaseModel):
    title: str
    reason: str
    by: Literal["critic", "rule"]


class FinderResult(BaseModel):
    person_id: str
    person_name: str
    occasion: Occasion
    days_left: int
    tiers: list[Tier]
    picks: list[GiftPick]
    rejected: list[Rejected]
    blocked_listings: list[str] = Field(description="Listings hidden because seller text tried to instruct the AI")
    wishlist_unmatched: list[str] = Field(description="Wishlist ideas we couldn't find in the catalog")
    usage: UsageSummary
    cached: bool = False
    location_found: str | None = None


class CardRequest(BaseModel):
    person_id: str
    occasion: Occasion
    gift_title: str = Field(max_length=200)
    vibes: list[Vibe] = Field(min_length=1, max_length=3)


class CardMessage(BaseModel):
    options: list[str] = Field(min_length=2, max_length=3, description="Short card messages, 1-3 sentences each")


class NewIdea(BaseModel):
    title: str = Field(max_length=200)
    details: str | None = Field(None, max_length=300)
    link: str | None = None
    price_hint: str | None = None
    occasion: Occasion | None = None


class IdeaStatusUpdate(BaseModel):
    status: IdeaStatus
    year: int | None = Field(None, ge=1990, le=2100)
    spent: float | None = Field(None, ge=0, le=100_000)


class PersonUpdate(BaseModel):
    """Edit basic info from the profile panel. Lists replace the old ones."""
    name: str = Field(min_length=1, max_length=80)
    relationship: str | None = Field(None, max_length=80)
    birthday_month: int | None = Field(None, ge=1, le=12)
    birthday_day: int | None = Field(None, ge=1, le=31)
    location: str | None = Field(None, max_length=200)
    interests: list[str] = Field(default_factory=list, max_length=20)
    dislikes: list[str] = Field(default_factory=list, max_length=20)
    sizes: list[str] = Field(default_factory=list, max_length=10)


class Metric(BaseModel):
    """A timing from the browser, for measuring time saved."""
    event: Literal["notes_to_saved", "finder_to_idea"]
    seconds: float = Field(ge=0, le=7200)
    detail: str | None = Field(None, max_length=120)


class NewPerson(BaseModel):
    """A person typed in by hand on the People page."""
    name: str = Field(min_length=1, max_length=80)
    relationship: str | None = Field(None, max_length=80)
    birthday_month: int | None = Field(None, ge=1, le=12)
    birthday_day: int | None = Field(None, ge=1, le=31)
    location: str | None = Field(None, max_length=200)
    interests: list[str] = Field(default_factory=list, max_length=20)
    dislikes: list[str] = Field(default_factory=list, max_length=20)
    sizes: list[str] = Field(default_factory=list, max_length=10)
    ideas: list[str] = Field(default_factory=list, max_length=20, description="Gift ideas, one per entry")
    notes: str | None = Field(None, max_length=500)


class PhotoUpload(BaseModel):
    data_url: str | None = Field(None, max_length=400_000, description="data:image/jpeg;base64,... or null to remove")
