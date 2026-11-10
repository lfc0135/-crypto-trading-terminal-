import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buyExecution,
  emptyOnchain,
  evaluateToken,
  exclusionReason,
  findClusters,
  priorityFeeUsd,
  simulateSell,
  statsFromCloses,
  stepOnchain,
  type ObservedTrade,
  type TokenCheck,
  type WalletStats,
} from "./model";
import { parseMintAuthorities } from "./sources";

const goodStats: WalletStats = { realizedPnl: 1_200, winRate: 0.6, trades: 18, medianHoldMs: 20 * 60_000 };

function token(over: Partial<TokenCheck> = {}): TokenCheck {
  return {
    address: "Mint111111111111111111111111111111111111111",
    symbol: "TEST",
    price: 1,
    quoteReserveUsd: 40_000,
    feeRate: 0.0025,
    ageMs: 60 * 60_000,
    graduated: true,
    mintRevoked: true,
    freezeRevoked: true,
    lpBurnedOrLocked: true,
    holders: Array.from({ length: 12 }, () => ({ share: 0.02, pool: false })),
    devShare: 0.01,
    devSelling: false,
    honeypot: null,
    sellProceedsUsd: 90,
    bundlerRate: 0.02,
    sniperRate: 0.01,
    liquidityUsd: 80_000,
    volumeUsd: 20_000,
    wash: false,
    venue: "raydium",
    ...over,
  };
}

function buy(wallet: string, ts: number): ObservedTrade {
  return {
    wallet,
    token: token().address,
    symbol: "TEST",
    side: "buy",
    ts,
    usd: 400,
    tags: ["smart_degen"],
    gmgn: goodStats,
  };
}

describe("on-chain paper rules", () => {
  it("fails closed when a safety field is missing and passes a complete token", () => {
    expect(evaluateToken(token({ holders: null })).pass).toBe(false);
    expect(evaluateToken(token({ lpBurnedOrLocked: null })).reasons.some((reason) => reason.includes("LP"))).toBe(true);
    expect(evaluateToken(token({ honeypot: true })).pass).toBe(false);
    expect(evaluateToken(token({ sellProceedsUsd: 0, honeypot: false })).pass).toBe(false);
    expect(evaluateToken(token()).pass).toBe(true);
  });

  it("drops bot, insider, and thin wallet histories", () => {
    expect(exclusionReason(["sniper"], goodStats)).toMatch(/sniper/);
    expect(exclusionReason(["rat_trader"], goodStats)).toMatch(/rat_trader/);
    const fast = Array.from({ length: 6 }, () => ({ pnl: 10, holdMs: 200, ts: Date.now() }));
    expect(exclusionReason([], statsFromCloses(fast, Date.now()))).toMatch(/2 seconds/);
    expect(exclusionReason([], null)).toMatch(/5 closed/);
    expect(exclusionReason(["smart_degen"], goodStats)).toBeNull();
  });

  it("needs three distinct scored wallets inside the window", () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const cluster = findClusters([buy("A", now - 60_000), buy("B", now - 50_000), buy("A", now - 40_000), buy("C", now - 10_000)], new Set(["A", "B", "C"]), now);
    expect(cluster).toHaveLength(1);
    expect(cluster[0].wallets).toHaveLength(3);
    expect(findClusters([buy("A", now - 60_000), buy("B", now - 50_000)], new Set(["A", "B"]), now)).toHaveLength(0);
  });

  it("fills later and worse than the signal, then stops, halves, and pauses", () => {
    const now = Date.UTC(2026, 10, 10, 12);
    const state = emptyOnchain(now);
    state.config = { ...state.config, walletGate: true };
    const sample = token();
    stepOnchain(state, { now, trades: [buy("A", now - 1_000), buy("B", now - 1_000), buy("C", now - 1_000)], tokens: [sample], priorityUsd: 0.02, gmgn: true, solPriceNote: null });
    expect(state.pending).toHaveLength(1);
    expect(state.positions).toHaveLength(0);
    const mid = sample.price!;
    stepOnchain(state, { now: now + 8_000, trades: [], tokens: [sample], priorityUsd: 0.02, gmgn: true, solPriceNote: null });
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].avgCost).toBeGreaterThan(mid);
    const bought = state.cash;

    const stop = token({ price: 0.6 });
    stepOnchain(state, { now: now + 20_000, trades: [], tokens: [stop], priorityUsd: 0.02, gmgn: true, solPriceNote: null });
    expect(state.positions).toHaveLength(0);
    expect(state.cash).toBeGreaterThan(bought);
    expect(state.logs.some((log) => log.message.includes("Hard stop"))).toBe(true);

    const again = emptyOnchain(now);
    again.config = { ...again.config, walletGate: true };
    stepOnchain(again, { now, trades: [buy("A", now), buy("B", now), buy("C", now)], tokens: [sample], priorityUsd: 0.02, gmgn: true, solPriceNote: null });
    stepOnchain(again, { now: now + 8_000, trades: [], tokens: [sample], priorityUsd: 0.02, gmgn: true, solPriceNote: null });
    const winner = token({ price: 1.6 });
    stepOnchain(again, { now: now + 30_000, trades: [], tokens: [winner], priorityUsd: 0.02, gmgn: true, solPriceNote: null });
    expect(again.positions[0]?.halfTaken).toBe(true);
    expect(again.positions[0]?.qty).toBeLessThan(100);

    again.fills.unshift({ id: "loss", ts: now + 31_000, address: "x", symbol: "X", side: "sell", qty: 1, price: 1, fee: 0, pnl: -400, note: "test" });
    stepOnchain(again, { now: now + 40_000, trades: [], tokens: [winner], priorityUsd: 0.02, gmgn: true, solPriceNote: null });
    expect(again.paused).toBe(true);
  });

  it("prices a delayed buy above the mid and a sell below it", () => {
    const buy = buyExecution(1, 99.98, 40_000, 0.0025);
    expect(buy).not.toBeNull();
    expect(buy!.price).toBeGreaterThan(1);
    const sell = simulateSell(1, 40_000, 100, 0.0025);
    expect(sell).toBeLessThan(100);
    expect(priorityFeeUsd(150)).toBeCloseTo(0.01575, 5);
  });

  it("reads mint and freeze authorities from the account bytes", () => {
    const usdc = "AQAAAJj+huiNm+Lqi8HMpIeLKYjCQPUrhCS/tA7Rot3LXhmbC+kTDN9pHwAGAQEAAABicKqKWcWUBbRShshncubNEm6bil06OFNtN/e0FOi2Zw==";
    expect(parseMintAuthorities(usdc)).toEqual({ mintRevoked: false, freezeRevoked: false });
    const revoked = Buffer.alloc(82);
    expect(parseMintAuthorities(revoked.toString("base64"))).toEqual({ mintRevoked: true, freezeRevoked: true });
  });

  it("does not sign or import a swap client", () => {
    const roots = [path.join(process.cwd(), "src/lib/onchain"), path.join(process.cwd(), "src/onchain")];
    const files = roots.flatMap((root) => fs.readdirSync(root).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")));
    const banned = ["gmgnSwap", "sendTransaction", "signTransaction", "privateKey", "GMGN_PRIVATE_KEY"];
    for (const root of roots) {
      for (const name of fs.readdirSync(root)) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
        const text = fs.readFileSync(path.join(root, name), "utf8");
        for (const word of banned) expect(text.includes(word), `${name} contains ${word}`).toBe(false);
      }
    }
    expect(files.length).toBeGreaterThan(0);
  });
});
