#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pid_file="$script_dir/card-db-server.pid"
log_file="$script_dir/card-db-server.log"
port=${CARD_DB_PORT:-8765}

if [ -f "$pid_file" ]; then
    process_id=$(cat "$pid_file")
    if kill -0 "$process_id" 2>/dev/null; then
        printf 'Card database is already running at http://127.0.0.1:%s\n' "$port"
        exit 0
    fi
    rm -f "$pid_file"
fi

nohup python3 "$script_dir/card_db_server.py" \
    --database "$script_dir/AtomicCards.json" \
    --port "$port" >"$log_file" 2>&1 &
process_id=$!
printf '%s\n' "$process_id" > "$pid_file"

sleep 2
if kill -0 "$process_id" 2>/dev/null; then
    printf 'Card database started at http://127.0.0.1:%s\n' "$port"
else
    rm -f "$pid_file"
    printf 'Card database failed to start. Inspect %s\n' "$log_file" >&2
    exit 1
fi
