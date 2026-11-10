import { stepOnchain } from "./model";
import { loadMarket } from "./sources";
import { ensureSleeve, readOnchain, writeOnchain } from "./store";

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export async function onchainTick(): Promise<string> {
  const now = Date.now();
  try {
    const state = await ensureSleeve(now);
    const input = await loadMarket(now);
    stepOnchain(state, input);
    writeOnchain(state);
    return state.lastError ?? "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : "On-chain tick failed.";
    try {
      const state = readOnchain(now);
      state.lastError = message;
      state.lastTickAt = now;
      writeOnchain(state);
    } catch {
      /* the next tick will try again */
    }
    return message;
  }
}

export function startOnchainLoop(): void {
  if (timer || process.env.ONCHAIN_STANDALONE !== "1") return;
  timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void onchainTick().finally(() => {
      ticking = false;
    });
  }, 20_000);
}
