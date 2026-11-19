"""Exercise Deck diff offline from file://."""
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1360, "height": 1000})
    context.set_offline(True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto((ROOT / "index.html").as_uri())
    page.get_by_role("tab", name="Deck diff", exact=True).click()
    expect(page.locator("#diff-panel")).to_be_visible()

    page.locator("#diff-compare").click()
    expect(page.locator("#diff-status")).to_contain_text("left deck")
    page.locator("#diff-left-text").fill("\nDeck\nThis is a note\n2 Negate (FDN) 710 *F*\nSideboard\n1 Negate\n4 Llanowar Elves\n")
    page.locator("#diff-right-text").fill("3 negate\n4 Lightning Strike\n3 cards total")
    page.locator("#diff-compare").click()
    expect(page.locator("#diff-left-output")).to_have_value("4 Llanowar Elves")
    expect(page.locator("#diff-right-output")).to_have_value("4 Lightning Strike")
    expect(page.locator("#diff-left-count")).to_have_text("1")
    expect(page.locator("#diff-right-count")).to_have_text("1")

    page.locator("#diff-right-text").fill("2 Negate\n4 Llanowar Elves")
    expect(page.locator("#diff-results")).to_be_hidden()
    page.locator("#diff-compare").click()
    expect(page.locator("#diff-left-output")).to_have_value("")
    expect(page.locator("#diff-right-output")).to_have_value("")
    assert not errors, errors
    browser.close()

print("Deck diff browser: passed (offline, normalization, inputs, empty results)")
