import type { RiskLimits } from "../types";

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
  if (Number.isFinite(o.leverage) && o.leverage > limits.maxLeverage + 1e-9) {
    reasons.push(`Leverage ${o.leverage}× is above the ${limits.maxLeverage}× cap.`);
  }
  if (o.side === "sell" && o.qty > o.currentQty + 1e-9) {
    reasons.push("Spot only. This sell is larger than the open long, and the desk will not short.");
  }

  const nextQty = o.side === "buy" ? o.currentQty + o.qty : o.currentQty - o.qty;
  const positionNotional = Math.abs(nextQty) * (finitePositive(o.price) ? o.price : 0);
  const positionPct = input.equity > 0 ? positionNotional / input.equity : Number.POSITIVE_INFINITY;
  const orderNotional = finitePositive(o.qty) && finitePositive(o.price) ? o.qty * o.price : 0;

  if (!reducing && input.equity > 0 && positionPct > limits.maxPositionPct + 1e-9) {
    reasons.push(
      `Position would be ${(positionPct * 100).toFixed(2)}% of equity. Cap is ${(limits.maxPositionPct * 100).toFixed(2)}%.`,
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
      tradeRisk,
      tradeRiskPct,
    },
  };
}
