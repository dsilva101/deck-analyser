import asyncio
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("rotation", ROOT / "deck_rotation.py")
rotation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rotation)


def printing(**changes):
    card = dict(name="Test Card", set="new", set_name="New Set",
                set_type="expansion", released_at="2025-02-01",
                collector_number="10", legalities={"standard": "legal"})
    card.update(changes)
    return card


class RotationTests(unittest.TestCase):
    def test_deck_formats_sections_duplicates_and_bom(self):
        text = """\ufeffDeck
4 Llanowar Elves (FDN) 227
2x Llanowar Elves (FDN) 227
3xNegate
# comment
// comment
Lands (20)
(20)
$5.00
20 cards total
1 Forest $0.10
Sideboard
2 Negate
SB: 1 Negate
Deck
1 Island
"""
        self.assertEqual(rotation.parse_deck(text), [
            ("Main", 6, "Llanowar Elves"), ("Main", 3, "Negate"),
            ("Main", 1, "Forest"), ("Side", 3, "Negate"), ("Main", 1, "Island")])

    def test_rotation_boundaries_and_supplemental_printings(self):
        for card, expected in [
            (printing(), True),
            (printing(released_at="2024-12-31"), False),
            (printing(set="fdn", released_at="2024-11-15"), True),
            (printing(set_type="commander"), False),
            (printing(set_type="masterpiece"), False),
        ]:
            with self.subTest(card=card):
                self.assertEqual(rotation.survives(card), expected)

    def lookup(self, cards):
        with patch.object(rotation, "get_json", return_value={"data": cards}):
            return rotation.check_card("Test Card", "2026-11-18")

    def test_status_distinguishes_rotation_bans_and_illegality(self):
        self.assertEqual(self.lookup([printing()])[-1], "Yes")
        self.assertEqual(self.lookup([printing(released_at="2024-01-01")])[-1], "No (rotates out)")
        self.assertEqual(self.lookup([printing(legalities={"standard": "banned"})])[-1], "No (banned)")
        self.assertEqual(self.lookup([printing(legalities={"standard": "not_legal"})])[-1], "No (not Standard legal)")

    def test_pagination_finds_older_qualifying_reprint(self):
        newest = printing(set_type="commander", released_at="2026-01-01")
        with patch.object(rotation, "get_json", side_effect=[
            {"data": [newest], "has_more": True, "next_page": "https://api.scryfall.com/page2"},
            {"data": [printing(set="fdn", released_at="2024-11-15")]},
        ]) as transport:
            result = rotation.check_card("Test Card", "2026-11-18")
        self.assertEqual(transport.call_count, 2)
        self.assertEqual(result[-1], "Yes")
        self.assertEqual(result[2], "2026-01-01")

    def test_browser_and_cli_share_results_and_cutoff(self):
        card = printing(name='A "Quoted" Card')
        calls = []

        async def fetch(url):
            calls.append(url)
            return json.dumps({"data": [card]})

        result = asyncio.run(rotation.check_card_browser(card["name"], "2026-11-18", fetch))
        self.assertEqual(result, self.lookup([card]))
        self.assertIn("date%3C%3D2026-11-18", calls[0])

    def test_latest_printing_prefers_regular_then_lower_number(self):
        cards = [printing(promo=True, collector_number="1"),
                 printing(variation=True, collector_number="2"),
                 printing(collector_number="20"), printing(collector_number="3")]
        self.assertEqual(self.lookup(cards)[1], "New Set (NEW #3)")

    def test_embedded_source_matches_local_python(self):
        embedded = (ROOT / "python-source.js").read_text()
        source = json.loads(embedded.split("window.DECK_ROTATION_SOURCE = ", 1)[1].rstrip(";\n"))
        self.assertEqual(source, (ROOT / "deck_rotation.py").read_text())


if __name__ == "__main__":
    unittest.main()
