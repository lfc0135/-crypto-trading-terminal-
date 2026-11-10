/** Isolated-margin model for OKX paper trading. Not a live liquidation engine. */

/** OKX BTC-USDT tier-1 maintenance margin is about 0.4%. Used only to place the liquidation price. */
export const MAINTENANCE_MARGIN_RATE = 0.004;

/**
 * Hard ceiling. Orders and saved settings cannot go above this.
 * Raising it means changing this constant.
 */
export const HARD_MAX_LEVERAGE = 2;

/**
 * OKX basic USDT borrow, daily simple rate, from
 * GET /api/v5/public/interest-rate-loan-quota on 10 Nov 2026 (`basic` USDT rate 0.00010968).
 * Backtests freeze this so a result does not move with the live quote.
 * About 4.0% a year (0.00010968 × 365).
 */
export const DEFAULT_BORROW_DAILY = 0.00010968;

export function clampLeverage(requested: number, cap: number): number {
  const ceiling = Math.min(Math.max(cap, 1), HARD_MAX_LEVERAGE);
  if (!Number.isFinite(requested) || requested < 1) return 1;
  return Math.min(requested, ceiling);
}

/** Max notional / equity. The margin cap stays maxPositionPct; 2× doubles the coins that margin can hold. */
export function exposureCapPct(maxPositionPct: number, leverage: number): number {
  const lev = Math.min(Math.max(leverage, 1), HARD_MAX_LEVERAGE);
  return maxPositionPct * lev;
}

/**
 * Isolated long liquidation price.
 * Borrowed fraction is 1 - 1/leverage. Maintenance is charged on mark notional.
 * At 1× there is no borrow and no liquidation price.
 */
export function liquidationPrice(entry: number, leverage: number, mmr = MAINTENANCE_MARGIN_RATE): number | null {
  if (!(entry > 0) || !(leverage > 1) || mmr >= 1) return null;
  const borrowedFraction = 1 - 1 / leverage;
  if (borrowedFraction <= 0) return null;
  return (entry * borrowedFraction) / (1 - mmr);
}

/** Simple interest on USDT borrowed to fund the leveraged part of the position. */
export function borrowCost(borrowed: number, dailyRate: number, elapsedMs: number): number {
  if (!(borrowed > 0) || !(dailyRate > 0) || !(elapsedMs > 0)) return 0;
  return borrowed * dailyRate * (elapsedMs / 86_400_000);
}

export function marginAndBorrow(notional: number, leverage: number): { margin: number; borrowed: number } {
  const lev = Math.max(leverage, 1);
  if (lev <= 1) return { margin: notional, borrowed: 0 };
  const margin = notional / lev;
  return { margin, borrowed: notional - margin };
}
