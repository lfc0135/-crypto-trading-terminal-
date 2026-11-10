import { describe, expect, it } from "vitest";
import type { Candle } from "../types";
import { isFragileSpike, walkForward } from "./sweep";

function bar(time: number, close: number, span = 1): Candle {
  return { time, open: close - span / 2, high: close + span, low: close - span, close, volume: 1 };
}

describe("walk-forward sweep", () => {
  it("flags a lone parameter spike", () => {
    expect(isFragileSpike(10, [1, 1.2, 0.8, 1.1])).toBe(true);
    expect(isFragileSpike(2, [1.6, 1.8, 1.5, 1.7])).toBe(false);
  });

  it("selects on the training window and still reports the later window separately", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 500; i += 1) {
      const price = 100 + Math.sin(i / 5) * 8;
      candles.push(bar(Date.UTC(2026, 6, 1) + i * 60 * 60_000, price, 0.8));
    }
    const rows = walkForward({
      candles,
      bar: "1H",
      barMs: 60 * 60_000,
      strategyId: "mean-reversion",
      split: 0.7,
      minTrainTrades: 1,
      minTestTrades: 1,
      grid: [
        { params: { period: 10, entryZ: 0.8, exitZ: 0.1, atrPeriod: 8, atrMult: 3, rewardRisk: 1 }, filters: { trend: false, volatility: false, trail: false } },
        { params: { period: 20, entryZ: 1.5, exitZ: 0.2, atrPeriod: 8, atrMult: 3, rewardRisk: 1 }, filters: { trend: false, volatility: false, trail: false } },
      ],
    });
    const selected = rows.find((row) => row.selected);
    expect(selected).toBeTruthy();
    expect(selected?.test).toBeTruthy();
    expect(selected?.train.trades).toBeGreaterThan(0);
    expect(selected?.params.period === 10 || selected?.params.period === 20).toBe(true);
  });

  it("rejects a grid point that never trades", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 80; i += 1) candles.push(bar(Date.UTC(2026, 6, 1) + i * 60 * 60_000, 100, 0.2));
    const rows = walkForward({
      candles,
      bar: "1H",
      barMs: 60 * 60_000,
      strategyId: "ema-momentum",
      minTrainTrades: 8,
      grid: [{ params: { fast: 12, slow: 26, atrPeriod: 14, atrMult: 2.5, rewardRisk: 2 }, filters: { trend: false, volatility: false, trail: false } }],
    });
    expect(rows[0].selected).toBe(false);
    expect(rows[0].armed).toBe(false);
    expect(rows[0].rejectReason).toMatch(/training trades/);
  });
});
