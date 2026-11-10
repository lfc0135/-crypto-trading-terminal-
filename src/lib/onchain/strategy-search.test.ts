import { describe, expect, it } from "vitest";
import { admit, candidates, simulate, thinSlip, type Bar, type Tape } from "./strategy-search";

const M = 5 * 60_000;
function tape(prices: [number, number, number, number, number][], extra: Partial<Tape> = {}): Tape {
  const t0 = Date.parse("2026-11-01T00:00:00Z");
  const bars: Bar[] = prices.map(([o, h, l, c, v], i) => ({ time: t0 + i * M, open: o, high: h, low: l, close: c, volume: v }));
  return { symbol: "TST", pool: "pool1", bars, quoteReserveUsd: 500_000, createdMs: t0, rugged: false, ...extra };
}

describe("strategy search engine", () => {
  it("charges more slippage on thin pools", () => {
    expect(thinSlip(10_000)).toBeGreaterThan(thinSlip(100_000));
    expect(thinSlip(100_000)).toBeGreaterThan(thinSlip(1_000_000));
  });

  it("enters a graduation only when the first bar closes up on enough volume", () => {
    const t0 = Date.parse("2026-11-01T00:00:00Z");
    const up = tape([[1, 1.2, 0.95, 1.1, 30_000], [1.1, 1.15, 1.05, 1.12, 20_000], [1.12, 1.2, 1.1, 1.18, 20_000], [1.18, 1.2, 1.1, 1.15, 10_000]], { graduatedMs: t0 });
    const c = candidates(up, { family: "graduation", minGradVolUsd: 25_000 });
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c[0].stop).toBeCloseTo(1.1 * 0.995, 6); // bar 0 low is the init print; its close counts
    const thin = candidates(up, { family: "graduation", minGradVolUsd: 50_000 });
    expect(thin.length).toBe(0);
    const down = tape([[1, 1.1, 0.9, 0.95, 30_000], [0.95, 1, 0.9, 0.99, 20_000], [0.99, 1, 0.9, 0.98, 20_000]], { graduatedMs: t0 });
    expect(candidates(down, { family: "graduation", minGradVolUsd: 10_000 }).length).toBe(0);
  });

  it("sells half at the target and trails the rest", () => {
    const t = tape([[1, 1, 1, 1, 1e5], [1, 1, 1, 1, 1e5], [1, 1.05, 0.99, 1.04, 1e5], [1.04, 1.3, 1.03, 1.28, 1e5], [1.28, 1.5, 1.27, 1.45, 1e5], [1.45, 1.46, 1.2, 1.25, 1e5], [1.25, 1.3, 1.2, 1.25, 1e5]]);
    const trade = simulate(t, { pool: "pool1", symbol: "TST", signalTime: t.bars[1].time, fillIdx: 2, stop: 0.95, target: null, rugged: false }, {
      useStructureStop: true, takeProfit: 0.2, scaleFraction: 0.5, trailActivate: 0.2, trailPct: 0.12, maxHoldMs: 3 * 3_600_000,
    });
    expect(trade?.reason).toBe("trail-stop");
    expect(trade!.pnlUsd).toBeGreaterThan(0);
  });

  it("admits at most five open trades and one per pool", () => {
    const base = Date.parse("2026-11-01T00:00:00Z");
    const rows = Array.from({ length: 8 }, (_, i) => ({ symbol: `S${i}`, pool: i < 2 ? "same" : `p${i}`, rugged: false, entryTime: base + i, exitTime: base + 3_600_000, pnlUsd: 1, pnlPct: 0.01, reason: "x" }));
    const taken = admit(rows, base, base + 86_400_000);
    expect(taken.length).toBe(5);
    expect(taken.filter((t) => t.pool === "same").length).toBe(1);
  });
});
