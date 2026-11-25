# Deck analyser

Double-click **index.html** to open it in a modern browser. No server, package
installation, or local Python installation is needed to use the page.

File pickers remember their last successfully loaded files in this
browser, including its name and contents. They restore a saved copy after
reloading or reopening the page. Re-select a file to read changes made on disk.
Snapshots stay on your device in IndexedDB (with localStorage as a fallback).
If browser storage is blocked or full, the page reports that it cannot remember
the file; analysis still works for the current visit.

In **Rotation check**, select/drop a UTF-8 deck list (`.txt`, `.dec`, or text `.dek`)
or paste one, then click **Check rotation**. Arena exports, plain names,
quantities (`4 Card`, `4x Card`), and sideboards are supported. Review the table,
filter cards needing attention, or export the full report as CSV. Stop keeps
completed results. Unknown results indicate failed lookups and must be retried.

**Rotation check requires internet** for the Pyodide runtime (jsDelivr) and card lookups
(Scryfall). The file stays in your browser; individual card names and the release
cutoff are sent to Scryfall. Successful lookups are cached for 24 hours if browser
storage is available. Check **Refresh cached cards** to bypass cached results.

## Inventory check

Choose or paste a deck list and your collection, then click **Check inventory**.
This tab works **fully offline**, without Python or online lookups. Copy or
download `missing-decklist.txt`, containing only quantities and card names,
without `Deck` or `Sideboard` headings. Shortages across both sections are
combined into one line per card. The quantity breakdown shows needed,
owned copies used, and missing copies. A blank collection means nothing owned.
Use **Use rotation deck** to copy the current Rotation check input.

Both inputs support UTF-8 text lists or CSV/TSV exports, including ManaBox.
CSV requires `Name` / `Card Name` / `Card` and `Quantity` / `Count` / `Qty` /
`Amount` / `Owned` headers. Comma, semicolon, and tab separators, quoted commas,
and escaped quotes are supported. An optional `Section` / `Board` column can
mark sideboard entries. Inputs are limited to 20 MB each.

Matching ignores case, extra spaces, curly apostrophes, editions, collector
numbers, and foil markers. Double-faced cards match by their front-face name.
Use consistent names and languages: there are no spelling corrections or
translations. Duplicate rows and different printings are added together. Each
owned copy is used only once, filling the main deck before the sideboard.
Collection quantities are not adjusted for cards reserved for other decks.
The last picked collection file is saved in your browser and is never uploaded.

## Deck merger

Choose multiple deck files or paste each deck into its own input, then click
**Merge decks**. The merged card pool contains the **maximum quantity of each
card across the decks**. Duplicate rows and main-deck/sideboard copies are added
within each individual deck before calculating that maximum. For example, 3 main
plus 1 sideboard Negate in deck A and 2 Negates in deck B requires 4 copies total.

This pool lets you build any one of the decks at a time. It is not restricted to
a legal deck size. Copy/download the output as quantities and names without
section headings, or click **Check against collection** to send it to Inventory
check. Text, Arena, and CSV/TSV formats use the inventory parser and matching
rules. The tool works completely offline and remembers its inputs across visits.
Add files anytime; re-selecting a filename replaces its saved copy. Inputs can
also be edited or removed. Limits: 100 decks and 20 MB per list.

## Aggregate wants lists

Select multiple wants-list text files, with one list per file, and consolidate
them into the **maximum quantity of each card in any one list**. For example,
`4 Psychic Frog` in one list and `1 Psychic Frog` in another results in
`4 Psychic Frog`, not 5. Repeated rows in a single list are added before that
maximum is calculated. You can also paste lists, separated from each other by a
blank line. This tab works locally and remembers selected files in the browser.

## Deck diff

Paste a left and right deck list to produce two lists: copies remaining only on
the left, and copies remaining only on the right. Main-deck and sideboard
quantities are combined before comparison, so 2 copies on the left versus 4 on
the right produces `2 Card Name` on the right. Only numbered card rows are
read; blank lines, headings, and notes are ignored. This uses the same offline
card-name cleanup and matching rules as Inventory check, including ignoring set
codes and foil markers.

## Independent local Python implementation

`deck_rotation.py` is a local copy of the original checker, refactored to share
one parser and one lookup algorithm between the CLI and browser. Nothing here
loads or invokes `/home/katz/deck_rotation.py` or its cache. The browser runs real
Python via [Pyodide](https://pyodide.org/en/stable/usage/quickstart.html), with a
browser-fetch transport for [Scryfall](https://scryfall.com/docs/api).

The January 2027 preset is preserved from the supplied checker, not dynamically
updated: expansion/core sets from 2025 onward and Foundations qualify. Current
Standard legality and bans still apply. The release cutoff only filters
printings, not historical legality. Future reprints and bans can change results.
Commander sets, promos, and bonus sheets alone do not establish Standard legality.

The generated `python-source.js` embeds the local Python file. This avoids the
restrictions on fetching sibling source files when opening an HTML file directly
from disk. Keep all project files in the same folder. After changing Python:

```sh
python3 build.py
```

The CLI still works independently (Python 3.9+; standard library only):

```sh
python3 deck_rotation.py deck.txt
python3 deck_rotation.py deck.txt --as-of 2026-11-18 --refresh
```

CLI and browser caches are separate. No existing cache was copied.

## Verification

```sh
python3 -m unittest discover -s tests -v
node --check app.js
node --test tests/inventory.test.js tests/merger.test.js
```

The browser integration test uses Playwright if installed:

```sh
python3 tests/browser_check.py
python3 tests/inventory_browser_check.py
python3 tests/remembered_files_browser_check.py
python3 tests/merger_browser_check.py
python3 tests/diff_browser_check.py
python3 tests/wants_list_browser_check.py
```

It opens `index.html` via `file://`, loads the real Python runtime, and uses
deterministic Scryfall fixtures. Add `--live` for a real Scryfall smoke test.
