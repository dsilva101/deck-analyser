"""Wants-list consolidation works offline from a local file."""
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "index.html").as_uri()
WANTS = """Modern wants
4x Psychic Frog (any)
2 Damping Sphere (DOM)
1\tAbandoned Air Temple\tAny\t
Price € 11.20

Another wants list
1x Psychic Frog (MH3) 199
3x Engineered Explosives [Double Masters]
"""
EXPECTED = "1 Abandoned Air Temple\n2 Damping Sphere\n3 Engineered Explosives\n5 Psychic Frog"


with sync_playwright() as playwright, TemporaryDirectory(prefix="wants-list-browser-") as profile:
    context = playwright.chromium.launch_persistent_context(
        profile, headless=True, accept_downloads=True
    )
    context.set_offline(True)
    page = context.pages[0]
    page.goto(URL)
    page.get_by_role("tab", name="agg wants lists", exact=True).click()
    page.locator("#wants-list-file").set_input_files(
        {"name": "wants.txt", "mimeType": "text/plain", "buffer": WANTS.encode()}
    )
    expect(page.locator("#wants-list-text")).to_have_value(WANTS)
    page.locator("#wants-list-consolidate").click()
    expect(page.locator("#wants-list-output")).to_have_value(EXPECTED)
    assert page.locator("#wants-list-stats strong").all_text_contents() == ["5", "4", "11"]
    with page.expect_download() as download:
        page.locator("#wants-list-download").click()
    assert download.value.suggested_filename == "consolidated-wants-list.txt"
    assert Path(download.value.path()).read_text().strip() == EXPECTED
    page.locator("#wants-list-inventory").click()
    expect(page.locator("#inventory-deck-text")).to_have_value(EXPECTED)
    context.close()

print("Wants lists browser: passed (offline file input, consolidation, download, inventory handoff)")
