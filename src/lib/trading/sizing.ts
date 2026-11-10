import { evaluateOrder } from "../risk/engine";
import type { RiskLimits } from "../types";
import { clampLeverage, exposureCapPct } from "./margin";

export function stepPrecision(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 8;
  const text = step.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Round down to the exchange lot. Never rounds up. */
export function floorToStep(qty: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(qty)) return qty;
  const steps = Math.floor((qty + step * 1e-9) / step);
  const n = steps * step;
  return Number(n.toFixed(Math.min(12, stepPrecision(step))));
}

export interface SizeInput {
  equity: number;
  price: number;
  stop: number;
  limits: RiskLimits;
  minSz: number;
  lotSz: number;
  feeBps: number;
  currentQty: number;
  peakEquity: number;
  dayStartEquity: number;
  dailyKillLatched: boolean;
  drawdownKillLatched: boolean;
  leverage?: number;
}

export interface SizeResult {
  ok: boolean;
  qty: number;
  reasons: string[];
  notional: number;
  risk: number | null;
  riskPct: number | null;
  positionPct: number | null;
}

/**
 * Size a spot long from the per-trade risk budget and the stop.
 * If the risk budget wants a size below the exchange minimum, the order is refused.
 * It is not rounded up. A size above the position cap is cut down, which spends less than the risk budget.
 */
export function sizeLongSpot(input: SizeInput): SizeResult {
  const reasons: string[] = [];
  if (!(input.stop < input.price)) {
    return { ok: false, qty: 0, reasons: ["Stop must be below the entry to size from risk."], notional: 0, risk: null, riskPct: null, positionPct: null };
  }
  const leverage = clampLeverage(input.leverage ?? input.limits.maxLeverage, input.limits.maxLeverage);
  const riskBudget = input.equity * input.limits.perTradeRiskPct;
  const stopDistance = input.price - input.stop;
  const feePerUnit = input.price * (Math.max(input.feeBps, 0) / 10_000) * 2;
  const rawQty = riskBudget / (stopDistance + feePerUnit);
  const roomNotional = Math.max(0, input.equity * exposureCapPct(input.limits.maxPositionPct, leverage) - input.currentQty * input.price);
  const capQty = input.price > 0 ? roomNotional / input.price : 0;
  let qty = Math.min(rawQty, capQty);
  if (input.lotSz > 0) qty = floorToStep(qty, input.lotSz);
  if (!(qty > 0)) {
    reasons.push("Risk budget and position cap leave no size.");
  }
  if (qty > 0 && input.minSz > 0 && qty + 1e-12 < input.minSz) {
    reasons.push(
      `Risk-based size ${qty} is below the exchange minimum ${input.minSz}. The desk will not round up, because that would spend more than the per-trade risk limit.`,
    );
    qty = 0;
  }
  if (!(qty > 0)) {
    return { ok: false, qty: 0, reasons, notional: 0, risk: null, riskPct: null, positionPct: null };
  }
  const decision = evaluateOrder({
    equity: input.equity,
    peakEquity: input.peakEquity,
    dayStartEquity: input.dayStartEquity,
    limits: input.limits,
    dailyKillLatched: input.dailyKillLatched,
    drawdownKillLatched: input.drawdownKillLatched,
    order: {
      side: "buy",
      qty,
      price: input.price,
      leverage,
      stopLoss: input.stop,
      currentQty: input.currentQty,
      feeBps: input.feeBps,
    },
  });
  return {
    ok: decision.allowed,
    qty,
    reasons: decision.allowed ? [] : decision.reasons,
    notional: decision.metrics.orderNotional,
    risk: decision.metrics.tradeRisk,
    riskPct: decision.metrics.tradeRiskPct,
    positionPct: decision.metrics.positionPct,
  };
}
