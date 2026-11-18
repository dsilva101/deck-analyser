"""Verify all three pickers survive a browser restart when opened from disk."""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import expect, sync_playwright

URL = (Path(__file__).resolve().parents[1] / "index.html").as_uri()
FILES = [
    ("rotation-deck", "deck-file", "deck-text", "rotation.txt", "Deck\n4 Negate\nSideboard\n2 Negate", None),
    ("inventory-deck", "inventory-deck-file", "inventory-deck-text", "wanted.txt", "Deck\n4 Negate\nSideboard\n2 Negate", "Inventory check"),
    ("inventory-collection", "inventory-collection-file", "inventory-collection-text", "collection.csv", "Name,Quantity\nNegate,2", "Inventory check"),
]

with sync_playwright() as p, TemporaryDirectory(prefix="deck-analyser-browser-") as profile:
    errors = []

    def launch():
        context = p.chromium.launch_persistent_context(profile, headless=True)
        context.set_offline(True)
        page = context.pages[0]
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(URL)
        return context, page

    context, page = launch()
    for key, picker, textarea, filename, text, tab in FILES:
        if tab:
            page.get_by_role("tab", name=tab, exact=True).click()
        page.locator(f"#{picker}").set_input_files({"name": filename, "mimeType": "text/plain", "buffer": text.encode()})
        expect(page.locator(f"#{textarea}")).to_have_value(text)
        page.wait_for_function("async ({key, text}) => (await DeckFiles.load(key))?.text === text", arg={"key": key, "text": text})
    context.close()

    context, page = launch()
    for _, picker, textarea, filename, text, _ in FILES:
        expect(page.locator(f"#{textarea}")).to_have_value(text)
        assert page.locator(f"#{picker}").evaluate("input => input.files[0]?.name") == filename
    expect(page.locator("#file-label")).to_have_text("rotation.txt")
    page.get_by_role("tab", name="Inventory check", exact=True).click()
    expect(page.locator("#inventory-collection-file-hint")).to_contain_text("Restored saved copy")
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-output")).to_have_value("4 Negate")
    with page.expect_download() as download:
        page.locator("#inventory-download").click()
    assert Path(download.value.path()).read_text() == "4 Negate\n"
    # Saving one picker must not replace the others.
    page.locator("#inventory-collection-file").set_input_files({"name": "updated.txt", "mimeType": "text/plain", "buffer": b"6 Negate"})
    page.wait_for_function("async () => (await DeckFiles.load('inventory-collection'))?.name === 'updated.txt'")
    page.reload()
    expect(page.locator("#inventory-deck-text")).to_have_value(FILES[1][4])
    expect(page.locator("#inventory-collection-text")).to_have_value("6 Negate")
    expect(page.locator("#deck-text")).to_have_value(FILES[0][4])
    page.get_by_role("tab", name="Inventory check", exact=True).click()
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-status")).to_contain_text("Nothing is missing")
    assert not errors, errors
    context.close()

    # Restricted storage falls back to localStorage; fully blocked storage is reported.
    for block_all in [False, True]:
        context = p.chromium.launch_persistent_context(profile, headless=True)
        page = context.pages[0]
        page.on("pageerror", lambda error: errors.append(str(error)))
        script = "Object.defineProperty(window, 'indexedDB', {get() {throw new Error('Blocked')}});"
        if block_all:
            script += "Object.defineProperty(window, 'localStorage', {get() {throw new Error('Blocked')}});"
        page.add_init_script(script)
        page.goto(URL)
        page.get_by_role("tab", name="Inventory check", exact=True).click()
        page.locator("#inventory-deck-file").set_input_files({"name": "fallback.txt", "mimeType": "text/plain", "buffer": b"1 Forest"})
        expect(page.locator("#inventory-compare")).to_be_enabled()
        if block_all:
            expect(page.locator("#inventory-status")).to_contain_text("could not remember")
        else:
            page.reload()
            expect(page.locator("#inventory-deck-text")).to_have_value("1 Forest")
        assert not errors, errors
        context.close()

print("Remembered files: passed (all pickers, browser restart, CSV format, replacement, heading-free download, storage fallback/failure)")
