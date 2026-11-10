import { describe, expect, it } from "vitest";
import { HARD_MAX_LEVERAGE, borrowCost, clampLeverage, exposureCapPct, liquidationPrice, marginAndBorrow } from "./margin";

describe("isolated margin at a 2× ceiling", () => {
  it("refuses anything above 2× even if a saved cap is higher", () => {
    expect(HARD_MAX_LEVERAGE).toBe(2);
    expect(clampLeverage(3, 5)).toBe(2);
    expect(clampLeverage(2, 2)).toBe(2);
    expect(clampLeverage(1, 2)).toBe(1);
  });

  it("doubles notional capacity at 2× and leaves the margin budget unchanged", () => {
    expect(exposureCapPct(0.1, 1)).toBeCloseTo(0.1);
    expect(exposureCapPct(0.1, 2)).toBeCloseTo(0.2);
    const { margin, borrowed } = marginAndBorrow(10_000, 2);
    expect(margin).toBeCloseTo(5_000);
    expect(borrowed).toBeCloseTo(5_000);
  });

  it("puts a 2× long liquidation just under a 50% drop", () => {
    const liq = liquidationPrice(100, 2);
    expect(liq).not.toBeNull();
    expect(liq!).toBeGreaterThan(50);
    expect(liq!).toBeLessThan(51);
    expect(liquidationPrice(100, 1)).toBeNull();
  });

  it("charges borrow on the borrowed half only", () => {
    const day = borrowCost(5_000, 0.00010968, 86_400_000);
    expect(day).toBeCloseTo(5_000 * 0.00010968, 8);
    expect(borrowCost(0, 0.00010968, 86_400_000)).toBe(0);
  });
});