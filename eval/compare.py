"""Giftwise vs. "just ask ChatGPT": same people, same facts, checked by the same code.

Baseline = one plain gpt-6-luna call given the person's full profile, date and
budget (what most people do today). Giftwise = the full agent team. Every
suggestion from both is then checked by code, not by a model:

  dislike   suggests something the person said they don't want
  repeat    suggests a gift they were already given / already bought
  budget    costs more than the budget
  too_late  custom/personalized/handmade item when there are < 10 days left
  no_store  doesn't say a specific store to buy it from
  no_link   no clickable link to order it (Giftwise links every pick to the store's site)

Run from final-project/:  .venv/bin/python eval/compare.py
Writes eval/results.json and eval/results.md. Costs about $0.02.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from pydantic import BaseModel, Field  # noqa: E402
from pydantic_ai import Agent  # noqa: E402

import finder  # noqa: E402
from llm import build_model  # noqa: E402
from models import FinderRequest, ImportantDate, Person, SavedIdea  # noqa: E402
from usage import UsageSummary  # noqa: E402

CUSTOM = re.compile(r"\b(custom|personali[sz]ed|engraved|monogram|handmade|embroidered|bespoke|portrait|made to order)\b", re.I)


def idea(title, status="idea", year=None):
    return SavedIdea(id=title[:8], title=title, status=status, year=year, source_text="eval")


def person(pid, name, rel, interests, dislikes, history, wishlist=(), loc=None):
    return Person(id=pid, name=name, relationship=rel, interests=interests, dislikes=dislikes, location=loc,
                  ideas=[idea(t) for t in wishlist] + [idea(t, s, 2025) for t, s in history],
                  dates=[ImportantDate(occasion="birthday", month=1, day=1, source_text="eval")])


# (person, days until the birthday, budget, vibes)
CASES = [
    (person("e1", "Mom", "mom", ["pottery", "reading"], ["candles"], [("Silk scarf", "given")], ["Cookbook"]), 2, 60, ["sentimental"]),
    (person("e2", "Jake", "roommate", ["basketball", "music"], ["hoodies", "sweatshirts"], [("AirPods", "given")]), 4, 50, ["funny", "practical"]),
    (person("e3", "Priya", "friend", ["running", "matcha"], ["flowers"], [("Water bottle", "given")]), 1, 40, ["practical"]),
    (person("e4", "Dad", "dad", ["golf", "coffee"], ["socks", "ties"], [("Golf balls", "bought")]), 6, 80, ["practical", "fancy"]),
    (person("e5", "Grandma", "grandma", ["gardening", "tea"], ["perfume", "chocolate"], [("Photo book", "given")]), 3, 70, ["sentimental", "cozy"]),
    (person("e6", "Lena", "best friend", ["baking", "art"], ["mugs"], [("Pottery class", "given")]), 20, 60, ["experience", "handmade"]),
]


class BaselineGift(BaseModel):
    title: str
    price_usd: float
    where_to_buy: str = Field(description="Store or website, if you know one; else empty")


class BaselineList(BaseModel):
    gifts: list[BaselineGift] = Field(min_length=3, max_length=6)


def _stems(s: str) -> set[str]:
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 2}


def problems(title: str, price: float | None, store: str | None, p: Person, days: int, budget: float) -> list[str]:
    out = []
    name = re.split(r"\s[—–-]\s|:|;|\(", title)[0]  # item name only, not the model's explanation after a dash
    words = _stems(name)
    for d in p.dislikes:
        bad = _stems(d)
        for w in list(bad):
            bad |= finder.SIMILAR.get(w, set())
        if words & bad:
            out.append("dislike")
            break
    if any(i.status != "idea" and _stems(i.title) and _stems(i.title) <= words for i in p.ideas):
        out.append("repeat")
    if price is not None and price > budget * 1.001:
        out.append("budget")
    if days < 10 and CUSTOM.search(name):
        out.append("too_late")
    if not (store or "").strip():
        out.append("no_store")
    return out


def profile_text(p: Person) -> str:
    gave = ", ".join(f"{i.title} ({i.status} {i.year})" for i in p.ideas if i.status != "idea") or "none"
    wish = ", ".join(i.title for i in p.ideas if i.status == "idea") or "none"
    return (f"{p.name} ({p.relationship}). Likes: {', '.join(p.interests)}. Dislikes: {', '.join(p.dislikes)}. "
            f"Already given: {gave}. Wishlist: {wish}.")


async def baseline(agent: Agent, p: Person, days: int, budget: float, vibes: list[str], usage: UsageSummary):
    prompt = (f"Suggest 5 birthday gift ideas. {profile_text(p)} Their birthday is in {days} days. "
              f"Budget: up to ${budget}. Vibe: {', '.join(vibes)}.")
    r = await agent.run(prompt)
    usage.add("Baseline (plain gpt-6-luna)", r.usage() if callable(r.usage) else r.usage)
    return [(g.title, g.price_usd, g.where_to_buy) for g in r.output.gifts]


async def giftwise(p: Person, days: int, budget: float, vibes: list[str]):
    req = FinderRequest(person_id=p.id, occasion="birthday", event_date=date.today() + timedelta(days=days),
                        budget=budget, vibes=vibes, fresh=True)
    async for ev in finder.run_finder(req, p):
        if ev["type"] == "result":
            r = ev["result"]
            return [(x["title"], x["price"], x["store"]) for x in r["picks"]], r["usage"]
        if ev["type"] == "error":
            raise RuntimeError(ev["message"])
    return [], {}


async def main():
    agent = Agent(build_model(), output_type=BaselineList,
                  instructions="You are a helpful assistant that suggests gifts.")
    base_usage = UsageSummary()
    sem = asyncio.Semaphore(3)

    async def one(case):
        p, days, budget, vibes = case
        async with sem:
            b, (g, g_usage) = await asyncio.gather(baseline(agent, p, days, budget, vibes, base_usage), giftwise(p, days, budget, vibes))
        return {
            "person": p.name, "days_left": days, "budget": budget, "dislikes": p.dislikes,
            "baseline": [{"title": t, "price": pr, "store": st, "link": False, "problems": problems(t, pr, st, p, days, budget)} for t, pr, st in b],
            "giftwise": [{"title": t, "price": pr, "store": st, "link": True, "problems": problems(t, pr, st, p, days, budget)} for t, pr, st in g],
            "giftwise_cost": g_usage.get("cost_usd", 0),
        }

    results = await asyncio.gather(*(one(c) for c in CASES))
    kinds = ["dislike", "repeat", "budget", "too_late", "no_store"]

    def tally(side):
        items = [s for r in results for s in r[side]]
        bad = [s for s in items if s["problems"]]
        return {"suggestions": len(items), "with_any_problem": len(bad), "with_link": sum(s["link"] for s in items),
                **{k: sum(k in s["problems"] for s in items) for k in kinds}}

    summary = {"baseline": tally("baseline"), "giftwise": tally("giftwise"),
               "baseline_cost_usd": round(base_usage.cost_usd, 5),
               "giftwise_cost_usd": round(sum(r["giftwise_cost"] for r in results), 5)}
    out = ROOT / "eval"
    (out / "results.json").write_text(json.dumps({"date": date.today().isoformat(), "summary": summary, "cases": results}, indent=1))

    b, g = summary["baseline"], summary["giftwise"]
    lines = [
        "# Giftwise vs. plain gpt-6-luna (\"just ask ChatGPT\")", "",
        f"Run {date.today()}. {len(CASES)} test people, same profile, date and budget given to both. Checked by code (`eval/compare.py`).", "",
        "| Check | Plain gpt-6-luna | Giftwise |", "|---|---|---|",
        f"| Suggestions | {b['suggestions']} | {g['suggestions']} |",
        f"| **With any problem** | **{b['with_any_problem']}** | **{g['with_any_problem']}** |",
        f"| Suggests something they dislike | {b['dislike']} | {g['dislike']} |",
        f"| Repeats a past gift | {b['repeat']} | {g['repeat']} |",
        f"| Over budget | {b['budget']} | {g['budget']} |",
        f"| Custom/handmade with < 10 days left | {b['too_late']} | {g['too_late']} |",
        f"| No specific store to buy from | {b['no_store']} | {g['no_store']} |",
        f"| Comes with a link to order it | {b['with_link']} | {g['with_link']} |",
        f"| Cost of all {len(CASES)} runs | ${summary['baseline_cost_usd']:.4f} | ${summary['giftwise_cost_usd']:.4f} |", "",
        "## Every flagged suggestion", "",
    ]
    for r in results:
        for side, label in (("baseline", "Plain"), ("giftwise", "Giftwise")):
            for s in r[side]:
                if s["problems"]:
                    lines.append(f"- **{label}** · {r['person']} ({r['days_left']} days, ${r['budget']}, dislikes {', '.join(r['dislikes'])}): "
                                 f"\"{s['title']}\" ${s['price']} → {', '.join(s['problems'])}")
    lines += ["", "## Reading this honestly", "",
              "- The baseline was given the person's full profile (likes, dislikes, past gifts, wishlist) typed out in the prompt. "
              "With everything spelled out, a modern model mostly respects it; Giftwise's edge is that it **remembers** all of this "
              "(no retyping), checks dislikes/repeats/budget **in code**, only searches delivery windows that can still arrive, "
              "and links every pick to a real store or a real nearby shop.",
              "- `too_late` is a keyword check (custom, personalized, handmade, engraved...) with under 10 days left; a handmade item bought in person could still work.",
              "- Model output varies run to run; this is one run of 6 cases, not a statistical study.",
              f"- Giftwise costs more per search (several agents) but both are fractions of a cent."]
    (out / "results.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    asyncio.run(main())
