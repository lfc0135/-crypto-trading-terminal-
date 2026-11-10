import type { GmgnRules, RiskLimits, TargetSettings, WatchRules } from "./types";

/** Paper book and benchmark denominator. */
export const DEFAULT_PRINCIPAL = 50_000;

/**
 * Limits for a $50,000 book. Margin budget is 10% ($5,000). At the 2× cap that
 * supports $10,000 of notional. Per-trade risk $200, daily loss stop $750,
 * drawdown stop $4,000.
 */
export const DEFAULT_LIMITS: RiskLimits = {
  maxPositionPct: 0.1,
  maxDailyLossPct: 0.015,
  maxDrawdownPct: 0.08,
  perTradeRiskPct: 0.004,
  maxLeverage: 2,
};

/** User scoreboard. Not a forecast and not what the risk engine is sized to produce. */
export const DEFAULT_TARGETS: TargetSettings = {
  dailyLow: 0.02,
  dailyHigh: 0.03,
  monthlyFollowsDaily: true,
  monthlyLow: (1.02 ** 30) - 1,
  monthlyHigh: (1.03 ** 30) - 1,
};

export const LEVERAGE_REVIEW_MONTHS = 3;

/** OKX spot VIP0: maker 8 bps, taker 10 bps. Slippage applies to taker stops only. */
export const PAPER_MAKER_FEE_BPS = 8;
export const PAPER_TAKER_FEE_BPS = 10;
export const PAPER_SLIPPAGE_BPS = 2;
/** Skip a trade unless the planned move is at least this many times the round-trip cost. */
export const MIN_REWARD_TO_COST = 3;

export function roundTripCostFraction(
  makerBps = PAPER_MAKER_FEE_BPS,
  takerBps = PAPER_TAKER_FEE_BPS,
  slippageBps = PAPER_SLIPPAGE_BPS,
): number {
  return (makerBps + takerBps + slippageBps) / 10_000;
}

export function expectedMoveCoversCost(entry: number, target: number, multiple = MIN_REWARD_TO_COST): boolean {
  if (!(entry > 0) || !(target > entry)) return false;
  return (target - entry) / entry >= multiple * roundTripCostFraction();
}

/** On-chain paper model. Not a GMGN quote. */
export const ONCHAIN_PAPER_FEE_BPS = 30;
export const ONCHAIN_PAPER_SLIPPAGE_BPS = 50;

export const DEFAULT_GMGN_RULES: GmgnRules = {
  chains: ["sol", "bsc", "base"],
  interval: "1h",
  minLiquidityUsd: 50_000,
  maxTop10HolderRate: 0.3,
  maxRugRatio: 0.15,
  maxBuyTax: 0.05,
  maxSellTax: 0.05,
  requireRenouncedMint: true,
  blockWashTrading: true,
  blockAlert: true,
  requireHoneypotClearance: true,
  minHolders: 150,
  fetchLimit: 40,
  maxResults: 8,
};

export const DEFAULT_WATCH_RULES: WatchRules = {
  coreInstIds: ["BTC-USDT", "ETH-USDT", "SOL-USDT"],
  topN: 10,
  minQuoteVolumeUsd: 10_000_000,
  momentumWeight: 0.35,
  momentumCap: 0.2,
  refreshSeconds: 60,
  gmgn: DEFAULT_GMGN_RULES,
};

export const LIVE_PHRASE = "ENABLE LIVE TRADING";
export const DEMO_PHRASE = "ROUTE TO OKX DEMO";

export function compoundReturn(rate: number, periods: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(periods)) return NaN;
  return (1 + rate) ** periods - 1;
}

export function monthlyBandFromDaily(targets: Pick<TargetSettings, "dailyLow" | "dailyHigh">): {
  monthlyLow: number;
  monthlyHigh: number;
} {
  return {
    monthlyLow: compoundReturn(targets.dailyLow, 30),
    monthlyHigh: compoundReturn(targets.dailyHigh, 30),
  };
}

export function resolvedMonthly(targets: TargetSettings): { monthlyLow: number; monthlyHigh: number } {
  if (targets.monthlyFollowsDaily) return monthlyBandFromDaily(targets);
  return { monthlyLow: targets.monthlyLow, monthlyHigh: targets.monthlyHigh };
}
