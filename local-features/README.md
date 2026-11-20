# Local MTG card database

`AtomicCards.json` is the decompressed MTGJSON AtomicCards export downloaded on
2026-11-19. It contains one current Oracle card definition per card name and is
keyed by that name under the top-level `data` object.

The installed snapshot identifies itself as MTGJSON `5.3.0+20261118`, dated
2026-11-18. Its SHA-256 is
`e3040a48560532b50b8a6e26051d7dcdf8252e0a40cdf703b9f0a0b063c761a3`.

It includes the 2026 Star Trek releases, including `TRK` and `TRC` printings.

## Update the snapshot

Run these commands from the repository root:

```sh
curl -fL --retry 3 https://mtgjson.com/api/v5/AtomicCards.json.xz \
  -o /tmp/AtomicCards.json.xz
xz -dc /tmp/AtomicCards.json.xz > local-features/AtomicCards.json
sha256sum local-features/AtomicCards.json
jq '.meta' local-features/AtomicCards.json
```

The final two commands record the installed file's checksum and verify the
source date and version. MTGJSON publishes this export daily. The upstream
download index and checksums are at <https://mtgjson.com/api/v5/>.

## Read a definition

```sh
jq '.data["A Good Day to Die"]' local-features/AtomicCards.json
```

The value is an array because a name can have more than one atomic definition.

## Convert Cardmarket orders to a deck list

Save one or more copied Cardmarket order pages in a text file, then run:

```sh
python3 local-features/cardmarket_to_decklist.py cardmarket-orders.txt
```

It extracts rows from every `Magic the Gathering Singles` section, combines
matching card names across the pasted orders, alphabetizes them, and prints
plain deck-list syntax such as `4 Psychic Frog`. Redirect the result to save it:

```sh
python3 local-features/cardmarket_to_decklist.py cardmarket-orders.txt > decklist.txt
```

Use `--separate` to print one deck list per order rather than merging them.
The input can also be piped on standard input.

## Keep the database in memory

Start a local service that loads the database once and stays in the background:

```sh
./local-features/start-card-db.sh
```

It listens only on `127.0.0.1:8765`. Query a card by URL-encoding its name:

```sh
curl 'http://127.0.0.1:8765/cards/A%20Good%20Day%20to%20Die'
curl 'http://127.0.0.1:8765/health'
```

Set `CARD_DB_PORT` before starting to use a different local port. Stop the
service when it is no longer needed:

```sh
./local-features/stop-card-db.sh
```
