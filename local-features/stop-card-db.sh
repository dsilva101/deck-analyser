#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pid_file="$script_dir/card-db-server.pid"

if [ ! -f "$pid_file" ]; then
    printf 'Card database is not running.\n'
    exit 0
fi

process_id=$(cat "$pid_file")
if kill -0 "$process_id" 2>/dev/null; then
    kill "$process_id"
fi
rm -f "$pid_file"
printf 'Card database stopped.\n'
