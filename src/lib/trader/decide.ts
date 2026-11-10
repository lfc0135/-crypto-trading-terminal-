import type { OpenLot, Signal, StrategyInstance } from "../backtest/engine";
import { BAR_MS, getStrategy } from "../strategies";
import { applyFilters, type FilterFlags } from "../tuning/filters";
import type { Candle } from "../types";

export interface TraderJob {
  symbol: string;
  strategyId: string;
  bar: string;
  params: Record<string, number>;
  filters: FilterFlags;
  armed?: boolean;
}

export interface TraderDecision {
  symbol: string;
  barTime: number;
  action: "hold" | "buy" | "close" | "trail";
  reason: string;
  stopLoss?: number;
  takeProfit?: number;
  trailStop?: number;
}

export function signalOnLastBar(job: TraderJob, candles: Candle[], actual: OpenLot | null): Signal {
  const strategy = getStrategy(job.strategyId);
  if (!strategy || candles.length === 0) return { action: "hold", reason: "no strategy or no candles" };
  const barMs = BAR_MS[job.bar] ?? 60 * 60_000;
  const instance: StrategyInstance = applyFilters(strategy.create(job.params), job.filters, barMs, job.params.atrMult ?? 2);
  let sim: OpenLot | null = null;
  for (let i = 0; i < candles.length - 1; i += 1) {
    const history = candles.slice(0, i + 1);
    const signal = instance.onBar({
      history,
      bar: candles[i],
      index: i,
      barDurationMs: barMs,
      position: sim,
      equity: 0,
      cash: 0,
      initialEquity: 0,
    });
    if (signal.action === "buy" && !sim) {
      sim = { qty: 1, avgPrice: candles[i].close, stopLoss: signal.stopLoss ?? null, takeProfit: signal.takeProfit ?? null };
    } else if (signal.action === "close") {
      sim = null;
    } else if (sim && signal.trailStop != null && (sim.stopLoss == null || signal.trailStop > sim.stopLoss)) {
      sim.stopLoss = signal.trailStop;
    }
  }
  const last = candles.length - 1;
  return instance.onBar({
    history: candles,
    bar: candles[last],
    index: last,
    barDurationMs: barMs,
    position: actual,
    equity: 0,
    cash: 0,
    initialEquity: 0,
  });
}

export function decide(job: TraderJob, candles: Candle[], actual: OpenLot | null): TraderDecision {
  const barTime = candles[candles.length - 1]?.time ?? 0;
  const signal = signalOnLastBar(job, candles, actual);
  if (signal.action === "close" && actual) {
    return { symbol: job.symbol, barTime, action: "close", reason: signal.reason ?? "strategy exit" };
  }
  if (signal.action === "buy" && !actual) {
    if (signal.stopLoss == null) {
      return { symbol: job.symbol, barTime, action: "hold", reason: "buy skipped: no stop" };
    }
    return {
      symbol: job.symbol,
      barTime,
      action: "buy",
      reason: signal.reason ?? "strategy entry",
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
    };
  }
  if (signal.trailStop != null && actual && (actual.stopLoss == null || signal.trailStop > actual.stopLoss)) {
    return { symbol: job.symbol, barTime, action: "trail", reason: "trail stop tightened", trailStop: signal.trailStop };
  }
  return { symbol: job.symbol, barTime, action: "hold", reason: signal.reason ?? "no new signal" };
}
