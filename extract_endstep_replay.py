#!/usr/bin/env python3
"""Extract a gzip-compressed Endstep .esreplay file to JSON Lines.

Endstep replay exports are gzip streams whose decompressed payload is JSONL.
This tool leaves the replay untouched, validates the payload while copying it,
and writes the destination atomically.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
from pathlib import Path
import sys
import tempfile


def default_destination(source: Path) -> Path:
    if source.suffix.lower() == ".esreplay":
        return source.with_suffix(".jsonl")
    return source.with_name(source.name + ".jsonl")


def extract(source: Path, destination: Path, force: bool) -> tuple[int, int]:
    if not source.is_file():
        raise ValueError(f"input file does not exist or is not a file: {source}")
    if destination.exists() and not force:
        raise ValueError(
            f"output file already exists: {destination} (pass --force to replace it)"
        )

    destination.parent.mkdir(parents=True, exist_ok=True)
    line_count = 0
    byte_count = 0
    temporary_name: str | None = None
    try:
        with gzip.open(source, "rt", encoding="utf-8", newline="") as replay, tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=destination.parent,
            prefix=f".{destination.name}.", suffix=".tmp", delete=False,
        ) as temporary:
            temporary_name = temporary.name
            for line_number, line in enumerate(replay, start=1):
                if not line.strip():
                    raise ValueError(f"invalid JSONL: blank line at {line_number}")
                try:
                    json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(
                        f"invalid JSON on line {line_number}: {error.msg}"
                    ) from error
                temporary.write(line)
                line_count += 1
                byte_count += len(line.encode("utf-8"))
        if line_count == 0:
            raise ValueError("invalid JSONL: replay contains no records")
        os.replace(temporary_name, destination)
        temporary_name = None
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)
    return line_count, byte_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replay", type=Path, help="source .esreplay file")
    parser.add_argument(
        "output", nargs="?", type=Path,
        help="destination .jsonl file (defaults beside the source)",
    )
    parser.add_argument("-f", "--force", action="store_true", help="replace an existing output file")
    args = parser.parse_args()

    source = args.replay.expanduser()
    destination = (args.output or default_destination(source)).expanduser()
    try:
        records, byte_count = extract(source, destination, args.force)
    except (OSError, UnicodeDecodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"extracted {records} JSONL records ({byte_count:,} bytes) to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
