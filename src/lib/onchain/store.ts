import fs from "node:fs";
import path from "node:path";
import { updateLedger } from "../store";
import { SLEEVE_USD, emptyOnchain, type OnchainState } from "./model";

const file = path.join(process.cwd(), "data", "onchain.json");

export function readOnchain(now = Date.now()): OnchainState {
  if (!fs.existsSync(file)) return emptyOnchain(now, 0);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as OnchainState;
    if (parsed.version !== 1 || !parsed.wallets || !Array.isArray(parsed.positions)) return emptyOnchain(now, 0);
    parsed.recent ??= [];
    parsed.pending ??= [];
    parsed.logs ??= [];
    parsed.fills ??= [];
    return parsed;
  } catch {
    return emptyOnchain(now, 0);
  }
}

export function writeOnchain(state: OnchainState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

/** Move the sleeve out of book cash once. Later ticks reuse the same reservation. */
export async function ensureSleeve(now = Date.now()): Promise<OnchainState> {
  const reserved = await updateLedger((ledger) => {
    if (ledger.onchainReserved == null) {
      const take = Math.min(SLEEVE_USD, Math.max(0, ledger.account.cash));
      ledger.account.cash -= take;
      ledger.account.dayStartEquity = Math.max(0, ledger.account.dayStartEquity - take);
      ledger.account.peakEquity = Math.max(0, ledger.account.peakEquity - take);
      ledger.onchainReserved = take;
      ledger.account.audits.unshift({
        id: crypto.randomUUID(),
        ts: now,
        level: "info",
        kind: "onchain",
        message: `Reserved $${take.toFixed(2)} of paper cash for the on-chain sleeve. The Dubai-day baseline moves with it, so the transfer is not a trading loss. No wallet key is loaded and nothing is signed.`,
      });
    }
    return ledger.onchainReserved;
  });
  const state = readOnchain(now);
  if (state.startedAt == null || state.principal === 0) {
    const opened = emptyOnchain(now, reserved);
    opened.cash = reserved;
    if (reserved < SLEEVE_USD) {
      opened.logs.unshift({
        id: `${now}-reserve`,
        ts: now,
        kind: "info",
        message: `Only $${reserved.toFixed(2)} of book cash was free to reserve. The sleeve target is $${SLEEVE_USD.toFixed(0)}.`,
      });
    }
    writeOnchain(opened);
    return opened;
  }
  return state;
}
