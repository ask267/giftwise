"""Gift-finder agent team.

    orchestrator (this file, plain code)
      1. days left -> which delivery tiers are still possible
      2. Idea agent        profile + vibes -> gift concepts (no products)
      3. Shopping agents   one per possible tier, run in parallel, each with a
                           search_catalog tool locked to its tier and budget
      4. house rules       code removes over-budget items, dislikes, repeats
      5. Critic agent      ranks what's left, cuts weak picks, explains why
    Message agent (separate call): writes card notes for a chosen gift.

The orchestrator is code, not an LLM, so the order of steps, the budget and
the delivery rules can't be talked out of by any model output.

Safety: seller listings whose text tries to instruct an AI are hidden from the
agents and reported. Agents can only return ids that the tool really showed
them; anything else is dropped. No agent can buy, save or send anything.

Caching: a finished run is stored by (request, profile, today). Asking again
replays it instantly unless the user asks for fresh ideas.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic_ai import Agent, RunContext, UsageLimits
from pydantic_ai.exceptions import ModelHTTPError

import catalog
import local_shops
import usage as usage_mod
from llm import MODEL_NAME, build_model
from models import Candidate as ShoppingCandidate
from models import (
    CardMessage, CardRequest, CriticReport, FinderRequest, FinderResult, GiftPick, IdeaPlan, LocalReport, Person,
    Rejected, ShoppingReport,
)
from safety import BlockedBySafetyFilter
from usage import UsageSummary

HERE = Path(__file__).resolve().parent
PROMPTS = HERE / "prompts"
CACHE_FILE = HERE.parent / "data" / "finder_cache.json"

PICKS_PER_TIER = 3
SHOPPER_LIMITS = UsageLimits(request_limit=8, tool_calls_limit=12)
AGENT_LIMITS = UsageLimits(request_limit=4)


def _prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text()


PROMPT_VERSION = hashlib.sha256("".join(_prompt(n) for n in ("idea", "shopping", "critic", "nearby")).encode()).hexdigest()[:8]
NEARBY = "Shopping · Nearby"
ShopKind = Literal["bakery", "flowers", "chocolate", "cafe", "ice_cream", "gift_shop", "bookstore"]


# ---------------------------------------------------------------- agents


@dataclass
class ShopperDeps:
    tier: str
    budget: float
    seen: dict[str, catalog.Product] = field(default_factory=dict)  # every product the tool showed
    blocked: set[str] = field(default_factory=set)                   # flagged listings it hid


@dataclass
class NearbyDeps:
    lat: float
    lon: float
    budget: float
    seen: dict[str, local_shops.Shop] = field(default_factory=dict)


_agents: dict[str, Agent] = {}


def _agent(name: str) -> Agent:
    if name in _agents:
        return _agents[name]
    model = build_model()
    if name == "idea":
        a = Agent(model, output_type=IdeaPlan, instructions=_prompt("idea"), retries=2)
    elif name == "critic":
        a = Agent(model, output_type=CriticReport, instructions=_prompt("critic"), retries=2)
    elif name == "message":
        a = Agent(model, output_type=CardMessage, instructions=_prompt("message"), retries=2)
    elif name == "nearby":
        a = Agent(model, output_type=LocalReport, deps_type=NearbyDeps, instructions=_prompt("nearby"), retries=2)

        @a.instructions
        def _budget(ctx: RunContext[NearbyDeps]) -> str:
            return f"## Budget\n- Max price: ${ctx.deps.budget:.0f}"

        @a.tool
        async def search_nearby(ctx: RunContext[NearbyDeps], kind: ShopKind) -> list[dict]:
            """Real shops of this kind within about 5 km of the recipient, closest first."""
            shops = await local_shops.nearby(kind, ctx.deps.lat, ctx.deps.lon)
            for sh in shops:
                ctx.deps.seen[sh.id] = sh
            return [{"shop_id": sh.id, "name": sh.name, "km_away": sh.distance_km, "address": sh.address,
                     "has_website": bool(sh.website), "has_phone": bool(sh.phone), "hours": sh.opening_hours}
                    for sh in shops]
    else:
        a = Agent(model, output_type=ShoppingReport, deps_type=ShopperDeps, instructions=_prompt("shopping"), retries=2)

        @a.instructions
        def _tier(ctx: RunContext[ShopperDeps]) -> str:
            return (
                f"## Your tier\n- Delivery: **{catalog.TIER_LABEL[ctx.deps.tier]}** ({ctx.deps.tier})\n"
                f"- Max price: ${ctx.deps.budget:.0f}"
            )

        @a.tool
        def search_catalog(ctx: RunContext[ShopperDeps], query: str) -> list[dict]:
            """Search gift products in your delivery tier and budget. `query` is a few keywords."""
            results = catalog.search(query, ctx.deps.tier, ctx.deps.budget, limit=8)
            out = []
            for p in results:
                if p.seller_text_flagged:  # never show the agents a listing that tried to instruct them
                    ctx.deps.blocked.add(p.id)
                    continue
                ctx.deps.seen[p.id] = p
                out.append({"id": p.id, "title": p.title, "store": p.store, "price": p.price,
                            "tags": p.tags, "vibes": p.vibes, "listing": f"<seller_listing>{p.description}</seller_listing>"})
            return out

    _agents[name] = a
    return a


async def _run(name: str, prompt: str, usage: UsageSummary, label: str, **kw):
    try:
        result = await _agent(name).run(prompt, usage_limits=kw.pop("limits", AGENT_LIMITS), **kw)
    except ModelHTTPError as e:
        if "content_filter" in str(e.body) or "content management policy" in str(e.body):
            raise BlockedBySafetyFilter() from e
        raise
    usage.add(label, result.usage() if callable(result.usage) else result.usage)
    return result.output


# ---------------------------------------------------------------- helpers


def _stem(s: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 2}


def _head(title: str) -> str:
    words = re.findall(r"[a-z]+", re.sub(r"\(.*?\)", "", title.lower()))
    return words[-1].rstrip("s") if words else ""


SIMILAR = {"hoodie": {"sweatshirt", "hoody", "pullover"}, "candle": {"wax"}, "mug": {"cup"}, "perfume": {"fragrance", "cologne"}}


def _profile(p: Person) -> str:
    open_ideas = [i for i in p.ideas if i.status == "idea"]
    history = [i for i in p.ideas if i.status != "idea"]
    lines = [f"Name: {p.name}", f"Relationship: {p.relationship or 'unknown'}"]
    if p.interests: lines.append(f"Interests: {', '.join(p.interests)}")
    if p.sizes: lines.append(f"Sizes: {', '.join(p.sizes)}")
    if p.dislikes: lines.append(f"DISLIKES (never gift): {', '.join(p.dislikes)}")
    if open_ideas:
        lines.append("Saved wishlist ideas:\n" + "\n".join(
            f"- {i.title}" + (f" ({i.details})" if i.details else "") + (f" [{i.price_hint}]" if i.price_hint else "")
            for i in open_ideas))
    if history:
        lines.append("Already given/bought (don't repeat):\n" + "\n".join(
            f"- {i.title} ({i.status}{' ' + str(i.year) if i.year else ''})" for i in history))
    if p.notes: lines.append(f"Notes: {' '.join(p.notes)}")
    return "<profile>\n" + "\n".join(lines) + "\n</profile>"


def _rule_check(prod: catalog.Product, person: Person, budget: float) -> str | None:
    """House rules the Critic can't override. Returns a rejection reason or None."""
    if prod.price > budget:
        return f"${prod.price:.0f} is over the ${budget:.0f} budget"
    words = _stem(f"{prod.title} {' '.join(prod.tags)}")
    for d in person.dislikes:
        bad = _stem(d)
        for w in list(bad):
            bad |= SIMILAR.get(w, set())
        if words & bad:
            return f"matches a dislike ({d})"
    for i in person.ideas:
        # Same gift = every word of the past gift appears AND the main noun matches
        # ("golf balls" repeats "Premium golf balls", but not "golf ball markers").
        past = _stem(i.title)
        if i.status != "idea" and past and past <= _stem(prod.title) and _head(i.title) == _head(prod.title):
            return f"repeats a past gift ({i.title}, {i.status})"
    return None


