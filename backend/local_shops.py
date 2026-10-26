"""Find real shops near the recipient (bakeries, florists, cafés...) for same-day gifts.

Uses OpenStreetMap's free Nominatim service: no API key needed. Their usage
policy asks for at most 1 request per second and a clear User-Agent, so calls
are spaced out and every result is cached on disk.

OpenStreetMap knows a shop exists, not whether it delivers today, so results
come with links (website, Google Maps, delivery-app search) for the giver to check.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

import certifi
from pydantic import BaseModel

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "geo_cache.json"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Giftwise/0.1 (AI Foundations class project; same-day gift finder)"
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())  # works even where Python has no system certs
RADIUS_DEG = 0.05  # ~5 km box around the recipient

# kind the agent asks for -> search words sent to OpenStreetMap
KINDS: dict[str, list[str]] = {
    "bakery": ["bakery", "pastry"],
    "flowers": ["florist"],
    "chocolate": ["chocolate", "confectionery"],
    "cafe": ["cafe"],
    "ice_cream": ["ice cream"],
    "gift_shop": ["gift shop"],
    "bookstore": ["bookshop"],
}


class Shop(BaseModel):
    id: str
    name: str
    kind: str
    distance_km: float
    address: str
    website: str | None = None
    phone: str | None = None
    opening_hours: str | None = None

    @property
    def maps_link(self) -> str:
        return "https://www.google.com/maps/search/?api=1&query=" + urllib.parse.quote_plus(f"{self.name} {self.address}")

    @property
    def delivery_link(self) -> str:
        return "https://www.google.com/search?q=" + urllib.parse.quote_plus(f"{self.name} {self.address} delivery DoorDash Uber Eats")


class LocationNotFound(Exception):
    pass


# ---------------------------------------------------------------- HTTP + cache

_lock = asyncio.Lock()
_last_call = 0.0


def _load() -> dict:
    try:
        return json.loads(CACHE_FILE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _store(key: str, value) -> None:
    cache = _load()
    cache[key] = value
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache))


def _get(params: dict) -> list[dict]:
    url = f"{NOMINATIM}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15, context=SSL_CONTEXT) as r:
        return json.load(r)


async def _query(params: dict) -> list[dict]:
    key = json.dumps(params, sort_keys=True)
    if (hit := _load().get(key)) is not None:
        return hit
    global _last_call
    async with _lock:  # 1 request/second, per OpenStreetMap's policy
        wait = 1.1 - (time.monotonic() - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            data = await asyncio.to_thread(_get, params)
        finally:
            _last_call = time.monotonic()
    _store(key, data)
    return data


# ---------------------------------------------------------------- public


async def geocode(location: str) -> tuple[float, float, str]:
    """City, zip or street address -> (lat, lon, display name)."""
    loc = location.strip()
    if re.fullmatch(r"\d{5}(-\d{4})?", loc):  # bare US zip: "06511" alone also matches places abroad
        res = await _query({"format": "jsonv2", "limit": 1, "postalcode": loc[:5], "countrycodes": "us"})
    else:
        res = await _query({"format": "jsonv2", "limit": 1, "q": loc})
    if not res:
        raise LocationNotFound(location)
    r = res[0]
    return float(r["lat"]), float(r["lon"]), r.get("display_name", location)


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


def _address(a: dict) -> str:
    street = " ".join(x for x in (a.get("house_number"), a.get("road")) if x)
    town = a.get("city") or a.get("town") or a.get("village") or a.get("suburb") or ""
    return ", ".join(x for x in (street, town) if x)


async def nearby(kind: str, lat: float, lon: float, limit: int = 6) -> list[Shop]:
    shops: dict[str, Shop] = {}
    lat_r, lon_r = round(lat, 3), round(lon, 3)
    for term in KINDS.get(kind, [kind]):
        res = await _query({
            "format": "jsonv2", "limit": 15, "addressdetails": 1, "extratags": 1, "bounded": 1, "q": term,
            "viewbox": f"{lon_r - RADIUS_DEG},{lat_r + RADIUS_DEG},{lon_r + RADIUS_DEG},{lat_r - RADIUS_DEG}",
        })
        for r in res:
            name = r.get("name")
            if not name or r.get("category") not in ("shop", "amenity"):
                continue
            tags = r.get("extratags") or {}
            sid = f"osm-{r.get('osm_type', 'x')[:1]}{r.get('osm_id')}"
            shops[sid] = Shop(
                id=sid, name=name, kind=kind,
                distance_km=round(_km(lat, lon, float(r["lat"]), float(r["lon"])), 1),
                address=_address(r.get("address") or {}),
                website=tags.get("website") or tags.get("contact:website"),
                phone=tags.get("phone") or tags.get("contact:phone"),
                opening_hours=tags.get("opening_hours"),
            )
    return sorted(shops.values(), key=lambda s: s.distance_km)[:limit]
