import { describe, expect, it } from "vitest";
import { freshLedger } from "../store";
import type { Candle } from "../types";
import { applyTraderBar } from "./step";

function rise(count: number, start: number): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i += 1) {
    price += 1;
    out.push({
      time: Date.UTC(2026, 8, 1) + i * 60 * 60_000,
      open: price - 0.5,
      high: price + 0.4,
      low: price - 0.6,
      close: price,
      volume: 10,
    });
  }
  return out;
}

describe("paper auto-trader", () => {
  it("buys through the paper book on a new bar and does not repeat that bar", () => {
    const ledger = freshLedger(Date.UTC(2026, 8, 1));
    ledger.trader = { enabled: true, assignments: [], lastBar: {}, lastTickAt: null, lastError: null };
    const candles = rise(40, 100);
    const job = {
      symbol: "BTC-USDT",
      strategyId: "ema-momentum",
      bar: "1H",
      params: { fast: 3, slow: 8, atrPeriod: 5, atrMult: 4, rewardRisk: 2 },
      filters: { trend: false, volatility: false, trail: false },
      armed: true,
      note: "test",
    };
    const quote = { bid: candles.at(-1)!.close - 0.1, ask: candles.at(-1)!.close + 0.1, last: candles.at(-1)!.close };
    const spec = { minSz: 0.00001, lotSz: 0.00000001 };
    const first = applyTraderBar(ledger, job, candles, quote, spec);
    expect(first.skipped).toBe(false);
    const second = applyTraderBar(ledger, job, candles, quote, spec);
    expect(second.skipped).toBe(true);
    expect(ledger.account.audits.some((item) => item.kind === "trader")).toBe(true);
    expect(ledger.account.fills.every((fill) => fill.route === "paper")).toBe(true);
    expect(ledger.account.positions.length).toBeLessThanOrEqual(1);
  });

  it("does nothing while the switch is off", () => {
    const ledger = freshLedger();
    const candles = rise(10, 50);
    const result = applyTraderBar(ledger, {
      symbol: "ETH-USDT",
      strategyId: "mean-reversion",
      bar: "1H",
      params: { period: 8, entryZ: 1, exitZ: 0.2, atrPeriod: 5, atrMult: 2 },
      filters: { trend: false, volatility: false, trail: false },
      armed: true,
      note: "",
    }, candles, { bid: 60, ask: 60.1, last: 60 }, { minSz: 0, lotSz: 0 });
    expect(result.skipped).toBe(true);
    expect(ledger.account.positions).toHaveLength(0);
  });

  it("refuses a new buy when the daily loss switch is on", () => {
    const ledger = freshLedger(Date.UTC(2026, 8, 1));
    ledger.account.dailyKillLatched = true;
    ledger.account.dayStartEquity = 50_000;
    ledger.trader = { enabled: true, assignments: [], lastBar: {}, lastTickAt: null, lastError: null };
    const candles = rise(30, 100);
    candles.push({
      time: candles[candles.length - 1].time + 60 * 60_000,
      open: 100,
      high: 140,
      low: 100,
      close: 140,
      volume: 10,
    });
    const before = ledger.account.positions.length;
    applyTraderBar(ledger, {
      symbol: "BTC-USDT",
      strategyId: "ema-momentum",
      bar: "1H",
      params: { fast: 3, slow: 8, atrPeriod: 5, atrMult: 4, rewardRisk: 2 },
      filters: { trend: false, volatility: false, trail: false },
      armed: true,
      note: "",
    }, candles, { bid: 140, ask: 140.2, last: 140 }, { minSz: 0.00001, lotSz: 0.00000001 });
    expect(ledger.account.positions.length).toBe(before);
    expect(ledger.account.audits[0].message.toLowerCase()).toMatch(/kill|blocked|risk|hold|buy/);
  });
});
