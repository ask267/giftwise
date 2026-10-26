"""Where "Shop →" goes for each store: that store's own website, so the giver
can order there. Big stores open their own search results for the item; small
brands open their search page or shop page. Exact product URLs aren't used
because they change often and a stale one is a dead end.

Every template was checked with a live request (see check_links()). Some big
stores (Amazon, Etsy, REI...) refuse automated checks with 403/429/503 but open
normally in a browser; links that returned 404 were replaced.
"""

from __future__ import annotations

import re
from urllib.parse import quote_plus

# {q} = the product title, URL-encoded. No {q} = a fixed page.
STORE_LINKS: dict[str, str] = {
    "Amazon": "https://www.amazon.com/s?k={q}",
    "Target": "https://www.target.com/s?searchTerm={q}",
    "Etsy": "https://www.etsy.com/search?q={q}",
    "REI": "https://www.rei.com/search?q={q}",
    "Sephora": "https://www.sephora.com/search?keyword={q}",
    "Best Buy": "https://www.bestbuy.com/site/searchpage.jsp?st={q}",
    "Barnes & Noble": "https://www.barnesandnoble.com/",
    "Nordstrom": "https://www.nordstrom.com/sr?keyword={q}",
    "Urban Outfitters": "https://www.urbanoutfitters.com/search?q={q}",
    "Anthropologie": "https://www.anthropologie.com/search?q={q}",
    "Williams Sonoma": "https://www.williams-sonoma.com/search/results.html?words={q}",
    "Sur La Table": "https://www.surlatable.com/search?q={q}",
    "Dick's Sporting Goods": "https://www.dickssportinggoods.com/search/SearchDisplay?searchTerm={q}",
    "Bass Pro Shops": "https://www.basspro.com/shop/SearchDisplay?searchTerm={q}",
    "Fanatics": "https://www.fanatics.com/?query={q}",
    "Nike": "https://www.nike.com/w?q={q}",
    "Lululemon": "https://shop.lululemon.com/search?Ntt={q}",
    "Uncommon Goods": "https://www.uncommongoods.com/search?q={q}",
    "Chewy": "https://www.chewy.com/s?query={q}",
    "Blick": "https://www.dickblick.com/search/?q={q}",
    "Goldbelly": "https://www.goldbelly.com/search?q={q}",
    "Bookshop.org": "https://bookshop.org/search?keywords={q}",
    "Apple Store": "https://www.apple.com/us/search/{q}",
    "Ticketmaster": "https://www.ticketmaster.com/search?q={q}",
    "Instacart": "https://www.instacart.com/store/s?k={q}",
    "DoorDash": "https://www.doordash.com/",
    "Insomnia Cookies": "https://insomniacookies.com/",
    "Murray's Cheese": "https://www.murrayscheese.com/search?q={q}",
    "Compartés": "https://compartes.com/search?q={q}",
    "Heatonist": "https://heatonist.com/search?q={q}",
    "Trade Coffee": "https://www.drinktrade.com/gift",
    "Blue Bottle": "https://bluebottlecoffee.com/us/eng/search?q={q}",
    "Ippodo Tea": "https://global.ippodo-tea.co.jp/search?q={q}",
    "Harney & Sons": "https://www.harney.com/search?q={q}",
    "Slip": "https://www.slip.com/search?q={q}",
    "The Sill": "https://www.thesill.com/search?q={q}",
    "Artifact Uprising": "https://www.artifactuprising.com/",
    "Aura": "https://auraframes.com/",
    "Minted": "https://www.minted.com/search?query={q}",
    "Mark & Graham": "https://www.markandgraham.com/search/results.html?words={q}",
    "Spafinder": "https://www.spafinder.com/",
    "ClassPass": "https://classpass.com/gift",
    "MasterClass": "https://www.masterclass.com/gift",
    "Airbnb Experiences": "https://www.airbnb.com/s/experiences",
    "Topgolf": "https://topgolf.com/us/gift-cards/",
    "Fandango": "https://www.fandango.com/",
    "Bombas": "https://bombas.com/search?q={q}",
    "Hydro Flask": "https://www.hydroflask.com/search?q={q}",
    "Leuchtturm1917": "https://www.leuchtturm1917.us/search?q={q}",
    "Baron Fig": "https://baronfig.com/search?q={q}",
    "Book of the Month": "https://www.bookofthemonth.com/gift",
    "Glossier": "https://www.glossier.com/search?q={q}",
    "Quince": "https://www.quince.com/search?q={q}",
    "Mejuri": "https://mejuri.com/search?q={q}",
    "Nintendo": "https://www.nintendo.com/us/store/",
    "Spotify": "https://www.spotify.com/us/premium/",
    "Lodge": "https://www.lodgecastiron.com/search?q={q}",
    "Brightland": "https://brightland.co/search?q={q}",
    "Winc": "https://www.winc.com/",
    "BarkBox": "https://www.barkbox.com/",
    "Zola": "https://www.zola.com/search/registry",
    # "Local ..." stores: a map search for the kind of place, near the giver
    "Local florist": "https://www.google.com/maps/search/florist+near+me",
    "Local studio (ClassPass)": "https://classpass.com/search?q={q}",
    "Local climbing gym": "https://www.google.com/maps/search/climbing+gym+near+me",
}


# Small brand sites match their own product words better than our gift titles.
SEARCH_WORDS: dict[str, str] = {
    "fit-03": "water bottle", "cof-02": "coffee", "tea-01": "matcha", "tea-03": "sampler", "home-03": "pillowcase",
    "bty-04": "scrunchies", "home-07": "snake plant", "book-04": "notebook", "book-05": "notebook",
    "fit-02": "running socks", "bty-02": "set", "bty-05": "scarf", "bty-07": "hoops", "kit-01": "skillet",
    "kit-02": "olive oil", "food-04": "gift", "food-05": "truffles", "food-07": "hot sauce", "per-07": "map",
    "per-09": "passport", "home-01": "candle", "kit-03": "cocktail kit", "home-06": "herb garden",
}


def store_link(store: str, title: str, product_id: str | None = None) -> tuple[str, bool]:
    """(url, is_store_site). Falls back to a Google Shopping search for unknown stores."""
    template = STORE_LINKS.get(store)
    if template is None:
        return f"https://www.google.com/search?tbm=shop&q={quote_plus(f'{title} {store}')}", False
    words = SEARCH_WORDS.get(product_id or "", re.sub(r"\(.*?\)", "", title).strip())
    return template.replace("{q}", quote_plus(words)), True


def check_links() -> list[tuple[str, int | str, str]]:
    """Request every store link once (used to verify the table above)."""
    import ssl
    import urllib.request
    from concurrent.futures import ThreadPoolExecutor

    import certifi

    ctx = ssl.create_default_context(cafile=certifi.where())

    def one(item):
        store, template = item
        url = template.replace("{q}", quote_plus("gift"))
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"})
        try:
            with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
                return store, r.status, url
        except urllib.error.HTTPError as e:
            return store, e.code, url
        except Exception as e:  # noqa: BLE001
            return store, type(e).__name__, url

    with ThreadPoolExecutor(12) as pool:
        return list(pool.map(one, STORE_LINKS.items()))
