import fs from "node:fs";
import path from "node:path";
import { getCandles, getInstrument, getUsdtBorrowDailyRate } from "../brokers/okx";
import { updateLedger } from "../store";
import { ensureTrader } from "./step";
import { applyTraderBar } from "./step";

const lockFile = path.join(process.cwd(), "data", "trader.lock");
let timer: NodeJS.Timeout | null = null;
let ticking = false;

function holdLock(): boolean {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const now = Date.now();
  if (fs.existsSync(lockFile)) {
    const raw = fs.readFileSync(lockFile, "utf8");
    const [pid, ts] = raw.split(" ");
    if (pid !== String(process.pid) && now - Number(ts) < 20_000) return false;
  }
  fs.writeFileSync(lockFile, `${process.pid} ${now}`);
  return true;
}

export async function traderTick(): Promise<{ ran: boolean; messages: string[] }> {
  if (!holdLock()) return { ran: false, messages: ["another trader process holds the lock"] };
  const messages: string[] = [];
  await updateLedger(async (ledger) => {
    const trader = ensureTrader(ledger);
    trader.lastTickAt = Date.now();
    if (!trader.enabled) {
      messages.push("stopped");
      return;
    }
    const armed = trader.assignments.filter((job) => job.armed);
    if (armed.length === 0) {
      messages.push("no armed configs");
      trader.lastError = null;
      return;
    }
    let rate = 0.00010968;
    try {
      rate = await getUsdtBorrowDailyRate();
    } catch {
      /* frozen fallback inside the order path */
    }
    for (const job of armed) {
      try {
        const candles = await getCandles(job.symbol, job.bar, 400, false);
        const spec = await getInstrument(job.symbol);
        const last = candles[candles.length - 1];
        const quote = last ? { bid: last.close, ask: last.close, last: last.close } : { bid: 0, ask: 0, last: 0 };
        const result = applyTraderBar(ledger, job, candles, quote, { minSz: spec.minSz, lotSz: spec.lotSz }, rate);
        messages.push(`${job.symbol}: ${result.message}`);
        trader.lastError = null;
      } catch (error) {
        const message = error instanceof Error ? error.message : "tick failed";
        trader.lastError = message;
        messages.push(`${job.symbol}: ${message}`);
      }
    }
  });
  return { ran: true, messages };
}

export function startEmbeddedTrader(): void {
  if (timer || process.env.TRADER_EMBEDDED === "0") return;
  timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void traderTick().catch(() => undefined).finally(() => {
      ticking = false;
    });
  }, 30_000);
  timer.unref?.();
}
