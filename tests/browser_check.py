"""File-URL integration test, using real browser Python and fixture card data."""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--live", action="store_true", help="also test real Scryfall")
args = parser.parse_args()


def fixture(name):
    card = dict(name=name, set="new", set_name="New Set", set_type="expansion",
                released_at="2025-02-01", collector_number="10",
                legalities={"standard": "legal"})
    if name == "Old Card":
        card.update(released_at="2024-01-01")
    if name == "Foundations Card":
        card.update(set="fdn", released_at="2024-11-15")
    if name == "Banned Card":
        card["legalities"]["standard"] = "banned"
    if name == "Commander Card":
        card.update(set_type="commander", legalities={"standard": "not_legal"})
    return card


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1360, "height": 1100}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    calls = []

    def scryfall(route):
        query = parse_qs(urlparse(route.request.url).query)["q"][0]
        name = re.match(r'^!"(.*)" game:', query)[1]
        calls.append(name)
        if name == "Missing Card":
            route.fulfill(status=404, json={"object": "error", "details": "not found"})
        else:
            route.fulfill(json={"data": [fixture(name)], "has_more": False})

    context.route("https://api.scryfall.com/**", scryfall)
    page.goto((ROOT / "index.html").as_uri())
    expect(page.get_by_role("tab", name="Rotation check")).to_have_attribute("aria-selected", "true")
    page.locator("#analyze").click()
    expect(page.locator("#status")).to_contain_text("Choose a deck list")
    deck = "Deck\n4 New Card\n3 Old Card\n2 Foundations Card\n1 Banned Card\n1 Commander Card\n1 Missing Card\nSideboard\n2 New Card\n"
    page.locator("#deck-file").set_input_files({"name": "test-deck.txt", "mimeType": "text/plain", "buffer": deck.encode()})
    expect(page.locator("#deck-text")).to_have_value(deck)
    page.locator("#as-of").fill("2026-11-18")

    def analyze():
        page.locator("#analyze").click()
        expect(page.locator("#analyze")).to_be_enabled(timeout=120000)

    analyze()
    expect(page.locator("#result-rows tr")).to_have_count(7)
    assert len(calls) == 6, calls  # Repeated sideboard card shares lookup.
    assert page.locator("#stats strong").all_text_contents() == ["14", "8", "5", "1"]
    expect(page.locator("#status")).to_contain_text("1 lookup(s) failed")
    page.get_by_role("button", name="Needs attention", exact=True).click()
    expect(page.locator("#result-rows tr")).to_have_count(4)
    page.locator("#search").fill("banned")
    expect(page.locator("#result-rows tr")).to_have_count(1)
    page.locator("#search").fill("<script>")
    expect(page.locator("#table-empty")).to_be_visible()
    with page.expect_download() as download:
        page.locator("#export").click()
    csv = Path(download.value.path()).read_text(encoding="utf-8-sig")
    assert "No (banned)" in csv and "Foundations Card" in csv and "2026-11-18" in csv

    before = len(calls)
    analyze()
    assert len(calls) == before + 1, calls  # Only the unsuccessful card is retried.
    page.locator("#refresh").check()
    before = len(calls)
    analyze()
    assert len(calls) == before + 6, calls

    # An interrupted run keeps only the entries it completed.
    page.locator("#analyze").click()
    expect(page.locator("#result-rows tr")).to_have_count(1, timeout=30000)
    page.locator("#cancel").click()
    expect(page.locator("#analyze")).to_be_enabled(timeout=30000)
    expect(page.locator("#status")).to_contain_text("Stopped")
    expect(page.locator("#report-meta")).to_contain_text("partial results")

    page.get_by_role("tab", name="agg cardmarket orders").click()
    expect(page.locator("#cardmarket-panel")).to_be_visible()
    page.get_by_role("tab", name="agg cardmarket orders").press("ArrowLeft")
    expect(page.locator("#diff-panel")).to_be_visible()
    page.get_by_role("tab", name="Deck merger").press("ArrowLeft")
    expect(page.locator("#inventory-panel")).to_be_visible()
    page.get_by_role("tab", name="Inventory check").press("ArrowLeft")
    expect(page.locator("#rotation-panel")).to_be_visible()
    page.locator("#refresh").uncheck()
    analyze()
    artifacts = ROOT / "test-artifacts"
    artifacts.mkdir(exist_ok=True)
    page.screenshot(path=str(artifacts / "desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(artifacts / "mobile.png"), full_page=True)

    if args.live:
        context.unroute("https://api.scryfall.com/**")
        page.locator("#deck-text").fill("Deck\n4 Llanowar Elves\n20 Forest\nSideboard\n2 Negate")
        page.locator("#refresh").check()
        analyze()
        expect(page.locator("#result-rows tr")).to_have_count(3)
        assert "Unknown" not in page.locator("#result-rows").inner_text()
        print("Live Scryfall: passed (Llanowar Elves, Forest, Negate)")
    assert not errors, errors
    print("Browser integration: passed (file://, real Python, fixtures, cache, filters, CSV, stop, tabs, mobile)")
    browser.close()
