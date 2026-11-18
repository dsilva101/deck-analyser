#!/usr/bin/env python3
"""Check a text deck list against the January 2027 Standard rotation.

Usage: python3 deck_rotation.py deck.txt
Requires Python 3.9+; internet access is needed for uncached lookups.
Successful lookups are cached beside this script; use --refresh to update them.
Printings released after --as-of (default: today) are excluded.
"""

import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API = "https://api.scryfall.com"
CACHE_PATH = Path(__file__).resolve().with_suffix(".cache.json")
# January 2027 removes the 2023/2024 sets, except Foundations.
# Bonus sheets, promos, Commander sets, etc. do not grant Standard legality.
SURVIVING_FROM = "2025-01-01"
FOUNDATIONS_RELEASE = "2024-11-15"
HEADINGS = re.compile(
    r"^(?:main\s*deck|deck|sideboard|creatures?|instants?|sorceries|"
    r"enchantments?|artifacts?|lands?|planeswalkers?|battles?)"
    r"\s*(?:\(\d+\))?\s*:?$", re.IGNORECASE
)


def read_deck(path):
    """Accept plain names, '4 Name', '4x Name', and Arena export lines."""
    return parse_deck(path.read_text(encoding="utf-8-sig"))


def parse_deck(text):
    """Parse a deck from text, shared by the CLI and browser."""
    cards = {}
    section = "Main"
    for line in text.lstrip("\ufeff").splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "//")):
            continue
        if HEADINGS.fullmatch(line):
            if line.lower().startswith("sideboard"):
                section = "Side"
            elif re.match(r"(?:main\s*deck|deck)\b", line, re.I):
                section = "Main"
            continue
        # Ignore category counts, standalone prices, and copied total lines.
        if re.fullmatch(r"\(\d+\)|[$€£]\s*[\d,.]+", line):
            continue
        if re.fullmatch(r"\d+\s+cards?\s+total", line, re.I):
            continue
        row_section = section
        if re.match(r"SB:\s*", line, re.I):
            row_section = "Side"
            line = re.sub(r"^SB:\s*", "", line, flags=re.I)
        line = re.split(r"\s+[$€£]\s*\d", line, maxsplit=1)[0].strip()
        match = re.match(r"^(\d+)\s*x?\s+(.+)$|^(\d+)x\s*(.+)$", line, re.I)
        if match:
            quantity = int(match.group(1) or match.group(3))
            name = match.group(2) or match.group(4)
        else:
            quantity, name = 1, line
        # Arena: 4 Blooming Marsh (OTJ) 266
        name = re.sub(r"\s+\([A-Za-z0-9]+\)\s+[\w-]+\s*$", "", name).strip()
        key = (row_section, name)
        cards[key] = cards.get(key, 0) + quantity
    return [(section, quantity, name) for (section, name), quantity in cards.items()]


