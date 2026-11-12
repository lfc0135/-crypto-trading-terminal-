#!/usr/bin/env bash
# Supervisor for the graduation-window paper trader. Paper only.
# - Restarts the trader if it crashes.
# - Watchdog: kills and restarts it if run/graduation.heartbeat has not moved for 5 minutes (a stuck cycle).
#   After the box resumes from a pause the clock jumps, so the watchdog gives a fresh 5-minute grace instead of
#   killing a trader that was merely frozen with the machine.
# - Single instance: holds an exclusive lock on run/graduation.lock.
# PID file holds this supervisor. Stop with: kill "$(cat run/graduation.pid)"
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p run data/graduation
LOG="$ROOT/run/graduation.log"
PIDFILE="$ROOT/run/graduation.pid"
HB="$ROOT/run/graduation.heartbeat"
STALE_SEC="${GRAD_WATCHDOG_SEC:-300}"
exec 9>"$ROOT/run/graduation.lock"
if ! flock -n 9; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) another supervisor holds run/graduation.lock; exiting" >> "$LOG"
  exit 3
fi
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # Values are loaded into the environment and never echoed.
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
CHILD=""
kill_child() {
  local sig="$1"
  if [[ -n "$CHILD" ]]; then
    pkill "-$sig" -P "$CHILD" 2>/dev/null || true
    kill "-$sig" "$CHILD" 2>/dev/null || true
  fi
}
cleanup() {
  if [[ -n "$CHILD" ]]; then
    kill_child TERM
    for _ in $(seq 1 30); do kill -0 "$CHILD" 2>/dev/null || break; sleep 1; done
    kill_child KILL
    wait "$CHILD" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
  exit 0
}
trap cleanup INT TERM
echo $$ > "$PIDFILE"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) supervisor pid=$$ starting (watchdog ${STALE_SEC}s)" >> "$LOG"
while true; do
  date +%s%3N > "$HB"
  node_modules/.bin/tsx src/onchain/graduation.ts >> "$LOG" 2>&1 &
  CHILD=$!
  last_tick=$(date +%s)
  grace_until=$(( last_tick + STALE_SEC ))
  while kill -0 "$CHILD" 2>/dev/null; do
    sleep 15 & wait $!
    now=$(date +%s)
    if (( now - last_tick > 90 )); then
      # The box was paused: do not count frozen time against the trader.
      grace_until=$(( now + STALE_SEC ))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) watchdog: clock jumped $(( now - last_tick ))s (box pause), grace ${STALE_SEC}s" >> "$LOG"
    fi
    last_tick=$now
    hb_age=$(( now - $(stat -c %Y "$HB" 2>/dev/null || echo "$now") ))
    if (( hb_age > STALE_SEC && now > grace_until )); then
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) watchdog: no heartbeat for ${hb_age}s, killing stuck trader pid=$CHILD" >> "$LOG"
      kill_child KILL
      break
    fi
  done
  wait "$CHILD" 2>/dev/null
  code=$?
  CHILD=""
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) trader exited code=${code}, restarting in 15s" >> "$LOG"
  sleep 15
done
