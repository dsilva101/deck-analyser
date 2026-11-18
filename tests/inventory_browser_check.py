"""Exercise Inventory check from file:// with every network request blocked."""
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1360, "height": 1000}, accept_downloads=True)
    network = []

    def block(route):
        network.append(route.request.url)
        route.abort()

    context.route("http://**/*", block)
    context.route("https://**/*", block)
    context.set_offline(True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto((ROOT / "index.html").as_uri())
    page.get_by_role("tab", name="Inventory check", exact=True).click()
    expect(page.locator("#inventory-panel")).to_be_visible()
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-status")).to_contain_text("No cards found")

    def upload(kind, name, content):
        page.locator(f"#inventory-{kind}-file").set_input_files({"name": name, "mimeType": "text/plain", "buffer": content.encode()})
        expect(page.locator(f"#inventory-{kind}-text")).to_have_value(content)

    deck = "Deck\n4 Llanowar Elves (FDN) 227\n4 Lightning Strike\nSideboard\n2 Lightning Strike\n2 Negate"
    collection = 'Binder Name,Name,Quantity,Foil\nMain,Llanowar Elves,2,normal\nTrade,Llanowar Elves,1,foil\nMain,Lightning Strike,5,normal\nMain,Negate,1,normal'
    upload("deck", "deck.txt", deck)
    upload("collection", "collection.csv", collection)
    page.locator("#inventory-compare").click()
    expected = "1 Llanowar Elves\n1 Lightning Strike\n1 Negate"
    expect(page.locator("#inventory-output")).to_have_value(expected)
    assert page.locator("#inventory-stats strong").all_text_contents() == ["12", "9", "3", "3"]
    page.get_by_text("See the quantity breakdown", exact=True).click()
    expect(page.locator("#inventory-rows tr")).to_have_count(4)
    page.locator("#inventory-copy").click()
    expect(page.locator("#inventory-status")).to_contain_text("cop")
    with page.expect_download() as downloaded:
        page.locator("#inventory-download").click()
    assert downloaded.value.suggested_filename == "missing-decklist.txt"
    assert Path(downloaded.value.path()).read_text().strip() == expected

    # Editing inputs hides the obsolete report and disables copying.
    page.locator("#inventory-collection-text").fill("20 Llanowar Elves\n20 Lightning Strike\n20 Negate")
    expect(page.locator("#inventory-results")).to_be_hidden()
    expect(page.locator("#inventory-copy")).to_be_disabled()
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-status")).to_contain_text("Nothing is missing")
    expect(page.locator("#inventory-output")).to_have_value("")
    expect(page.locator("#inventory-download")).to_be_disabled()

    page.locator("#inventory-collection-text").fill("")
    page.locator("#inventory-compare").click()
    assert page.locator("#inventory-stats strong").all_text_contents() == ["12", "0", "12", "3"]

    # Bad CSV and unsafe quantities produce an error, without an old usable result.
    upload("collection", "broken.csv", "Name,Quantity\nNegate,1.5")
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-status")).to_contain_text("whole number")
    expect(page.locator("#inventory-results")).to_be_hidden()

    # A real card with a comma, and harmless literal HTML input.
    page.locator("#inventory-deck-text").fill("2 Thalia, Guardian of Thraben\n1 <img src=x onerror=alert(1)>")
    upload("collection", "quoted.csv", 'Name,Quantity\n"Thalia, Guardian of Thraben",1')
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-output")).to_have_value("1 Thalia, Guardian of Thraben\n1 <img src=x onerror=alert(1)>")
    assert page.locator("#inventory-rows img").count() == 0

    # Share the rotation input without invoking the runtime.
    page.get_by_role("tab", name="Rotation check", exact=True).click()
    page.locator("#deck-text").fill(deck)
    page.get_by_role("tab", name="Inventory check", exact=True).click()
    page.locator("#inventory-use-rotation").click()
    expect(page.locator("#inventory-deck-text")).to_have_value(deck)
    upload("collection", "collection.csv", collection)
    page.locator("#inventory-compare").click()
    expect(page.locator("#inventory-output")).to_have_value(expected)

    artifacts = ROOT / "test-artifacts"
    artifacts.mkdir(exist_ok=True)
    page.screenshot(path=str(artifacts / "inventory-desktop.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(artifacts / "inventory-mobile.png"), full_page=True)
    page.get_by_role("tab", name="Inventory check", exact=True).press("ArrowRight")
    expect(page.locator("#merger-panel")).to_be_visible()
    page.get_by_role("tab", name="Deck merger", exact=True).press("ArrowRight")
    expect(page.locator("#about-panel")).to_be_visible()
    assert not errors, errors
    assert not network, network
    print("Inventory browser: passed (offline file://, files, CSV, quantities, sideboard, copy/download, errors, tabs, mobile)")
    browser.close()
