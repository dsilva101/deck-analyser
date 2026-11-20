#!/usr/bin/env python3
"""Serve card definitions from the locally cached MTGJSON AtomicCards export."""

from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


class CardDatabaseServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], database_path: Path):
        with database_path.open(encoding="utf-8") as database_file:
            self.database = json.load(database_file)
        self.database_path = database_path
        super().__init__(address, CardRequestHandler)


class CardRequestHandler(BaseHTTPRequestHandler):
    server: CardDatabaseServer

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/health":
            self.send_json(
                HTTPStatus.OK,
                {
                    "cards": len(self.server.database["data"]),
                    "source": self.server.database_path.name,
                    "version": self.server.database["meta"]["version"],
                },
            )
            return

        prefix = "/cards/"
        if path.startswith(prefix):
            card_name = unquote(path[len(prefix) :])
            definition = self.server.database["data"].get(card_name)
            if definition is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Card not found"})
            else:
                self.send_json(HTTPStatus.OK, definition)
            return

        self.send_json(
            HTTPStatus.NOT_FOUND,
            {"error": "Use GET /cards/<URL-encoded card name> or GET /health"},
        )

    def send_json(self, status: HTTPStatus, body: object) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    arguments = parser.parse_args()

    server = CardDatabaseServer((arguments.host, arguments.port), arguments.database)
    print(f"Card database ready at http://{arguments.host}:{arguments.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
