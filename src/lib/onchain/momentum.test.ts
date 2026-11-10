import { describe, expect, it } from "vitest";
import { emptyOnchain, stepOnchain, type TokenCheck } from "./model";
import { defaultMomentumConfig, evaluateMomentumSafety, momentumBreakout, replayPortfolio, type MomentumBar } from "./momentum";

function bar(time: number, close: number, volume: number, high = close, low = close * 0.99): MomentumBar {
  return { time, open: close, high, low, close, volume, buys: 10 };
}

function rising(): MomentumBar[] {
  const start = Date.UTC(2026, 10, 8);
  const bars: MomentumBar[] = [];
  for (let i = 0; i < 8; i += 1) {
    const close = 1 + i * 0.01;
    bars.push(bar(start + i * 5 * 60_000, close, 100, close, close * 0.995));
  }
  const prev = bars[bars.length - 1].close;
  bars.push({
    time: start + 8 * 5 * 60_000,
    open: prev,
    high: prev * 1.08,
    low: prev,
    close: prev * 1.06,
    volume: 500,
    buys: 40,
  });
  return bars;
}

function safeToken(over: Partial<TokenCheck> = {}): TokenCheck {
  return {
    address: "Mint111111111111111111111111111111111111111",
    symbol: "MEME",
    price: 1.06,
    quoteReserveUsd: 40_000,
    feeRate: 0.0025,
    ageMs: 60 * 60_000,
    graduated: true,
    mintRevoked: true,
    freezeRevoked: true,
    lpBurnedOrLocked: null,
    holders: null,
    devShare: null,
    devSelling: null,
    honeypot: null,
    sellProceedsUsd: 90,
    bundlerRate: null,
    sniperRate: null,
    liquidityUsd: 80_000,
    volumeUsd: 20_000,
    wash: null,
    venue: "pumpswap",
    bars: rising(),
    buyTx5m: 40,
    buyTxAvg: 10,
    ...over,
  };
}

describe("meme momentum", () => {
  it("buys a breakout with a volume surge and does not require wallet scores", () => {
    const config = defaultMomentumConfig();
    expect(config.walletGate).toBe(false);
    const signal = momentumBreakout(rising(), config);
    expect(signal.ok).toBe(true);
    expect(evaluateMomentumSafety(safeToken()).pass).toBe(true);
    expect(evaluateMomentumSafety(safeToken({ mintRevoked: false })).pass).toBe(false);
    expect(evaluateMomentumSafety(safeToken({ holders: null, devShare: null })).pass).toBe(true);
    const quiet = rising();
    quiet[quiet.length - 1].volume = 100;
    expect(momentumBreakout(quiet, config).ok).toBe(false);
  });

  it("takes the full position off at +20% of principal and stops a loser", () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const state = emptyOnchain(now);
    const sample = safeToken();
    stepOnchain(state, { now, trades: [], tokens: [sample], priorityUsd: 0.02, gmgn: false, solPriceNote: null });
    expect(state.pending).toHaveLength(1);
    stepOnchain(state, { now: now + 8_000, trades: [], tokens: [sample], priorityUsd: 0.02, gmgn: false, solPriceNote: null });
    expect(state.positions).toHaveLength(1);
    const spent = state.positions[0].spent;
    const winner = safeToken({ price: state.positions[0].avgCost * 1.25 });
    stepOnchain(state, { now: now + 60_000, trades: [], tokens: [winner], priorityUsd: 0.02, gmgn: false, solPriceNote: null });
    expect(state.positions).toHaveLength(0);
    expect(state.logs.some((log) => log.message.includes("Take profit at +20%"))).toBe(true);
    expect(state.cash).toBeGreaterThan(2_500 - spent + spent * 0.15);

    const again = emptyOnchain(now);
    stepOnchain(again, { now, trades: [], tokens: [sample], priorityUsd: 0.02, gmgn: false, solPriceNote: null });
    stepOnchain(again, { now: now + 8_000, trades: [], tokens: [sample], priorityUsd: 0.02, gmgn: false, solPriceNote: null });
    const loser = safeToken({ price: again.positions[0].avgCost * 0.9 });
    stepOnchain(again, { now: now + 60_000, trades: [], tokens: [loser], priorityUsd: 0.02, gmgn: false, solPriceNote: null });
    expect(again.positions).toHaveLength(0);
    expect(again.logs.some((log) => log.message.includes("Hard stop"))).toBe(true);
  });

  it("replays a winner and a loser on one sleeve", () => {
    const start = Date.UTC(2026, 10, 8);
    const up: MomentumBar[] = [];
    const down: MomentumBar[] = [];
    for (let i = 0; i < 10; i += 1) {
      const close = 1 + i * 0.002;
      up.push({ time: start + i * 5 * 60_000, open: close, high: close, low: close * 0.99, close, volume: 100, buys: 5 });
      down.push({ time: start + i * 5 * 60_000, open: close, high: close, low: close * 0.99, close, volume: 100, buys: 5 });
    }
    const breakoutTime = start + 10 * 5 * 60_000;
    up.push({ time: breakoutTime, open: 1.02, high: 1.08, low: 1.02, close: 1.07, volume: 800, buys: 30 });
    up.push({ time: breakoutTime + 5 * 60_000, open: 1.07, high: 1.4, low: 1.06, close: 1.35, volume: 200, buys: 10 });
    down.push({ time: breakoutTime, open: 1.02, high: 1.08, low: 1.02, close: 1.07, volume: 800, buys: 30 });
    down.push({ time: breakoutTime + 5 * 60_000, open: 1.07, high: 1.08, low: 0.9, close: 0.92, volume: 200, buys: 4 });
    const report = replayPortfolio([
      { symbol: "UP", address: "u", bars: up, quoteReserveUsd: 40_000, feeRate: 0.0025, safetyPass: true },
      { symbol: "DOWN", address: "d", bars: down, quoteReserveUsd: 40_000, feeRate: 0.0025, safetyPass: true },
      { symbol: "RUGGED", address: "r", bars: up, quoteReserveUsd: 40_000, feeRate: 0.0025, safetyPass: false },
    ], defaultMomentumConfig(), 0.02);
    expect(report.excludedSafety).toBe(1);
    expect(report.trades.length).toBeGreaterThan(0);
    expect(report.trades.some((trade) => trade.reason === "take-profit" || trade.reason === "hard-stop")).toBe(true);
  });
});
