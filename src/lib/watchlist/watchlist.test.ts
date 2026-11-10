import { describe, expect, it } from "vitest";
import { DEFAULT_GMGN_RULES, DEFAULT_WATCH_RULES } from "../defaults";
import type { OkxTicker } from "../types";
import { evaluateGmgnCandidate, normalizeTax, parseSecurity } from "./gmgn-filter";
import { isEligibleSpot, rankOkxSpot } from "./rank";
import { leverageReview } from "../trading/review";
import { dubaiMonthStartUtc } from "../time";

function ticker(instId: string, last: number, open24h: number, quote: number): OkxTicker {
  return {
    instId,
    last,
    open24h,
    bid: last - 0.1,
    ask: last + 0.1,
    high24h: last,
    low24h: open24h,
    quoteVolume24h: quote,
    baseVolume24h: quote / last,
    ts: 0,
  };
}

describe("dynamic OKX watchlist", () => {
  it("pins BTC, ETH, and SOL and ranks other liquid USDT pairs by volume and momentum", () => {
    const rows = rankOkxSpot([
      ticker("BTC-USDT", 70_000, 69_000, 2_000_000_000),
      ticker("ETH-USDT", 3_500, 3_400, 800_000_000),
      ticker("SOL-USDT", 180, 176, 400_000_000),
      ticker("JUP-USDT", 1, 0.8, 80_000_000),
      ticker("DOGE-USDT", 0.2, 0.19, 90_000_000),
      ticker("TINY-USDT", 1, 2, 100_000),
      ticker("ETH3L-USDT", 1, 0.5, 5_000_000_000),
      ticker("USDC-USDT", 1, 1, 9_000_000_000),
      ticker("BTC-USDT-SWAP", 70_000, 69_000, 9_000_000_000),
    ], DEFAULT_WATCH_RULES);
    expect(rows.slice(0, 3).map((row) => row.instId)).toEqual(["BTC-USDT", "ETH-USDT", "SOL-USDT"]);
    expect(rows.slice(0, 3).every((row) => row.role === "core")).toBe(true);
    const ids = rows.map((row) => row.instId);
    expect(ids).toContain("JUP-USDT");
    expect(ids).not.toContain("TINY-USDT");
    expect(ids).not.toContain("ETH3L-USDT");
    expect(ids).not.toContain("USDC-USDT");
    expect(ids).not.toContain("BTC-USDT-SWAP");
    expect(isEligibleSpot("JUP-USDT")).toBe(true);
  });

  it("lets a larger 24h move outrank a slightly larger quiet volume", () => {
    const quiet = ticker("AAA-USDT", 10, 10, 50_000_000);
    const moving = ticker("BBB-USDT", 12, 10, 48_000_000);
    const ranked = rankOkxSpot([quiet, moving, ticker("BTC-USDT", 1, 1, 1)], {
      ...DEFAULT_WATCH_RULES,
      coreInstIds: ["BTC-USDT"],
      topN: 2,
      minQuoteVolumeUsd: 1_000_000,
    });
    const trend = ranked.filter((row) => row.role === "trend").map((row) => row.instId);
    expect(trend[0]).toBe("BBB-USDT");
  });
});

describe("GMGN safety screen", () => {
  const clean = {
    chain: "sol" as const,
    address: "Mint111111111111111111111111111111111111111",
    symbol: "OK",
    name: "Ok",
    price: 1,
    liquidity: 200_000,
    marketCap: 1_000_000,
    volume: 80_000,
    priceChangePercent: 4,
    holderCount: 800,
    top10HolderRate: 0.18,
    rugRatio: 0.02,
    isWashTrading: false,
    isShowAlert: false,
    renouncedMint: true,
    renouncedFreeze: true,
  };
  const security = {
    honeypot: false,
    buyTax: 0,
    sellTax: 0,
    renouncedMint: true,
    canNotSell: false,
    isBlacklist: false,
    isShowAlert: false,
  };

  it("passes a liquid token with clear contract flags", () => {
    const result = evaluateGmgnCandidate(clean, security, DEFAULT_GMGN_RULES);
    expect(result.pass).toBe(true);
  });

  it("rejects thin liquidity, concentrated holders, honeypots, and missing clearance", () => {
    expect(evaluateGmgnCandidate({ ...clean, liquidity: 10_000 }, security, DEFAULT_GMGN_RULES).pass).toBe(false);
    expect(evaluateGmgnCandidate({ ...clean, top10HolderRate: 0.55 }, security, DEFAULT_GMGN_RULES).failures.join(" ")).toMatch(/Top 10/);
    expect(evaluateGmgnCandidate(clean, { ...security, honeypot: true }, DEFAULT_GMGN_RULES).failures.join(" ")).toMatch(/Honeypot/);
    expect(evaluateGmgnCandidate(clean, null, DEFAULT_GMGN_RULES).failures.join(" ")).toMatch(/unverified/);
    expect(evaluateGmgnCandidate({ ...clean, renouncedMint: null }, { ...security, renouncedMint: false }, DEFAULT_GMGN_RULES).pass).toBe(false);
  });

  it("normalizes tax units and reads the honeypot field GMGN actually returns", () => {
    expect(normalizeTax(0)).toBe(0);
    expect(normalizeTax(5)).toBe(0.05);
    expect(normalizeTax(0.02)).toBe(0.02);
    const parsed = parseSecurity({ honeypot: 0, is_honeypot: null, buy_tax: 0, sell_tax: 0, renounced_mint: true, can_not_sell: 0 });
    expect(parsed?.honeypot).toBe(false);
    expect(parsed?.renouncedMint).toBe(true);
  });
});

describe("leverage review", () => {
  it("stays closed on a new book", () => {
    const now = Date.UTC(2026, 10, 10, 8, 0, 0);
    const review = leverageReview({
      createdAt: now - 10 * 24 * 60 * 60 * 1000,
      now,
      fills: [],
      observedDrawdownPct: 0,
      drawdownLimitPct: 0.08,
      drawdownKillEver: false,
      requiredMonths: 3,
    });
    expect(review.eligible).toBe(false);
    expect(review.streak).toBe(0);
  });

  it("opens only after three profitable completed months inside the drawdown limit", () => {
    const createdAt = dubaiMonthStartUtc("2026-01") - 1;
    const now = dubaiMonthStartUtc("2026-05") + 24 * 60 * 60 * 1000;
    const month = (key: string, pnl: number) => ({ ts: dubaiMonthStartUtc(key) + 10 * 24 * 60 * 60 * 1000, realizedPnl: pnl });
    const good = leverageReview({
      createdAt,
      now,
      fills: [month("2026-02", 100), month("2026-03", 50), month("2026-04", 25)],
      observedDrawdownPct: 0.04,
      drawdownLimitPct: 0.08,
      drawdownKillEver: false,
      requiredMonths: 3,
    });
    expect(good.eligible).toBe(true);
    expect(good.streak).toBe(3);
    const broken = leverageReview({
      ...{
        createdAt,
        now,
        observedDrawdownPct: 0.04,
        drawdownLimitPct: 0.08,
        drawdownKillEver: false,
        requiredMonths: 3,
      },
      fills: [month("2026-02", 100), month("2026-03", -1), month("2026-04", 25)],
    });
    expect(broken.eligible).toBe(false);
    expect(broken.streak).toBe(1);
  });
});
