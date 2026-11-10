import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, DEFAULT_PRINCIPAL } from "../defaults";
import { floorToStep, sizeLongSpot } from "./sizing";

const common = {
  equity: DEFAULT_PRINCIPAL,
  limits: DEFAULT_LIMITS,
  feeBps: 10,
  currentQty: 0,
  peakEquity: DEFAULT_PRINCIPAL,
  dayStartEquity: DEFAULT_PRINCIPAL,
  dailyKillLatched: false,
  drawdownKillLatched: false,
};

describe("spot sizing for $50,000", () => {
  it("sizes a 5% BTC stop inside the caps and above the OKX minimum", () => {
    const sized = sizeLongSpot({
      ...common,
      price: 70_000,
      stop: 66_500,
      minSz: 0.00001,
      lotSz: 0.00000001,
    });
    expect(sized.ok).toBe(true);
    expect(sized.qty).toBeGreaterThan(0.00001);
    expect(sized.notional).toBeLessThanOrEqual(5_000 + 1e-6);
    expect(sized.risk ?? 0).toBeLessThanOrEqual(200 + 1e-6);
  });

  it("cuts a tight stop down to the position cap instead of spending the whole risk budget", () => {
    const sized = sizeLongSpot({
      ...common,
      price: 70_000,
      stop: 69_300,
      minSz: 0.00001,
      lotSz: 0.00000001,
    });
    expect(sized.ok).toBe(true);
    expect(sized.notional).toBeLessThanOrEqual(5_000 + 1e-4);
    expect(sized.riskPct ?? 1).toBeLessThan(0.004);
  });

  it("refuses to round up to the exchange minimum", () => {
    const sized = sizeLongSpot({
      ...common,
      price: 100,
      stop: 10,
      minSz: 10,
      lotSz: 1,
    });
    expect(sized.ok).toBe(false);
    expect(sized.qty).toBe(0);
    expect(sized.reasons.join(" ")).toMatch(/will not round up/);
  });

  it("floors to the lot and never rounds up", () => {
    expect(floorToStep(1.239, 0.01)).toBe(1.23);
    expect(floorToStep(0.000019, 0.00001)).toBe(0.00001);
  });
});