def _cache_key(req: FinderRequest, person: Person) -> str:
    payload = req.model_dump(mode="json", exclude={"fresh"}) | {"profile": person.model_dump(mode="json", exclude={"photo"})}
    raw = json.dumps(payload, sort_keys=True) + PROMPT_VERSION + MODEL_NAME + date.today().isoformat()
    return hashlib.sha256(raw.encode()).hexdigest()


def _load_cache() -> dict:
    try:
        return json.loads(CACHE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_cache(key: str, result: FinderResult) -> None:
    cache = _load_cache()
    cache[key] = result.model_dump(mode="json")
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, indent=1))


def _event(agent: str, status: str, detail: str = "") -> dict:
    return {"type": "agent", "agent": agent, "status": status, "detail": detail}


# ---------------------------------------------------------------- the run


async def run_finder(req: FinderRequest, person: Person) -> AsyncIterator[dict]:
    """Yields progress events, then {'type': 'result', 'result': FinderResult}."""
    days_left = (req.event_date - date.today()).days
    if days_left < 0:
        yield {"type": "error", "message": "That date has already passed."}
        return
    tiers = catalog.feasible_tiers(days_left)
    key = _cache_key(req, person)

    if not req.fresh and (hit := _load_cache().get(key)):
        result = FinderResult.model_validate(hit)
        result.cached = True
        for name in ["Idea", *(f"Shopping · {catalog.TIER_LABEL[t]}" for t in tiers), *([NEARBY] if req.location else []), "Critic"]:
            yield _event(name, "done", "from cache")
        yield {"type": "result", "result": result.model_dump(mode="json")}
        return

    usage_mod.check_cap()  # cached runs above stay free; new AI work respects the daily cap
    usage = UsageSummary()
    profile = _profile(person)
    brief = (
        f"{profile}\nOccasion: {req.occasion}\nEvent date: {req.event_date} ({days_left} days from today, {date.today()})\n"
        f"Budget: up to ${req.budget:.0f}\nVibes the giver wants: {', '.join(req.vibes)}\n"
        f"Giver's extra comments: {req.extra or 'none'}"
    )

    # 1. Idea agent ---------------------------------------------------------
    yield _event("Idea", "working", "brainstorming concepts from the profile")
    plan: IdeaPlan = await _run("idea", brief, usage, "Idea")
    yield _event("Idea", "done", f"{len(plan.concepts)} concepts: " + "; ".join(c.title for c in plan.concepts[:4]) + ("…" if len(plan.concepts) > 4 else ""))

    # 2. Shopping agents, one per tier, in parallel ------------------------------
    concepts_txt = "\n".join(
        f"- {c.title} — {c.why} [search: {c.search_query}]{' (FROM WISHLIST)' if c.from_wishlist else ''}"
        for c in plan.concepts
    )
    for t in ("same_day", "fast", "planned"):
        name = f"Shopping · {catalog.TIER_LABEL[t]}"
        if t in tiers:
            yield _event(name, "working", "searching the catalog")
        else:
            yield _event(name, "skipped", f"needs {catalog.TIER_MIN_DAYS[t]}+ days, you have {days_left}")

    deps = {t: ShopperDeps(tier=t, budget=req.budget) for t in tiers}
    shop_prompt = f"{profile}\nOccasion: {req.occasion}\nGift concepts:\n{concepts_txt}"
    async def shop(t: str):
        try:
            return t, await _run("shopping", shop_prompt, usage, f"Shopping · {catalog.TIER_LABEL[t]}", deps=deps[t], limits=SHOPPER_LIMITS), None
        except Exception as e:  # one shopper failing shouldn't sink the run
            return t, None, e

    nearby_deps: NearbyDeps | None = None
    location_found: str | None = None

    async def nearby():
        nonlocal nearby_deps, location_found
        try:
            lat, lon, location_found = await local_shops.geocode(req.location)
            nearby_deps = NearbyDeps(lat=lat, lon=lon, budget=req.budget)
            return "nearby", await _run("nearby", shop_prompt, usage, NEARBY, deps=nearby_deps, limits=SHOPPER_LIMITS), None
        except Exception as e:
            return "nearby", None, e

    jobs = [shop(t) for t in tiers]
    if req.location:
        yield _event(NEARBY, "working", f"looking for shops near {req.location}")
        jobs.append(nearby())
    else:
        yield _event(NEARBY, "skipped", "add where they live to find local bakeries and florists")

    reports: dict[str, ShoppingReport] = {}
    local_report: LocalReport | None = None
    for fut in asyncio.as_completed(jobs):
        t, report, err = await fut
        if t == "nearby":
            if err is not None:
                msg = ("couldn't find that location" if isinstance(err, local_shops.LocationNotFound)
                       else "map service unavailable right now" if not isinstance(err, BlockedBySafetyFilter)
                       else "blocked by the AI provider's safety filter")
                yield _event(NEARBY, "error", msg)
            else:
                local_report = report
                n = sum(c.shop_id in nearby_deps.seen for c in report.candidates)
                yield _event(NEARBY, "done", f"{n} local shop{'' if n == 1 else 's'} · {len(nearby_deps.seen)} looked at")
            continue
        name = f"Shopping · {catalog.TIER_LABEL[t]}"
        if err is not None:
            msg = "blocked by the AI provider's safety filter" if isinstance(err, BlockedBySafetyFilter) else str(err)[:120]
            yield _event(name, "error", msg)
            continue
        reports[t] = report
        found = [c for c in report.candidates if c.product_id in deps[t].seen]
        yield _event(name, "done", f"{len(found)} candidate{'' if len(found) == 1 else 's'}" + (
            f" · hid {len(deps[t].blocked)} suspicious listing" if deps[t].blocked else ""))

    # 3. House rules ----------------------------------------------------------
    rejected: list[Rejected] = []
    pool: dict[str, tuple[str, object]] = {}  # product_id -> (tier, Candidate); fastest tier wins
    concept_by_title = {c.title: c for c in plan.concepts}
    lookup: dict[str, catalog.Product] = dict(catalog.CATALOG)  # plus this run's nearby shops
    shops: dict[str, local_shops.Shop] = {}
    for lc in (local_report.candidates if local_report else []):
        sh = nearby_deps.seen.get(lc.shop_id)
        if sh is None or lc.shop_id in pool:
            continue  # invented id
        prod = catalog.Product(
            id=sh.id, title=f"{lc.what_to_order[0].upper()}{lc.what_to_order[1:]} from {sh.name}", store=sh.name,
            price=lc.price_estimate, tiers=["same_day"], vibes=[], tags=[sh.kind], description=sh.address,
        )
        if reason := _rule_check(prod, person, req.budget):
            rejected.append(Rejected(title=prod.title, reason=reason, by="rule"))
            continue
        lookup[sh.id], shops[sh.id] = prod, sh
        pool[sh.id] = ("same_day", ShoppingCandidate(product_id=sh.id, concept_title=lc.concept_title, fit_reason=lc.fit_reason))
    for t in ("same_day", "fast", "planned"):
        for cand in reports.get(t, ShoppingReport(candidates=[])).candidates:
            prod = deps[t].seen.get(cand.product_id)
            if prod is None or cand.product_id in pool:
                continue  # invented id, or already found in a faster tier
            if reason := _rule_check(prod, person, req.budget):
                if not any(r.title == prod.title for r in rejected):
                    rejected.append(Rejected(title=prod.title, reason=reason, by="rule"))
                continue
            pool[cand.product_id] = (t, cand)

    blocked = sorted({catalog.CATALOG[b].title for d in deps.values() for b in d.blocked})

    # 4. Critic ---------------------------------------------------------------
    picks: list[GiftPick] = []
    if pool:
        yield _event("Critic", "working", f"checking {len(pool)} candidates")
        def delivery(pid: str, t: str) -> str:
            if pid in shops:
                return f"Same day from a LOCAL SHOP {shops[pid].distance_km} km from them (price is an estimate; delivery not confirmed)"
            return catalog.TIER_LABEL[t]

        listing = "\n".join(
            f"- id={pid} | {lookup[pid].title} | {lookup[pid].store} | ${lookup[pid].price:.0f} | "
            f"delivery: {delivery(pid, t)} | concept: {c.concept_title} | shopper says: {c.fit_reason}"
            for pid, (t, c) in pool.items()
        )
        report: CriticReport = await _run("critic", f"{brief}\n\nCandidates:\n{listing}", usage, "Critic")
        per_tier: dict[str, int] = {}
        for pk in report.picks:
            if pk.product_id not in pool:
                continue
            t, cand = pool.pop(pk.product_id)
            slot = f"{t}-local" if pk.product_id in shops else t  # local shops get their own slots
            if per_tier.get(slot, 0) >= PICKS_PER_TIER:
                continue
            per_tier[slot] = per_tier.get(slot, 0) + 1
            prod = lookup[pk.product_id]
            concept = concept_by_title.get(cand.concept_title)
            sh = shops.get(prod.id)
            picks.append(GiftPick(
                product_id=prod.id, title=prod.title, store=prod.store, price=prod.price, tier=t,
                tier_label=catalog.TIER_LABEL[t], link=(sh.website or sh.maps_link) if sh else prod.link,
                concept_title=cand.concept_title, from_wishlist=bool(concept and concept.from_wishlist),
                headline=pk.headline, concern=pk.concern,
                **({"is_local": True, "distance_km": sh.distance_km, "address": sh.address, "maps_link": sh.maps_link,
                    "delivery_link": sh.delivery_link, "phone": sh.phone} if sh else {}),
            ))
        for rj in report.rejected:
            if rj.product_id in lookup:
                rejected.append(Rejected(title=lookup[rj.product_id].title, reason=rj.reason, by="critic"))
        yield _event("Critic", "done", f"kept {len(picks)}, cut {sum(r.by == 'critic' for r in rejected)}")
    else:
        yield _event("Critic", "skipped", "no candidates to check")

    picked_concepts = {p.concept_title for p in picks}
    unmatched = [c.title for c in plan.concepts if c.from_wishlist and c.title not in picked_concepts]

    result = FinderResult(
        person_id=person.id, person_name=person.name, occasion=req.occasion, days_left=days_left, tiers=tiers,
        picks=picks, rejected=rejected, blocked_listings=blocked, wishlist_unmatched=unmatched, usage=usage,
        location_found=location_found,
    )
    _save_cache(key, result)
    usage_mod.log_run("finder", usage, person=person.name, days_left=days_left, tiers=tiers, nearby=bool(req.location))
    yield {"type": "result", "result": result.model_dump(mode="json")}


async def write_card(req: CardRequest, person: Person) -> CardMessage:
    usage_mod.check_cap()
    usage = UsageSummary()
    prompt = (
        f"{_profile(person)}\nOccasion: {req.occasion}\nGift: {req.gift_title}\nTones: {', '.join(req.vibes)}"
    )
    try:
        return await _run("message", prompt, usage, "Message")
    finally:
        usage_mod.log_run("card", usage)
