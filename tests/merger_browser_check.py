"""Deck merger from file://, offline, including restoration after a restart."""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "index.html").as_uri()
DECK_A = "Deck\n2 Negate (FDN) 710\n2 NEGATE\n20 Island\nSideboard\n1 Negate"
DECK_B = "Name,Quantity,Section\nNegate,2,Main\nNegate,4,Sideboard\nForest,3,Main"
EXPECTED = "6 Negate\n20 Island\n3 Forest"

with sync_playwright() as p, TemporaryDirectory(prefix="deck-merger-browser-") as profile:
    errors, network = [], []

    def launch():
        context = p.chromium.launch_persistent_context(profile, headless=True, viewport={"width": 1360, "height": 1000}, accept_downloads=True)
        context.set_offline(True)

        def block(route):
            network.append(route.request.url)
            route.abort()

        context.route("https://**/*", block)
        context.route("http://**/*", block)
        page = context.pages[0]
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(URL)
        page.get_by_role("tab", name="Deck merger", exact=True).click()
        expect(page.locator("#merger-merge")).to_be_enabled()
        return context, page

    context, page = launch()
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-status")).to_contain_text("no cards found")
    page.locator("#merger-files").set_input_files([
        {"name": "deck-a.txt", "mimeType": "text/plain", "buffer": DECK_A.encode()},
        {"name": "deck-b.csv", "mimeType": "text/csv", "buffer": DECK_B.encode()},
    ])
    expect(page.locator("#merger-inputs textarea")).to_have_count(2)
    expect(page.locator("#merger-merge")).to_be_enabled()
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-output")).to_have_value(EXPECTED)
    assert page.locator("#merger-stats strong").all_text_contents() == ["2", "3", "29", "5"]
    page.get_by_text("Compare quantities across decks", exact=True).click()
    expect(page.locator("#merger-rows tr")).to_have_count(3)
    assert page.locator("#merger-rows tr").first.locator("td").all_text_contents() == ["Negate", "5", "6", "6"]
    page.locator("#merger-copy").click()
    expect(page.locator("#merger-status")).to_contain_text("cop")
    with page.expect_download() as download:
        page.locator("#merger-download").click()
    assert download.value.suggested_filename == "merged-decklist.txt"
    assert Path(download.value.path()).read_text().strip() == EXPECTED
    page.wait_for_function("async () => (await DeckFiles.loadMany('merger-decks')).length === 2")
    context.close()

    context, page = launch()
    expect(page.locator("#merger-inputs textarea")).to_have_count(2)
    assert page.locator("#merger-inputs textarea").nth(0).input_value() == DECK_A
    assert page.locator("#merger-inputs textarea").nth(1).input_value() == DECK_B
    assert page.locator("#merger-files").evaluate("input => [...input.files].map(file => file.name)") == ["deck-a.txt", "deck-b.csv"]
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-output")).to_have_value(EXPECTED)

    page.locator("#merger-inventory").click()
    expect(page.locator("#inventory-panel")).to_be_visible()
    expect(page.locator("#inventory-deck-text")).to_have_value(EXPECTED)
    page.locator("#inventory-collection-text").fill("4 Negate\n20 Island")
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-output")).to_have_value("2 Negate\n3 Forest")

    page.get_by_role("tab", name="Deck merger", exact=True).click()
    page.locator("#merger-add").click()
    expect(page.locator("#merger-results")).to_be_hidden()
    page.locator("#merger-inputs textarea").nth(2).fill("7 Negate\n1 Plains")
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-output")).to_have_value("7 Negate\n20 Island\n3 Forest\n1 Plains")
    page.locator("#merger-inputs textarea").nth(2).fill("1.5 Negate")
    expect(page.locator("#merger-results")).to_be_hidden()
    expect(page.locator("#merger-copy")).to_be_disabled()
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-status")).to_contain_text("Deck 3")
    page.get_by_role("button", name="Remove deck 3", exact=True).click()
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-output")).to_have_value(EXPECTED)

    # A re-selected file replaces the snapshot, rather than increasing its quantities.
    page.locator("#merger-files").set_input_files({"name": "deck-a.txt", "mimeType": "text/plain", "buffer": b"8 Negate"})
    expect(page.locator("#merger-merge")).to_be_enabled()
    expect(page.locator("#merger-inputs textarea")).to_have_count(2)
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-output")).to_have_value("8 Negate\n3 Forest")

    artifacts = ROOT / "test-artifacts"
    artifacts.mkdir(exist_ok=True)
    page.screenshot(path=str(artifacts / "merger-desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(artifacts / "merger-mobile.png"), full_page=True)
    page.get_by_role("tab", name="Deck merger", exact=True).press("ArrowRight")
    expect(page.locator("#diff-panel")).to_be_visible()
    page.get_by_role("tab", name="Deck diff", exact=True).press("ArrowRight")
    expect(page.locator("#cardmarket-panel")).to_be_visible()
    page.get_by_role("tab", name="Deck merger", exact=True).click()
    page.locator("#merger-files").set_input_files([
        {"name": "same-name.txt", "mimeType": "text/plain", "buffer": b"4 Island"},
        {"name": "same-name.txt", "mimeType": "text/plain", "buffer": b"9 Island"},
    ])
    expect(page.locator("#merger-merge")).to_be_enabled()
    expect(page.locator("#merger-inputs textarea")).to_have_count(4)
    page.locator("#merger-merge").click()
    expect(page.locator("#merger-output")).to_have_value("8 Negate\n3 Forest\n9 Island")
    assert not errors, errors
    assert not network, network
    context.close()

print("Deck merger browser: passed (offline, multiple files, CSV, main/side maxima, persistence, paste/remove, download, inventory, errors, tabs, mobile)")
