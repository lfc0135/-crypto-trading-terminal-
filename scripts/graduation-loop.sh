#!/usr/bin/env bash
# Restart-on-crash supervisor for the graduation-window paper trader. Paper only.
# PID file holds this supervisor. Stop with: kill "$(cat run/graduation.pid)"
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # Values are loaded into the environment and never echoed.
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
mkdir -p run data/graduation
LOG="$ROOT/run/graduation.log"
PIDFILE="$ROOT/run/graduation.pid"
CHILD=""
cleanup() {
  if [[ -n "$CHILD" ]]; then kill "$CHILD" 2>/dev/null || true; wait "$CHILD" 2>/dev/null || true; fi
  rm -f "$PIDFILE"
  exit 0
}
trap cleanup INT TERM
echo $$ > "$PIDFILE"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) supervisor pid=$$ starting" >> "$LOG"
while true; do
  node_modules/.bin/tsx src/onchain/graduation.ts >> "$LOG" 2>&1 &
  CHILD=$!
  wait "$CHILD"
  code=$?
  CHILD=""
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) trader exited code=${code}, restarting in 15s" >> "$LOG"
  sleep 15
done
