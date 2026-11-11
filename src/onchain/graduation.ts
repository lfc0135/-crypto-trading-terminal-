/**
 * Graduation-window LIVE PAPER trader. Paper only: no wallet, no signing, no orders, no live-trading switch.
 * GMGN is read with the read-only key for graduation detection; candles come from GeckoTerminal.
 * Journal: data/graduation/journal.jsonl. State: data/graduation/state.json.
 */
import { DAILY_LOSS_PAUSE_USD, LIVE_TRADE_USD, MAX_OPEN, PRINCIPAL_USD, RULE_ID, cycle, journal, loadState, saveState } from "../lib/onchain/graduation-live";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function main() {
  const state = loadState();
  saveState(state);
  journal("start", { rule: RULE_ID, principalUsd: PRINCIPAL_USD, tradeUsd: LIVE_TRADE_USD, maxOpen: MAX_OPEN, dailyLossPauseUsd: DAILY_LOSS_PAUSE_USD, mode: "paper", openPositions: state.positions.length, pid: process.pid });
  console.log(`${new Date().toISOString()} graduation paper trader started (rule ${RULE_ID}, $${PRINCIPAL_USD} paper principal, $${LIVE_TRADE_USD} a trade). Nothing is signed.`);
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
    const wait = Math.max(0, 10_000 - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  saveState(state);
  journal("stop", { reason: "signal" });
  console.log(`${new Date().toISOString()} graduation paper trader stopped`);
}

main().catch((error) => { console.error(error); process.exit(1); });
