import type { OkxTicker, RankedMarket, WatchRules } from "../types";

const STABLES = new Set([
  "USDT", "USDC", "DAI", "TUSD", "USDP", "FDUSD", "USDE", "USD1", "EUR", "PYUSD", "USDG", "USDS", "RLUSD", "USD",
]);

/** OKX leveraged tokens use these suffixes. Do not treat a trailing "UP" as leverage — that would drop JUP. */
const LEVERAGED = /(3L|3S|5L|5S|BULL|BEAR)$/;

export function momentumScore(quoteVolume: number, absChange: number, weight: number, cap: number): number {
  const vol = Math.log(Math.max(quoteVolume, 1));
  const mom = cap > 0 ? Math.min(Math.max(absChange, 0), cap) / cap : 0;
  return vol * (1 + weight * mom);
}

export function isEligibleSpot(instId: string): boolean {
  const parts = instId.split("-");
  if (parts.length !== 2 || parts[1] !== "USDT") return false;
  const base = parts[0];
  if (!base || STABLES.has(base)) return false;
  if (LEVERAGED.test(base)) return false;
  return true;
}

export interface ScoredTicker extends OkxTicker {
  change24h: number;
  score: number;
}

export function scoreTicker(ticker: OkxTicker, rules: Pick<WatchRules, "momentumWeight" | "momentumCap">): ScoredTicker {
  const change24h = ticker.open24h > 0 ? (ticker.last - ticker.open24h) / ticker.open24h : 0;
  return {
    ...ticker,
    change24h,
    score: momentumScore(ticker.quoteVolume24h, Math.abs(change24h), rules.momentumWeight, rules.momentumCap),
  };
}

/**
 * Core pairs stay pinned. The rest of the list is eligible USDT spot ranked by
 * log(24h quote volume) × (1 + momentum weight). Illiquid spikes are dropped by the volume floor.
 */
export function rankOkxSpot(tickers: OkxTicker[], rules: WatchRules): RankedMarket[] {
  const byId = new Map<string, ScoredTicker>();
  for (const ticker of tickers) {
    if (!isEligibleSpot(ticker.instId) || !(ticker.last > 0)) continue;
    byId.set(ticker.instId, scoreTicker(ticker, rules));
  }
  const coreIds = rules.coreInstIds.filter((id) => isEligibleSpot(id));
  const core = new Set(coreIds);
  const ranked: RankedMarket[] = [];
  for (const instId of coreIds) {
    const row = byId.get(instId);
    if (!row) {
      ranked.push({ instId, role: "core", last: null, change24h: null, quoteVolume24h: null, score: null, missing: true });
      continue;
    }
    ranked.push({
      instId,
      role: "core",
      last: row.last,
      change24h: row.change24h,
      quoteVolume24h: row.quoteVolume24h,
      score: row.score,
      missing: false,
    });
  }
  const trend = [...byId.values()]
    .filter((row) => !core.has(row.instId) && row.quoteVolume24h >= rules.minQuoteVolumeUsd)
    .sort((a, b) => b.score - a.score || b.quoteVolume24h - a.quoteVolume24h)
    .slice(0, rules.topN)
    .map((row): RankedMarket => ({
      instId: row.instId,
      role: "trend",
      last: row.last,
      change24h: row.change24h,
      quoteVolume24h: row.quoteVolume24h,
      score: row.score,
      missing: false,
    }));
  return [...ranked, ...trend];
}
