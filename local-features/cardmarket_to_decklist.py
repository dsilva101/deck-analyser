#!/usr/bin/env python3
"""Convert copied Cardmarket order pages to plain Magic deck lists.

The script only reads rows within a ``Magic the Gathering Singles`` section,
so the surrounding Cardmarket navigation, shipping information, and prices can
be left in the copied text.  Multiple pasted orders are combined by default.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path


SECTION_MARKER = "Magic the Gathering Singles"
ROW = re.compile(r"^\s*(?P<quantity>\d+)\s*x\s+(?P<name>.+?)\s*$", re.IGNORECASE)
# Cardmarket appends this printing marker to some product names.  It is not part
# of the Magic card name and would make many deck importers reject the line.
VERSION_SUFFIX = re.compile(r"\s+\(V\.\d+\)$", re.IGNORECASE)


def normalise_card_name(name: str) -> str:
    return VERSION_SUFFIX.sub("", name).strip()


def parse_orders(text: str) -> list[Counter[str]]:
    """Return one card counter for every Cardmarket singles section in *text*."""
    orders: list[Counter[str]] = []
    current: Counter[str] | None = None

    for line in text.splitlines():
        if SECTION_MARKER.casefold() in line.casefold():
            current = Counter()
            orders.append(current)
            continue

        if current is None:
            continue

        match = ROW.match(line)
        if match:
            current[normalise_card_name(match["name"])] += int(match["quantity"])

    return [order for order in orders if order]


def format_deck(cards: Counter[str]) -> str:
    """Format cards as the widely accepted ``quantity Card Name`` deck syntax."""
    return "\n".join(f"{quantity} {name}" for name, quantity in sorted(cards.items(), key=lambda item: item[0].casefold()))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert copied Cardmarket order page(s) into a Magic deck list."
    )
    parser.add_argument(
        "input",
        type=Path,
        nargs="?",
        help="Copied Cardmarket text file (reads standard input when omitted).",
    )
    parser.add_argument(
        "--separate",
        action="store_true",
        help="Keep each order as a separate deck list instead of combining them.",
    )
    arguments = parser.parse_args()

    text = arguments.input.read_text(encoding="utf-8") if arguments.input else sys.stdin.read()
    orders = parse_orders(text)
    if not orders:
        parser.error("no Cardmarket 'Magic the Gathering Singles' card rows found")

    if arguments.separate:
        output = "\n\n".join(format_deck(order) for order in orders)
    else:
        combined: Counter[str] = Counter()
        for order in orders:
            combined.update(order)
        output = format_deck(combined)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
