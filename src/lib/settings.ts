import { DEFAULT_GMGN_RULES, DEFAULT_LIMITS, DEFAULT_TARGETS, DEFAULT_WATCH_RULES, monthlyBandFromDaily } from "./defaults";
import { HARD_MAX_LEVERAGE } from "./trading/margin";
import { isEligibleSpot } from "./watchlist/rank";
import type { GmgnChain, GmgnInterval, Settings } from "./types";

const CHAINS = new Set<GmgnChain>(["sol", "bsc", "base"]);
const INTERVALS = new Set<GmgnInterval>(["1m", "5m", "1h", "6h", "24h"]);

function num(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

export function normalizeSettings(input: unknown, fallback: Settings = blankSettings()): Settings | { error: string } {
  if (!input || typeof input !== "object") return { error: "Settings payload was empty." };
  const raw = input as { limits?: Record<string, unknown>; targets?: Record<string, unknown>; watch?: Record<string, unknown>; leverageReviewMonths?: unknown };
  const limits = raw.limits ?? {};
  const maxPositionPct = num(limits.maxPositionPct, 0.01, 0.5);
  const maxDailyLossPct = num(limits.maxDailyLossPct, 0.005, 0.1);
  const maxDrawdownPct = num(limits.maxDrawdownPct, 0.02, 0.4);
  const perTradeRiskPct = num(limits.perTradeRiskPct, 0.001, 0.05);
  const maxLeverage = num(limits.maxLeverage, 1, HARD_MAX_LEVERAGE);
  if (maxPositionPct == null || maxDailyLossPct == null || maxDrawdownPct == null || perTradeRiskPct == null || maxLeverage == null) {
    return { error: `Risk limits are outside the allowed range. Position 1–50%, daily loss 0.5–10%, drawdown 2–40%, per-trade 0.1–5%, leverage 1–${HARD_MAX_LEVERAGE}.` };
  }
  if (perTradeRiskPct > maxDailyLossPct) return { error: "Per-trade risk cannot be larger than the daily loss stop." };
  const targets = raw.targets ?? {};
  const dailyLow = num(targets.dailyLow, 0.001, 0.2);
  const dailyHigh = num(targets.dailyHigh, 0.001, 0.5);
  if (dailyLow == null || dailyHigh == null || dailyHigh <= dailyLow) return { error: "Daily target band needs a high above the low, between 0.1% and 50%." };
  const monthlyFollowsDaily = targets.monthlyFollowsDaily !== false;
  const implied = monthlyBandFromDaily({ dailyLow, dailyHigh });
  const monthlyLow = monthlyFollowsDaily ? implied.monthlyLow : num(targets.monthlyLow, 0, 20);
  const monthlyHigh = monthlyFollowsDaily ? implied.monthlyHigh : num(targets.monthlyHigh, 0, 30);
  if (monthlyLow == null || monthlyHigh == null || monthlyHigh <= monthlyLow) return { error: "Monthly band needs a high above the low." };
  const watch = raw.watch ?? {};
  const gmgn = (watch.gmgn ?? {}) as Record<string, unknown>;
  const coreInstIds = Array.isArray(watch.coreInstIds)
    ? watch.coreInstIds.map((item) => String(item).toUpperCase().trim()).filter(Boolean)
    : fallback.watch.coreInstIds;
  if (coreInstIds.length < 1 || coreInstIds.length > 6 || coreInstIds.some((id) => !isEligibleSpot(id))) {
    return { error: "Core watchlist needs 1–6 OKX USDT spot pairs, such as BTC-USDT." };
  }
  const topN = num(watch.topN, 3, 30);
  const minQuoteVolumeUsd = num(watch.minQuoteVolumeUsd, 0, 1e12);
  const momentumWeight = num(watch.momentumWeight, 0, 1);
  const momentumCap = num(watch.momentumCap, 0.01, 2);
  const refreshSeconds = num(watch.refreshSeconds, 20, 600);
  if (topN == null || minQuoteVolumeUsd == null || momentumWeight == null || momentumCap == null || refreshSeconds == null) {
    return { error: "Watchlist rank settings are out of range." };
  }
  const chains = Array.isArray(gmgn.chains) ? gmgn.chains.filter((chain): chain is GmgnChain => CHAINS.has(chain as GmgnChain)) : fallback.watch.gmgn.chains;
  if (!chains.length) return { error: "Pick at least one of Solana, BSC, or Base." };
  const interval = INTERVALS.has(gmgn.interval as GmgnInterval) ? (gmgn.interval as GmgnInterval) : fallback.watch.gmgn.interval;
  const minLiquidityUsd = num(gmgn.minLiquidityUsd, 0, 1e12);
  const maxTop10HolderRate = num(gmgn.maxTop10HolderRate, 0.05, 1);
  const maxRugRatio = num(gmgn.maxRugRatio, 0, 1);
  const maxBuyTax = num(gmgn.maxBuyTax, 0, 0.25);
  const maxSellTax = num(gmgn.maxSellTax, 0, 0.25);
  const minHolders = num(gmgn.minHolders, 0, 1_000_000);
  const fetchLimit = num(gmgn.fetchLimit, 10, 80);
  const maxResults = num(gmgn.maxResults, 3, 20);
  if (minLiquidityUsd == null || maxTop10HolderRate == null || maxRugRatio == null || maxBuyTax == null || maxSellTax == null || minHolders == null || fetchLimit == null || maxResults == null) {
    return { error: "On-chain filter settings are out of range." };
  }
  const months = num(raw.leverageReviewMonths, 1, 12) ?? fallback.leverageReviewMonths;
  return {
    limits: { maxPositionPct, maxDailyLossPct, maxDrawdownPct, perTradeRiskPct, maxLeverage },
    targets: { dailyLow, dailyHigh, monthlyFollowsDaily, monthlyLow, monthlyHigh },
    watch: {
      coreInstIds,
      topN,
      minQuoteVolumeUsd,
      momentumWeight,
      momentumCap,
      refreshSeconds,
      gmgn: {
        chains,
        interval,
        minLiquidityUsd,
        maxTop10HolderRate,
        maxRugRatio,
        maxBuyTax,
        maxSellTax,
        requireRenouncedMint: gmgn.requireRenouncedMint !== false,
        blockWashTrading: gmgn.blockWashTrading !== false,
        blockAlert: gmgn.blockAlert !== false,
        requireHoneypotClearance: gmgn.requireHoneypotClearance !== false,
        minHolders,
        fetchLimit,
        maxResults,
      },
    },
    leverageReviewMonths: months,
    marginRev: 1,
  };
}

export function blankSettings(): Settings {
  return {
    limits: { ...DEFAULT_LIMITS },
    targets: { ...DEFAULT_TARGETS },
    watch: { ...DEFAULT_WATCH_RULES, coreInstIds: [...DEFAULT_WATCH_RULES.coreInstIds], gmgn: { ...DEFAULT_GMGN_RULES, chains: [...DEFAULT_GMGN_RULES.chains] } },
    leverageReviewMonths: 3,
    marginRev: 1,
  };
}
