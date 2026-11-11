#!/usr/bin/env bash
# Stop the paper desk started by scripts/run_local.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

stop_one() {
  local name="$1"
  local pidfile="run/${name}.pid"
  if [[ ! -f "$pidfile" ]]; then
    echo "$name is not running"
    return
  fi
  local pid
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true
    echo "$name stopped (pid $pid)"
  else
    echo "$name pid $pid was already gone"
  fi
  rm -f "$pidfile"
}

stop_one graduation
stop_one onchain
stop_one trader
stop_one server
