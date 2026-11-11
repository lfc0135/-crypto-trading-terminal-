#!/usr/bin/env bash
# Persistent paper desk on a plain Linux box. No Docker and no systemd.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p run

if [[ ! -d node_modules ]]; then
  npm install
fi
if [[ ! -f .next/BUILD_ID ]]; then
  npm run build
fi

start_one() {
  local name="$1"
  local pidfile="run/${name}.pid"
  shift
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$pidfile"))"
    return
  fi
  TRADER_EMBEDDED=0 setsid nohup "$@" > "run/${name}.log" 2>&1 &
  echo $! > "$pidfile"
  echo "$name started (pid $(cat "$pidfile"), log run/${name}.log)"
}

start_one server npx next start -p 43123 -H 0.0.0.0
TRADER_STANDALONE=1 start_one trader npx tsx src/trader/main.ts
ONCHAIN_STANDALONE=1 start_one onchain npx tsx src/onchain/main.ts
# Graduation-window paper trader (the only active on-chain strategy). It has its own restart loop and pid file.
if [[ -f run/graduation.pid ]] && kill -0 "$(cat run/graduation.pid)" 2>/dev/null; then
  echo "graduation already running (pid $(cat run/graduation.pid))"
else
  setsid nohup bash scripts/graduation-loop.sh > /dev/null 2>&1 &
  sleep 1
  echo "graduation started (pid $(cat run/graduation.pid 2>/dev/null), log run/graduation.log, journal data/graduation/journal.jsonl)"
fi
echo "Desk: http://127.0.0.1:43123"
echo "Day score: curl -s http://127.0.0.1:43123/api/summary"
echo "Graduation results: npx tsx scripts/graduation-report.ts"