def get_json(url):
    for attempt in range(4):
        # Scryfall requests a 50–100 ms delay between requests.
        time.sleep(0.12)
        request = Request(url, headers={
            "User-Agent": "DeckRotationChecker/1.0",
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code == 404:
                raise ValueError("card not found") from error
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            retry_after = error.headers.get("Retry-After", "")
            delay = float(retry_after) if retry_after.isdigit() else 2 ** (attempt + 1)
            time.sleep(delay)
    raise RuntimeError("Scryfall request failed")


def survives(printing):
    return printing["set"] == "fdn" or (
        printing["set_type"] in ("expansion", "core")
        and printing["released_at"] >= SURVIVING_FROM
    )


def card_lookup(name, as_of):
    """Shared lookup algorithm; yield URLs to the CLI or browser transport."""
    # Exact names also match either face of a double-faced card.
    quoted_name = name.replace("\\", "\\\\").replace('"', '\\"')
    query = f'!"{quoted_name}" game:paper date<={as_of}'
    url = API + "/cards/search?" + urlencode({
        "q": query, "unique": "prints", "order": "released", "dir": "desc",
    })
    latest = None
    survivor = False
    while url:
        result = yield url
        printings = result["data"]
        if latest is None:
            newest_date = printings[0]["released_at"]
            tied = [p for p in printings if p["released_at"] == newest_date]
            latest = min(tied, key=lambda p: (
                p.get("promo", False),
                p.get("variation", False),
                int(re.match(r"\d+", p["collector_number"])[0])
                if re.match(r"\d+", p["collector_number"]) else 999999,
            ))
        survivor = survivor or any(survives(p) for p in printings)
        # All older pages are irrelevant once we pass Foundations' release.
        if survivor or printings[-1]["released_at"] < FOUNDATIONS_RELEASE:
            break
        url = result.get("next_page") if result.get("has_more") else None

    legality = latest.get("legalities", {}).get("standard", "not_legal")
    if legality == "banned":
        status = "No (banned)"
    elif legality != "legal":
        status = "No (not Standard legal)"
    else:
        status = "Yes" if survivor else "No (rotates out)"
    edition = f'{latest["set_name"]} ({latest["set"].upper()} #{latest["collector_number"]})'
    return latest["name"], edition, latest["released_at"], status


def check_card(name, as_of):
    lookup = card_lookup(name, as_of)
    url = next(lookup)
    while True:
        result = get_json(url)
        try:
            url = lookup.send(result)
        except StopIteration as done:
            return done.value


async def check_card_browser(name, as_of, fetch_json):
    """Use browser fetch (CORS), with the exact same rotation logic as the CLI."""
    lookup = card_lookup(name, as_of)
    url = next(lookup)
    while True:
        result = json.loads(await fetch_json(url))
        try:
            url = lookup.send(result)
        except StopIteration as done:
            return done.value


def print_table(rows):
    headers = ("Deck", "Qty", "Card", "Latest paper edition", "Released", "Post rotation")
    all_rows = [headers] + [tuple(map(str, row)) for row in rows]
    widths = [max(len(row[i]) for row in all_rows) for i in range(len(headers))]
    for index, row in enumerate(all_rows):
        print(" | ".join(value.ljust(width) for value, width in zip(row, widths)))
        if index == 0:
            print("-+-".join("-" * width for width in widths))


def load_cache(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != 1:
            raise ValueError("unsupported cache format")
        entries = data.get("entries")
        if not isinstance(entries, dict) or not all(
            isinstance(key, str) and isinstance(value, list)
            and len(value) == 4 and all(isinstance(item, str) for item in value)
            for key, value in entries.items()
        ):
            raise ValueError("invalid cache entries")
        return entries
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeError, ValueError) as error:
        print(f"Warning: cannot read cache {path}: {error}", file=sys.stderr)
        return {}


def save_cache(path, entries):
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=path.name + ".", suffix=".tmp", delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump({"version": 1, "entries": entries}, handle, indent=2,
                      ensure_ascii=False)
            handle.write("\n")
        temporary.replace(path)
    except OSError as error:
        print(f"Warning: cannot save cache {path}: {error}", file=sys.stderr)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", type=Path, help="UTF-8 text deck list")
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today(),
                        help="include released printings through YYYY-MM-DD (default: today)")
    parser.add_argument("--cache", type=Path, default=CACHE_PATH,
                        help="local JSON cache path (default: beside this script)")
    parser.add_argument("--refresh", action="store_true",
                        help="refresh cached cards in this deck from Scryfall")
    args = parser.parse_args()
    try:
        cards = read_deck(args.deck)
    except (OSError, UnicodeError) as error:
        parser.exit(1, f"Cannot read deck: {error}\n")
    if not cards:
        parser.exit(1, "No cards found in the deck file.\n")

    persistent_cache = load_cache(args.cache)
    rows, cache = [], {}
    as_of = args.as_of.isoformat()
    failed = False
    for section, quantity, name in cards:
        normalized = name.casefold()
        key = f"{as_of}\n{normalized}"
        if normalized not in cache:
            if not args.refresh and key in persistent_cache:
                cache[normalized] = persistent_cache[key]
            else:
                print(f"Checking {name}...", file=sys.stderr)
                try:
                    result = check_card(name, as_of)
                    cache[normalized] = result
                    persistent_cache[key] = result
                    persistent_cache[f"{as_of}\n{result[0].casefold()}"] = result
                    save_cache(args.cache, persistent_cache)
                except (HTTPError, URLError, TimeoutError, ValueError, OSError, KeyError) as error:
                    print(f"  {name}: {error}", file=sys.stderr)
                    cache[normalized] = (name, "Lookup failed", "-", "Unknown")
                    failed = True
        rows.append((section, quantity, *cache[normalized]))

    print_table(rows)
    print(f"\nJanuary 2027 rotation; printings released through {args.as_of}.")
    print("Based on current bans and released printings; future reprints or bans may change results.")
    print("Standard sets from 2025 onward and Foundations survive; Commander/bonus sheets do not count.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
