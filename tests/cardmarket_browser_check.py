"""Cardmarket importer works locally from file:// without network access."""
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "index.html").as_uri()
ORDERS = """Thank you for your purchase

Shipment details:

Shipment 123456
Contents:
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
2x Damping Sphere (Dominaria) - U - English - EX 0,75 EUR
1x Abhorrent Oculus (V.2) (Duskmourn: House of Horror: Promos) - M - English - NM 13,90 EUR
4x Darkslick Shores (Phyrexia: All Will Be One: Extras) - R - Engli... 3,46 EUR
1x Abhorrent Oculus (V.2) (Duskmourn: House of Horror: Promos) - M ... 11,87 EUR
1x Rest in Peace (V.1) (Universes Beyond: Assassin's Creed: Extras)... 0,89 EUR
1x Custodi Squire (Mystery Booster 2: Reprints from Across Magic's ... 0,06 EUR
Shipping 5,00 EUR
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Total 35,93 EUR

Shipment 123457
Contents:
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
2x Psychic Frog (Modern Horizons 3) - R - French - GD 4,94 EUR
1x Damping Sphere (Dominaria) - U - French - NM 0,75 EUR
1x Lórien Revealed (The Lord of the Rings: Tales of Middle-earth) -... 3,93 EUR
2x Tithing Blade // Consuming Sepulcher (The Lost Caverns of Ixalan... 0,75 EUR
1x Seasoned Cryomancer (V.1) (Mystery Booster 2: Reprints from Acro... 8,98 EUR
Shipping 4,10 EUR
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Total 29,21 EUR
"""
EXPECTED = "\n".join([
    "2 Abhorrent Oculus",
    "1 Custodi Squire",
    "3 Damping Sphere",
    "4 Darkslick Shores",
    "1 Lórien Revealed",
    "2 Psychic Frog",
    "1 Rest in Peace",
    "1 Seasoned Cryomancer",
    "2 Tithing Blade // Consuming Sepulcher",
])


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
    page.locator("#cardmarket-consolidate").click()
    expect(page.locator("#cardmarket-output")).to_have_value(EXPECTED)
    assert page.locator("#cardmarket-stats strong").all_text_contents() == ["2", "9", "17"]
    with page.expect_download() as download:
        page.locator("#cardmarket-download").click()
    assert download.value.suggested_filename == "cardmarket-decklist.txt"
    assert Path(download.value.path()).read_text().strip() == EXPECTED

    page.locator("#cardmarket-inventory").click()
    expect(page.locator("#inventory-panel")).to_be_visible()
    expect(page.locator("#inventory-deck-text")).to_have_value(EXPECTED)
    page.get_by_role("tab", name="agg cardmarket orders", exact=True).click()
    page.locator("#cardmarket-file").set_input_files(
        {"name": "orders.txt", "mimeType": "text/plain", "buffer": b"2x Psychic Frog"}
    )
    expect(page.locator("#cardmarket-status")).to_contain_text("Cardmarket purchase-confirmation")
    context.close()

print("Cardmarket browser: passed (offline file input, consolidation, output, download, inventory handoff)")
