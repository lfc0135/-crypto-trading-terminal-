/**
 * Graduation-window LIVE PAPER trader. Paper only: no wallet, no signing, no orders, no live-trading switch.
 * GMGN is read with the read-only key for graduation detection; candles come from GeckoTerminal.
 * Journal: data/graduation/journal.jsonl. State: data/graduation/state.json.
 */
import fs from "node:fs";
import path from "node:path";
import { DAILY_LOSS_PAUSE_USD, ENTRY, GMGN_BACKOFF_CAP_MS, GMGN_POLL_MS, LIVE_TRADE_USD, LOSS_CAP_PCT, MAX_OPEN, NET_TIMEOUT_MS, PRINCIPAL_USD, RULE_ID, THEMES, THEME_MAX_ENTRIES, THEME_MIN_GRAD_VOL_USD, THEME_TRADE_USD, THEME_WINDOW_MS, cycle, journal, loadState, saveState, setProgressHook } from "../lib/onchain/graduation-live";

// Heartbeat for the supervisor watchdog (scripts/graduation-loop.sh): touched after every unit of work and every cycle.
const RUN = path.join(process.cwd(), "run");
const HEARTBEAT = path.join(RUN, "graduation.heartbeat");
const TRADER_PID = path.join(RUN, "graduation-trader.pid");
fs.mkdirSync(RUN, { recursive: true });
const beat = () => { try { fs.writeFileSync(HEARTBEAT, String(Date.now())); } catch { /* ignore */ } };
setProgressHook(beat);

// Single instance: refuse to start if another live trader process holds the pid file.
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
if (fs.existsSync(TRADER_PID)) {
  const other = Number(fs.readFileSync(TRADER_PID, "utf8"));
  if (other && other !== process.pid && alive(other)) {
    let cmd = "";
    try { cmd = fs.readFileSync(`/proc/${other}/cmdline`, "utf8"); } catch { /* not linux */ }
    if (cmd.includes("graduation.ts")) { console.log(`${new Date().toISOString()} another trader (pid ${other}) is running; exiting`); process.exit(3); }
  }
}
fs.writeFileSync(TRADER_PID, String(process.pid));
beat();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main() {
  const state = loadState();
  if (state.rule === "g-grad-vol5k-half20-trail12") {
    journal("parameter-change", {
      ruleFrom: state.rule,
      ruleTo: RULE_ID,
      approvedBy: "Aayush, 12 Nov 2026",
      changes: [
        `per-trade loss cap: stop is never wider than ${LOSS_CAP_PCT * 100}% under the fill (existing stop kept if tighter), for the whole position incl. the half left after the scale-out; exit reason "loss-cap"`,
        `theme priority: graduations whose name/symbol/description match ${THEMES.map((t) => `${t.id}=${t.pattern.source}`).join(", ")} are processed first, size $${THEME_TRADE_USD} (not $${LIVE_TRADE_USD}), first-bar volume floor $${THEME_MIN_GRAD_VOL_USD} (not $${ENTRY.minGradVolUsd})`,
        `copycat limit: at most ${THEME_MAX_ENTRIES} tagged entries per theme in any rolling ${THEME_WINDOW_MS / 60_000} minutes`,
        "no re-entry: after a stop or loss-cap exit, the same normalized name/symbol or leading word is not entered again that Dubai day",
      ],
      unchanged: "entry 5-30 min, first bar up, fill bar opened within 2 min, structure stop 0.5% under post-grad low, half at +20%, 12% trail, 3h max hold, max 5 open, $1,000 daily loss pause, untagged $600 / $5k",
      ops: `reliability: ${NET_TIMEOUT_MS / 1000}s hard timeout on every request, GMGN poll every ${GMGN_POLL_MS / 1000}s with exponential back-off + jitter capped at ${GMGN_BACKOFF_CAP_MS / 60_000} min on 429/ban, exits managed before detection, heartbeat watchdog restarts a stuck trader after 5 min, single instance`,
      openPositions: state.positions.map((p) => p.symbol),
      closedTrades: state.closed.length,
      realizedPnlUsd: +state.closed.reduce((s, t) => s + t.pnlUsd, 0).toFixed(2),
      note: "paper only; journal, open positions and realized P&L kept. The cap also applies to positions already open.",
    });
    state.rule = RULE_ID;
  }
  if (state.rule !== RULE_ID) {
    journal("parameter-change", {
      field: "minGradVolUsd",
      from: 10_000,
      to: ENTRY.minGradVolUsd,
      ruleFrom: state.rule,
      ruleTo: RULE_ID,
      openPositions: state.positions.map((p) => p.symbol),
      closedTrades: state.closed.length,
      realizedPnlUsd: +state.closed.reduce((s, t) => s + t.pnlUsd, 0).toFixed(2),
      note: "first-bar volume threshold lowered to $5k; existing journal, open positions, and realized P&L kept",
    });
    state.rule = RULE_ID;
  }
  saveState(state);
  journal("start", { rule: RULE_ID, principalUsd: PRINCIPAL_USD, tradeUsd: LIVE_TRADE_USD, maxOpen: MAX_OPEN, dailyLossPauseUsd: DAILY_LOSS_PAUSE_USD, minGradVolUsd: ENTRY.minGradVolUsd, mode: "paper", openPositions: state.positions.length, pid: process.pid });
  console.log(`${new Date().toISOString()} graduation paper trader started (rule ${RULE_ID}, first-bar volume $${ENTRY.minGradVolUsd}, $${PRINCIPAL_USD} paper principal, $${LIVE_TRADE_USD} a trade). Nothing is signed.`);
  while (!stopping) {
    const started = Date.now();
    try {
      const line = await cycle(state);
      console.log(`${new Date().toISOString()} cycle ok ${line} elapsed=${Date.now() - started}ms`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      state.stats.lastError = msg;
      console.log(`${new Date().toISOString()} cycle error ${msg}`);
      journal("error", { message: msg });
    }
    saveState(state);
    beat();
    const wait = Math.max(0, 10_000 - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  saveState(state);
  journal("stop", { reason: "signal" });
  try { if (Number(fs.readFileSync(TRADER_PID, "utf8")) === process.pid) fs.unlinkSync(TRADER_PID); } catch { /* ignore */ }
  console.log(`${new Date().toISOString()} graduation paper trader stopped`);
}

main().catch((error) => { console.error(error); process.exit(1); });
