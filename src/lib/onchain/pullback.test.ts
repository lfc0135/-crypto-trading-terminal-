import { describe, expect, it } from "vitest";
import { defaultMomentumConfig, normalizeConfig, presetPatch, replayPortfolio, type MomentumBar } from "./momentum";
import { classifyRug, estimateQuoteReserve, fifteenDayNet, momentumPullback, pullbackEntries } from "./pullback";

function bar(time: number, close: number, volume: number, high = close, low = close * 0.995, open = close): MomentumBar {
  return { time, open, high, low, close, volume };
}

/** Quiet base, a +35% volume spike, a 40%+ retrace, then a higher-low reclaim. */
function pullbackTape(start: number): MomentumBar[] {
  const bars: MomentumBar[] = [];
  let t = start;
  for (let i = 0; i < 8; i += 1) {
    bars.push(bar(t, 1, 100, 1.01, 0.995, 1));
    t += 5 * 60_000;
  }
  const spike = [
    { close: 1.08, high: 1.09, low: 1.0, open: 1.0, vol: 500 },
    { close: 1.18, high: 1.2, low: 1.08, open: 1.08, vol: 700 },
    { close: 1.3, high: 1.35, low: 1.18, open: 1.18, vol: 900 },
  ];
  for (const row of spike) {
    bars.push(bar(t, row.close, row.vol, row.high, row.low, row.open));
    t += 5 * 60_000;
  }
  // Retrace of a 1.00 -> 1.35 leg: 40% comes in at 1.21. Dip to 1.18.
  bars.push(bar(t, 1.22, 200, 1.28, 1.18, 1.3));
  t += 5 * 60_000;
  // Higher low at 1.20, close back above the prior high 1.22.
  bars.push(bar(t, 1.26, 220, 1.27, 1.2, 1.22));
  t += 5 * 60_000;
  // Fill / follow-through for a +20% take-profit from ~1.26 would need 1.51. Give it room.
  bars.push(bar(t, 1.55, 180, 1.58, 1.25, 1.26));
  return bars;
}

describe("first pullback after a hype spike", () => {
  it("does not buy the spike itself and enters on the first higher low", () => {
    const start = Date.UTC(2026, 9, 30);
    const bars = pullbackTape(start);
    const spikeBar = bars[10]; // last spike bar, high 1.35
    expect(momentumPullback(bars.slice(0, 11), { retrace: 0.4, confirm: "higher-low" }).ok).toBe(false);
    expect(spikeBar.high).toBeGreaterThan(1.3);
    const confirm = momentumPullback(bars.slice(0, 13), { retrace: 0.4, confirm: "higher-low" });
    expect(confirm.ok).toBe(true);
    expect(confirm.pullbackLow).toBeCloseTo(1.18, 5);
    expect(confirm.stop).toBeLessThan(1.18);
    expect(confirm.stop).toBeGreaterThan(1.18 * 0.99);
    expect(pullbackEntries(bars, { retrace: 0.4, confirm: "higher-low" })).toHaveLength(1);
  });

  it("can also confirm with a VWAP reclaim after the retrace", () => {
    const start = Date.UTC(2026, 9, 30);
    const bars = pullbackTape(start);
    // Force a strong reclaim close on the last setup bar by extending the bounce.
    const t = bars[bars.length - 1].time + 5 * 60_000;
    const reclaim = [...bars.slice(0, 12), bar(t, 1.32, 400, 1.33, 1.21, 1.22)];
    const signal = momentumPullback(reclaim, { retrace: 0.4, confirm: "reclaim" });
    expect(signal.ok).toBe(true);
    expect(signal.pullbackLow).toBeLessThan(1.22);
  });

  it("drops the setup when price breaks the spike low, and keeps a later-rugged tape in the book", () => {
    const start = Date.UTC(2026, 9, 30);
    const bars = pullbackTape(start).slice(0, 12);
    const t = bars[bars.length - 1].time + 5 * 60_000;
    bars.push(bar(t, 0.4, 800, 1.2, 0.35, 1.18));
    expect(momentumPullback(bars, { retrace: 0.4, confirm: "higher-low" }).ok).toBe(false);

    const flushed = pullbackTape(start);
    const deadFrom = flushed[flushed.length - 1].time + 5 * 60_000;
    for (let i = 0; i < 12; i += 1) {
      flushed.push(bar(deadFrom + i * 5 * 60_000, 0.02, 12, 0.025, 0.015, 0.022));
    }
    const rug = classifyRug(flushed, 800);
    expect(rug.rugged).toBe(true);
    const hypeTime = flushed[10].time;
    const reserve = estimateQuoteReserve(flushed, hypeTime, 400);
    expect(reserve).toBeGreaterThan(3_000);
    const deadTime = flushed[flushed.length - 1].time;
    expect(estimateQuoteReserve(flushed, deadTime, 400)).toBeLessThan(1_000);
    const report = replayPortfolio([
      { symbol: "RUG", address: "r", bars: flushed, quoteReserveUsd: 400, feeRate: 0.0025, safetyPass: true },
    ], { ...defaultMomentumConfig(), entryMode: "pullback", retrace: 0.4, confirm: "higher-low", takeProfit: 0.2, maxHoldMs: 3 * 60 * 60_000 }, 0.02);
    expect(report.excludedSafety).toBe(0);
    expect(report.tradedNames).toBe(1);
    expect(report.trades.length).toBeGreaterThan(0);
  });

  it("leaves the default on breakout and compounds a 15-day figure from the daily rate", () => {
    expect(defaultMomentumConfig().entryMode).toBe("breakout");
    expect(normalizeConfig({}).entryMode).toBe("breakout");
    expect(presetPatch("classic-tp20")?.entryMode).toBe("breakout");
    expect(presetPatch("pullback-tp20")?.entryMode).toBe("pullback");
    expect(presetPatch("pullback-tp20")?.takeProfit).toBe(0.2);
    expect(fifteenDayNet(-0.0319, 10_000)).toBeCloseTo(10_000 * ((1 - 0.0319) ** 15 - 1), 6);
  });
});
