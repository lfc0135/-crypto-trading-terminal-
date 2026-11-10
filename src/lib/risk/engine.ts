import type { RiskLimits } from "../types";
import { HARD_MAX_LEVERAGE, exposureCapPct, liquidationPrice } from "../trading/margin";

export interface RiskOrder {
  side: "buy" | "sell";
  qty: number;
  price: number;
  leverage: number;
  stopLoss: number | null;
  currentQty: number;
  feeBps: number;
}

export interface RiskInput {
  equity: number;
  peakEquity: number;
  dayStartEquity: number;
  limits: RiskLimits;
  dailyKillLatched: boolean;
  drawdownKillLatched: boolean;
  order: RiskOrder;
}

export interface RiskMetrics {
  dailyLossPct: number;
  drawdownPct: number;
  dailyKill: boolean;
  drawdownKill: boolean;
  reducing: boolean;
  orderNotional: number;
  nextQty: number;
  positionNotional: number;
  positionPct: number;
  exposureCapPct: number;
  liquidationPrice: number | null;
  tradeRisk: number | null;
  tradeRiskPct: number | null;
}

export interface RiskDecision {
  allowed: boolean;
  reasons: string[];
  metrics: RiskMetrics;
}

function finitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

export function evaluateOrder(input: RiskInput): RiskDecision {
  const { order: o, limits } = input;
  const reasons: string[] = [];
  const dayLossPct = input.dayStartEquity > 0 ? (input.dayStartEquity - input.equity) / input.dayStartEquity : 1;
  const drawdownPct = input.peakEquity > 0 ? (input.peakEquity - input.equity) / input.peakEquity : 0;
  const dailyKill = input.dailyKillLatched || dayLossPct >= limits.maxDailyLossPct - 1e-12;
  const drawdownKill = input.drawdownKillLatched || drawdownPct >= limits.maxDrawdownPct - 1e-12;
  const reducing = o.side === "sell" && o.currentQty > 0 && o.qty <= o.currentQty + 1e-9;

  if (!(input.equity > 0) || !Number.isFinite(input.equity)) reasons.push("Equity must be positive.");
  if (!finitePositive(o.qty)) reasons.push("Quantity must be a positive number.");
  if (!finitePositive(o.price)) reasons.push("Price must be a positive number.");
  if (!Number.isFinite(o.leverage) || o.leverage < 1) reasons.push("Leverage must be at least 1×.");
  if (Number.isFinite(o.leverage) && o.leverage > HARD_MAX_LEVERAGE + 1e-9) {
    reasons.push(`Leverage ${o.leverage}× is above the ${HARD_MAX_LEVERAGE}× hard ceiling.`);
  }
  if (Number.isFinite(o.leverage) && o.leverage > limits.maxLeverage + 1e-9) {
    reasons.push(`Leverage ${o.leverage}× is above the ${limits.maxLeverage}× cap.`);
  }
  if (o.side === "sell" && o.qty > o.currentQty + 1e-9) {
    reasons.push("This sell is larger than the open long. The desk does not open shorts.");
  }

  const nextQty = o.side === "buy" ? o.currentQty + o.qty : o.currentQty - o.qty;
  const positionNotional = Math.abs(nextQty) * (finitePositive(o.price) ? o.price : 0);
  const positionPct = input.equity > 0 ? positionNotional / input.equity : Number.POSITIVE_INFINITY;
  const orderNotional = finitePositive(o.qty) && finitePositive(o.price) ? o.qty * o.price : 0;
  const lev = Number.isFinite(o.leverage) ? Math.min(Math.max(o.leverage, 1), HARD_MAX_LEVERAGE) : 1;
  const notionalCap = exposureCapPct(limits.maxPositionPct, lev);
  const liq = finitePositive(o.price) ? liquidationPrice(o.price, lev) : null;

  if (!reducing && input.equity > 0 && positionPct > notionalCap + 1e-9) {
    reasons.push(
      `Position notional would be ${(positionPct * 100).toFixed(2)}% of equity. At ${lev}× the cap is ${(notionalCap * 100).toFixed(2)}% (${(limits.maxPositionPct * 100).toFixed(2)}% margin).`,
    );
  }
  if (!reducing && liq != null && o.stopLoss != null && o.stopLoss <= liq) {
    reasons.push(
      `Stop is at or below the isolated liquidation price (${liq.toFixed(4)}). The position would be liquidated before the stop.`,
    );
  }
  if (!reducing && dailyKill) {
    reasons.push("Daily loss kill switch is on. New risk is blocked. Reducing an open long is still allowed.");
  }
  if (!reducing && drawdownKill) {
    reasons.push("Drawdown kill switch is on. New risk is blocked. Reducing an open long is still allowed.");
  }

  let tradeRisk: number | null = null;
  let tradeRiskPct: number | null = null;
  if (!reducing && finitePositive(o.qty) && finitePositive(o.price) && input.equity > 0) {
    const fee = orderNotional * (Math.max(o.feeBps, 0) / 10_000) * 2;
    if (o.stopLoss == null) {
      tradeRisk = orderNotional + fee;
    } else if (!(o.stopLoss < o.price)) {
      reasons.push("A long stop has to sit below the entry. The full notional is treated as the risk until it does.");
      tradeRisk = orderNotional + fee;
    } else {
      tradeRisk = (o.price - o.stopLoss) * o.qty + fee;
    }
    tradeRiskPct = tradeRisk / input.equity;
    if (tradeRiskPct > limits.perTradeRiskPct + 1e-9) {
      reasons.push(
        `Trade risk ${(tradeRiskPct * 100).toFixed(2)}% of equity exceeds the ${(limits.perTradeRiskPct * 100).toFixed(2)}% per-trade limit.`,
      );
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    metrics: {
      dailyLossPct: dayLossPct,
      drawdownPct,
      dailyKill,
      drawdownKill,
      reducing,
      orderNotional,
      nextQty,
      positionNotional,
      positionPct,
      exposureCapPct: notionalCap,
      liquidationPrice: liq,
      tradeRisk,
      tradeRiskPct,
    },
  };
}
