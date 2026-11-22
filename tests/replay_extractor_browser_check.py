"""Replay extractor works locally with a gzip-compressed Endstep replay."""
import gzip
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
REPLAY = "\n".join([
    json.dumps({"format": "endstep-replay", "formatVersion": 1}),
    json.dumps({"t": 0, "k": "key", "state": {"turnNumber": "0"}}),
]) + "\n"


with sync_playwright() as playwright, TemporaryDirectory(prefix="replay-extractor-browser-") as profile:
    context = playwright.chromium.launch_persistent_context(
        profile, headless=True, accept_downloads=True
    )
    context.set_offline(True)
    page = context.pages[0]
    page.goto((ROOT / "index.html").as_uri())
    page.get_by_role("tab", name="Replay extractor", exact=True).click()

    page.locator("#replay-extractor-file").set_input_files({
        "name": "match.esreplay",
        "mimeType": "application/gzip",
        "buffer": gzip.compress(REPLAY.encode()),
    })
    with page.expect_download() as download:
        page.locator("#replay-extractor-download").click()
    assert download.value.suggested_filename == "match.jsonl"
    assert Path(download.value.path()).read_text() == REPLAY
    expect(page.locator("#replay-extractor-status")).to_contain_text("2 JSONL records")
    assert page.locator("#replay-extractor-stats strong").all_text_contents()[0] == "2"

    page.locator("#replay-extractor-file").set_input_files({
        "name": "broken.esreplay", "mimeType": "application/gzip", "buffer": b"not gzip",
    })
    page.locator("#replay-extractor-download").click()
    expect(page.locator("#replay-extractor-status")).to_contain_text("not a readable gzip")
    context.close()

print("Replay extractor browser: passed (offline gzip extraction, validation, download)")
