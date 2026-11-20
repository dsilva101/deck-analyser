import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("cardmarket_to_decklist.py")
SPEC = importlib.util.spec_from_file_location("cardmarket_to_decklist", SCRIPT)
assert SPEC and SPEC.loader
cardmarket_to_decklist = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cardmarket_to_decklist)


class CardmarketToDecklistTests(unittest.TestCase):
    def test_parses_only_singles_sections_and_combines_orders(self):
        copied_text = """Purchase #1
2x\tDamping Sphere\t
#213
Magic the Gathering Singles (2)
2x\tDamping Sphere\t
#213
1x\tAbhorrent Oculus (V.2)\t
#42
What to do if your order hasn't arrived
Purchase #2
Magic the Gathering Singles (3)
2x Psychic Frog
#199
1x Damping Sphere
#213
"""

        orders = cardmarket_to_decklist.parse_orders(copied_text)

        self.assertEqual(len(orders), 2)
        combined = sum(orders, cardmarket_to_decklist.Counter())
        self.assertEqual(
            cardmarket_to_decklist.format_deck(combined),
            "1 Abhorrent Oculus\n3 Damping Sphere\n2 Psychic Frog",
        )

    def test_ignores_text_without_a_singles_section(self):
        self.assertEqual(cardmarket_to_decklist.parse_orders("4x Not A Card"), [])


if __name__ == "__main__":
    unittest.main()
