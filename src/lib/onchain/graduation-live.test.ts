import { describe, expect, it } from "vitest";
import { DAILY_LOSS_PAUSE_USD, ENTRY, LIVE_TRADE_USD, RULE_ID, eligible } from "./graduation-live";

const SOL = "So11111111111111111111111111111111111111112";
const g = (over: Partial<Parameters<typeof eligible>[0]> = {}) => ({ token: "Abcpump", pool: "P", symbol: "T", platform: "Pump.fun", exchange: "pump_amm", quote: SOL, gradMs: 1, liquidity: 20_000, ...over });

describe("graduation live paper", () => {
  it("sizes 6% of the $10k principal with a 10% daily loss pause", () => {
    expect(LIVE_TRADE_USD).toBe(600);
    expect(DAILY_LOSS_PAUSE_USD).toBe(1_000);
  });
  it("requires the first post-graduation 5-minute bar to close up on at least $5k volume", () => {
    expect(ENTRY.minGradVolUsd).toBe(5_000);
    expect(ENTRY.gradMinMs).toBe(5 * 60_000);
    expect(ENTRY.gradMaxMs).toBe(30 * 60_000);
    expect(RULE_ID).toBe("g-grad-vol5k-half20-trail12");
  });
  it("watches pump.fun graduates on PumpSwap quoted in SOL, with no rug filter", () => {
    expect(eligible(g()).ok).toBe(true);
    expect(eligible(g({ platform: "pump_mayhem" })).ok).toBe(true);
    expect(eligible(g({ platform: "meteora_virtual_curve", exchange: "meteora_damm_v2", token: "Xyz" })).ok).toBe(false);
    expect(eligible(g({ quote: "5dReBkDjES5SyRuasNHytYDmCqdupyoWTRUSTRgtpump" })).ok).toBe(false);
  });
});
