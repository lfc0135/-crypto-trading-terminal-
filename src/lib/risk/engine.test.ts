import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, DEFAULT_PRINCIPAL } from "../defaults";
import { evaluateOrder } from "./engine";

const base = {
  equity: DEFAULT_PRINCIPAL,
  peakEquity: DEFAULT_PRINCIPAL,
  dayStartEquity: DEFAULT_PRINCIPAL,
  limits: DEFAULT_LIMITS,
  dailyKillLatched: false,
  drawdownKillLatched: false,
};

describe("risk engine at a $50,000 principal", () => {
  it("expresses the default caps in dollars that fit this book", () => {
    expect(DEFAULT_PRINCIPAL * DEFAULT_LIMITS.maxPositionPct).toBe(5_000);
    expect(DEFAULT_PRINCIPAL * DEFAULT_LIMITS.perTradeRiskPct).toBe(200);
    expect(DEFAULT_PRINCIPAL * DEFAULT_LIMITS.maxDailyLossPct).toBe(750);
    expect(DEFAULT_PRINCIPAL * DEFAULT_LIMITS.maxDrawdownPct).toBe(4_000);
    expect(DEFAULT_LIMITS.maxLeverage).toBe(2);
    expect(DEFAULT_PRINCIPAL * DEFAULT_LIMITS.maxPositionPct * DEFAULT_LIMITS.maxLeverage).toBe(10_000);
  });

  it("allows a stopped spot buy inside the position and risk caps", () => {
    const decision = evaluateOrder({
      ...base,
      order: {
        side: "buy",
        qty: 0.05,
        price: 70_000,
        leverage: 1,
        stopLoss: 66_500,
        currentQty: 0,
        feeBps: 10,
      },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.metrics.positionPct).toBeLessThanOrEqual(0.1);
    expect(decision.metrics.tradeRiskPct ?? 1).toBeLessThanOrEqual(0.004);
  });

  it("allows 2× and rejects anything above the hard ceiling", () => {
    const order = {
      side: "buy" as const,
      qty: 0.01,
      price: 70_000,
      leverage: 2,
      stopLoss: 66_000,
      currentQty: 0,
      feeBps: 10,
    };
    expect(evaluateOrder({ ...base, order }).allowed).toBe(true);
    const tooHigh = evaluateOrder({
      ...base,
      limits: { ...DEFAULT_LIMITS, maxLeverage: 2 },
      order: { ...order, leverage: 3 },
    });
    expect(tooHigh.allowed).toBe(false);
    expect(tooHigh.reasons.join(" ")).toMatch(/ceiling/);
  });

  it("rejects notional above the margin cap times leverage", () => {
    const decision = evaluateOrder({
      ...base,
      order: {
        side: "buy",
        qty: 0.2,
        price: 70_000,
        leverage: 2,
        stopLoss: 66_000,
        currentQty: 0,
        feeBps: 10,
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.metrics.positionPct).toBeGreaterThan(0.2);
    expect(decision.metrics.exposureCapPct).toBeCloseTo(0.2);
  });

  it("treats a missing stop as full-notional risk", () => {
    const small = evaluateOrder({
      ...base,
      order: { side: "buy", qty: 0.001, price: 70_000, leverage: 1, stopLoss: null, currentQty: 0, feeBps: 10 },
    });
    expect(small.allowed).toBe(true);
    const large = evaluateOrder({
      ...base,
      order: { side: "buy", qty: 0.02, price: 70_000, leverage: 1, stopLoss: null, currentQty: 0, feeBps: 10 },
    });
    expect(large.allowed).toBe(false);
    expect(large.reasons.join(" ")).toMatch(/per-trade/);
  });

  it("rejects a stop that is not below the entry", () => {
    const decision = evaluateOrder({
      ...base,
      order: { side: "buy", qty: 0.01, price: 100, leverage: 1, stopLoss: 105, currentQty: 0, feeBps: 10 },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/below/);
  });

  it("blocks new risk when the daily loss or drawdown switch is on, and still allows a reduction", () => {
    const buy = evaluateOrder({
      ...base,
      equity: 49_200,
      dailyKillLatched: true,
      order: { side: "buy", qty: 0.01, price: 70_000, leverage: 1, stopLoss: 66_000, currentQty: 0, feeBps: 10 },
    });
    expect(buy.allowed).toBe(false);
    const drawdownBuy = evaluateOrder({
      ...base,
      equity: 45_000,
      peakEquity: 50_000,
      order: { side: "buy", qty: 0.01, price: 70_000, leverage: 1, stopLoss: 66_000, currentQty: 0, feeBps: 10 },
    });
    expect(drawdownBuy.metrics.drawdownKill).toBe(true);
    expect(drawdownBuy.allowed).toBe(false);
    const reduce = evaluateOrder({
      ...base,
      equity: 45_000,
      peakEquity: 50_000,
      dailyKillLatched: true,
      order: { side: "sell", qty: 0.02, price: 70_000, leverage: 1, stopLoss: null, currentQty: 0.05, feeBps: 10 },
    });
    expect(reduce.allowed).toBe(true);
    expect(reduce.metrics.reducing).toBe(true);
  });

  it("refuses a spot short", () => {
    const decision = evaluateOrder({
      ...base,
      order: { side: "sell", qty: 1, price: 100, leverage: 1, stopLoss: null, currentQty: 0, feeBps: 10 },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/short/i);
  });
});
