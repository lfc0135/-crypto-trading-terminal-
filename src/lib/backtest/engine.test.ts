import { describe, expect, it } from "vitest";
import type { Candle } from "../types";
import { runBacktest, type Signal } from "./engine";
import { classifyDailyTarget } from "../targets";
import { DEFAULT_LIMITS } from "../defaults";

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1 };
}

describe("backtester", () => {
  it("fills a signal on the next open, not on the signal bar", () => {
    const candles = [
      candle(0, 100, 100, 100, 100),
      candle(60_000, 110, 110, 110, 110),
      candle(120_000, 130, 130, 130, 130),
    ];
    let sawFuture = false;
    const result = runBacktest(candles, {
      onBar(ctx): Signal {
        if (ctx.history.some((bar) => bar.time > ctx.bar.time)) sawFuture = true;
        if (ctx.bar.close === 110) {
          return { action: "buy", qty: 1, stopLoss: 100, takeProfit: 500, reason: "test" };
        }
        return { action: "hold" };
      },
    }, {
      initialEquity: 50_000,
      principal: 50_000,
      feeBps: 0,
      slippageBps: 0,
      limits: { ...DEFAULT_LIMITS, perTradeRiskPct: 1, maxPositionPct: 1, maxDailyLossPct: 1, maxDrawdownPct: 1 },
      barDurationMs: 60_000,
    });
    expect(sawFuture).toBe(false);
    expect(result.trades).toHaveLength(0);
    expect(result.endingEquity).toBeCloseTo(50_000, 1);
  });

  it("uses the following open as the fill when another bar exists", () => {
    const candles = [
      candle(0, 100, 100, 100, 105),
      candle(60_000, 120, 121, 119, 120),
      candle(120_000, 120, 120, 120, 120),
    ];
    const result = runBacktest(candles, {
      onBar(ctx): Signal {
        if (ctx.index === 0) return { action: "buy", qty: 1, stopLoss: 90, takeProfit: 500 };
        if (ctx.index === 1 && ctx.position) return { action: "close", fill: "this-close", reason: "flat" };
        return { action: "hold" };
      },
    }, {
      feeBps: 0,
      slippageBps: 0,
      limits: { ...DEFAULT_LIMITS, perTradeRiskPct: 1, maxPositionPct: 1, maxDailyLossPct: 1, maxDrawdownPct: 1 },
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryPrice).toBe(120);
    expect(result.trades[0].exitPrice).toBe(120);
    expect(result.trades[0].pnl).toBe(0);
  });

  it("fills the stop and ignores the target when both trade in the same bar", () => {
    const candles = [
      candle(0, 100, 100, 100, 100),
      candle(60_000, 100, 100, 100, 100),
      candle(120_000, 100, 130, 80, 100),
    ];
    const result = runBacktest(candles, {
      onBar(ctx): Signal {
        if (ctx.index === 0) return { action: "buy", qty: 1, stopLoss: 90, takeProfit: 120 };
        return { action: "hold" };
      },
    }, {
      feeBps: 0,
      slippageBps: 0,
      limits: { ...DEFAULT_LIMITS, perTradeRiskPct: 1, maxPositionPct: 1, maxDailyLossPct: 1, maxDrawdownPct: 1 },
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitPrice).toBe(90);
    expect(result.trades[0].reason).toMatch(/stop/);
    expect(result.trades[0].pnl).toBeCloseTo(-10, 6);
  });

  it("fills a gap through the stop at the open", () => {
    const candles = [
      candle(0, 100, 100, 100, 100),
      candle(60_000, 100, 100, 100, 100),
      candle(120_000, 70, 75, 60, 72),
    ];
    const result = runBacktest(candles, {
      onBar(ctx): Signal {
        if (ctx.index === 0) return { action: "buy", qty: 1, stopLoss: 90, takeProfit: 200 };
        return { action: "hold" };
      },
    }, {
      feeBps: 0,
      slippageBps: 0,
      limits: { ...DEFAULT_LIMITS, perTradeRiskPct: 1, maxPositionPct: 1, maxDailyLossPct: 1, maxDrawdownPct: 1 },
    });
    expect(result.trades[0].exitPrice).toBe(70);
    expect(result.trades[0].reason).toMatch(/gap/);
  });

  it("charges fees and reports a zero hit rate on a flat book", () => {
    const start = Date.UTC(2026, 10, 10, 8, 0, 0);
    const candles = Array.from({ length: 6 }, (_, i) => candle(start + i * 60 * 60_000, 100, 101, 99, 100));
    const result = runBacktest(candles, { onBar: () => ({ action: "hold" }) }, {
      initialEquity: 50_000,
      principal: 50_000,
      barDurationMs: 60 * 60_000,
      targets: { dailyLow: 0.02, dailyHigh: 0.03 },
    });
    expect(result.daily.insideBand).toBe(0);
    expect(result.daily.hitRate).toBe(0);
    expect(result.daily.belowBand).toBe(result.daily.days);
    expect(result.maxDrawdownPct).toBe(0);
    expect(result.sharpe).toBe(0);
    expect(result.assumptions.length).toBeGreaterThan(3);
  });

  it("counts a day inside the band only when P&L on principal is between 2% and 3%", () => {
    const day1 = Date.UTC(2026, 10, 10, 8, 0, 0);
    const day2 = Date.UTC(2026, 10, 11, 8, 0, 0);
    const report = classifyDailyTarget(
      [
        { time: day1, equity: 51_250 },
        { time: day2, equity: 53_000 },
      ],
      50_000,
      50_000,
      { low: 0.02, high: 0.03 },
    );
    expect(report.rows[0].outcome).toBe("inside");
    expect(report.rows[0].returnOnPrincipal).toBeCloseTo(0.025, 6);
    expect(report.rows[1].outcome).toBe("above");
    expect(report.insideBand).toBe(1);
    expect(report.aboveBand).toBe(1);
    expect(report.hitRate).toBe(0.5);
    expect(report.floorRate).toBe(1);
  });

  it("rejects an entry the risk engine will not take", () => {
    const candles = [
      candle(0, 100, 100, 100, 100),
      candle(60_000, 100, 100, 100, 100),
    ];
    const result = runBacktest(candles, {
      onBar: (ctx) => (ctx.index === 0 ? { action: "buy", qty: 400, stopLoss: 99 } : { action: "hold" }),
    }, { initialEquity: 50_000, principal: 50_000 });
    expect(result.rejectedEntries).toBeGreaterThan(0);
    expect(result.closedTrades).toBe(0);
  });
});
