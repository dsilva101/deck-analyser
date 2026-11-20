"""Cardmarket importer works locally from file:// without network access."""
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "index.html").as_uri()
ORDERS = """Purchase #1
Magic the Gathering Singles (2)
2x Damping Sphere
#213
1x Abhorrent Oculus (V.2)
#42
Purchase #2
Magic the Gathering Singles (3)
2x Psychic Frog
#199
1x Damping Sphere
#213
"""
EXPECTED = "1 Abhorrent Oculus\n3 Damping Sphere\n2 Psychic Frog"


with sync_playwright() as playwright, TemporaryDirectory(prefix="cardmarket-browser-") as profile:
    context = playwright.chromium.launch_persistent_context(
        profile, headless=True, accept_downloads=True
    )
    context.set_offline(True)
    page = context.pages[0]
    page.goto(URL)
    page.get_by_role("tab", name="agg cardmarket orders", exact=True).click()

    page.locator("#cardmarket-file").set_input_files(
        {"name": "orders.txt", "mimeType": "text/plain", "buffer": ORDERS.encode()}
    )
    expect(page.locator("#cardmarket-text")).to_have_value(ORDERS)
    page.locator("#cardmarket-consolidate").click()
    expect(page.locator("#cardmarket-output")).to_have_value(EXPECTED)
    assert page.locator("#cardmarket-stats strong").all_text_contents() == ["2", "3", "6"]
    with page.expect_download() as download:
        page.locator("#cardmarket-download").click()
    assert download.value.suggested_filename == "cardmarket-decklist.txt"
    assert Path(download.value.path()).read_text().strip() == EXPECTED

    page.locator("#cardmarket-inventory").click()
    expect(page.locator("#inventory-panel")).to_be_visible()
    expect(page.locator("#inventory-deck-text")).to_have_value(EXPECTED)
    context.close()

print("Cardmarket browser: passed (offline file input, consolidation, output, download, inventory handoff)")
