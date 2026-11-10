import { runBacktest, type BacktestConfig, type StrategyInstance } from "../backtest/engine";
import { DEFAULT_LIMITS } from "../defaults";
import { getStrategy } from "../strategies";
import { classifyDailyTarget, maxDrawdown, sharpeRatio } from "../targets";
import { applyFilters, type FilterFlags, NO_FILTERS } from "./filters";
import type { Candle, RiskLimits } from "../types";

export interface SweepMetrics {
  trades: number;
  expectancy: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  hitRate: number;
  days: number;
  endingEquity: number;
}

export interface SweepCandidate {
  strategyId: string;
  bar: string;
  params: Record<string, number>;
  filters: FilterFlags;
}

export interface ScoredCandidate extends SweepCandidate {
  train: SweepMetrics;
  test: SweepMetrics | null;
  fragile: boolean;
  rejectReason: string | null;
  selected: boolean;
  armed: boolean;
}

export interface WalkForwardInput {
  candles: Candle[];
  bar: string;
  barMs: number;
  strategyId: string;
  grid: Array<{ params: Record<string, number>; filters: FilterFlags }>;
  split?: number;
  limits?: RiskLimits;
  minTrainTrades?: number;
  minTestTrades?: number;
  initialEquity?: number;
  entryStyle?: "taker" | "maker";
  wrap?: (strategy: StrategyInstance) => StrategyInstance;
}

const baseConfig = (
  barMs: number,
  limits: RiskLimits,
  equity: number,
  signalFromIndex?: number,
  entryStyle?: "taker" | "maker",
): Partial<BacktestConfig> => ({
  initialEquity: equity,
  principal: equity,
  feeBps: 10,
  slippageBps: 2,
  limits,
  barDurationMs: barMs,
  signalFromIndex,
  entryStyle,
  makerFeeBps: 8,
  minRewardToCost: 3,
  makerExpireBars: 2,
});

export function scoreBacktest(result: ReturnType<typeof runBacktest>): SweepMetrics {
  const pnl = result.trades.reduce((sum, trade) => sum + trade.pnl, 0);
  return {
    trades: result.closedTrades,
    expectancy: result.closedTrades > 0 ? pnl / result.closedTrades : 0,
    totalReturnPct: result.totalReturnPct,
    maxDrawdownPct: result.maxDrawdownPct,
    sharpe: result.sharpe,
    hitRate: result.daily.hitRate,
    days: result.daily.days,
    endingEquity: result.endingEquity,
  };
}

function betterTrain(a: SweepMetrics, b: SweepMetrics): boolean {
  if (a.expectancy !== b.expectancy) return a.expectancy > b.expectancy;
  if (a.maxDrawdownPct !== b.maxDrawdownPct) return a.maxDrawdownPct < b.maxDrawdownPct;
  if (a.sharpe !== b.sharpe) return a.sharpe > b.sharpe;
  return a.hitRate > b.hitRate;
}

function instance(
  strategyId: string,
  params: Record<string, number>,
  filters: FilterFlags,
  barMs: number,
  wrap?: (strategy: StrategyInstance) => StrategyInstance,
): StrategyInstance | null {
  const strategy = getStrategy(strategyId);
  if (!strategy) return null;
  const atrMult = params.atrMult ?? 2;
  const built = applyFilters(strategy.create(params), filters, barMs, atrMult);
  return wrap ? wrap(built) : built;
}

/** A point is fragile when it towers over the rest of the same grid and the runner-up is far behind. */
export function isFragileSpike(best: number, others: number[]): boolean {
  if (others.length < 3 || !(best > 0)) return false;
  const sorted = [...others].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const second = Math.max(...others);
  return best > Math.max(mid, 0) * 3 && second < best * 0.4;
}

export function walkForward(input: WalkForwardInput): ScoredCandidate[] {
  const split = input.split ?? 0.7;
  const minTrain = input.minTrainTrades ?? 8;
  const minTest = input.minTestTrades ?? 3;
  const limits = input.limits ?? DEFAULT_LIMITS;
  const equity = input.initialEquity ?? 50_000;
  const cut = Math.max(1, Math.floor(input.candles.length * split));
  const trainCandles = input.candles.slice(0, cut);
  const scored: ScoredCandidate[] = [];
  const trainExpectancy: number[] = [];

  for (const point of input.grid) {
    const strategy = instance(input.strategyId, point.params, point.filters, input.barMs, input.wrap);
    if (!strategy) continue;
    const trainRun = runBacktest(trainCandles, strategy, baseConfig(input.barMs, limits, equity, undefined, input.entryStyle));
    const train = scoreBacktest(trainRun);
    trainExpectancy.push(train.expectancy);
    scored.push({
      strategyId: input.strategyId,
      bar: input.bar,
      params: point.params,
      filters: point.filters,
      train,
      test: null,
      fragile: false,
      rejectReason: train.trades < minTrain ? `only ${train.trades} training trades` : null,
      selected: false,
      armed: false,
    });
  }

  const eligible = scored.filter((row) => row.rejectReason == null);
  if (eligible.length === 0) return scored;
  const best = eligible.reduce((a, b) => (betterTrain(a.train, b.train) ? a : b));
  const others = eligible.filter((row) => row !== best).map((row) => row.train.expectancy);
  if (isFragileSpike(best.train.expectancy, others)) {
    best.fragile = true;
    best.rejectReason = "fragile parameter spike versus the rest of the grid";
  }
  const survivors = eligible.filter((row) => row.rejectReason == null);
  if (survivors.length === 0) return scored;
  const chosen = survivors.reduce((a, b) => (betterTrain(a.train, b.train) ? a : b));

  const testStrategy = instance(input.strategyId, chosen.params, chosen.filters, input.barMs, input.wrap);
  if (!testStrategy) return scored;
  const testRun = runBacktest(input.candles, testStrategy, baseConfig(input.barMs, limits, equity, cut, input.entryStyle));
  const testTrades = testRun.trades.filter((trade) => trade.entryTime >= input.candles[cut].time);
  const testPnL = testTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const after = testRun.equityCurve.filter((point) => point.time >= input.candles[cut].time);
  const barsPerYear = input.barMs > 0 ? (365 * 24 * 60 * 60 * 1000) / input.barMs : 0;
  const daily = classifyDailyTarget(after, equity, equity, { low: 0.02, high: 0.03 });
  const testScore = scoreBacktest({
    ...testRun,
    trades: testTrades,
    closedTrades: testTrades.length,
    totalReturnPct: equity > 0 ? testPnL / equity : 0,
    equityCurve: after,
    daily,
  });
  testScore.trades = testTrades.length;
  testScore.expectancy = testTrades.length ? testPnL / testTrades.length : 0;
  testScore.hitRate = daily.hitRate;
  testScore.days = daily.days;
  testScore.maxDrawdownPct = maxDrawdown(after.map((point) => point.equity));
  testScore.sharpe = sharpeRatio(after.map((point) => point.equity), barsPerYear);
  chosen.test = testScore;
  chosen.selected = true;
  if (testTrades.length < minTest) {
    chosen.rejectReason = `only ${testTrades.length} out-of-sample trades`;
  } else if (!(testScore.expectancy > 1) || !(testScore.totalReturnPct > 0) || !(testScore.sharpe > 0)) {
    chosen.rejectReason = "out-of-sample result is flat or negative after costs";
  } else if (testScore.maxDrawdownPct > 0.25) {
    chosen.rejectReason = "out-of-sample drawdown is above 25%";
  } else {
    chosen.armed = true;
  }
  return scored;
}

export function gridFor(strategyId: string): Array<{ params: Record<string, number>; filters: FilterFlags }> {
  const base = BASE_GRIDS[strategyId] ?? [];
  const filters: FilterFlags[] = [
    NO_FILTERS,
    { trend: true, volatility: false, trail: false },
    { trend: true, volatility: true, trail: true },
  ];
  const out: Array<{ params: Record<string, number>; filters: FilterFlags }> = [];
  for (const params of base) {
    for (const flag of filters) out.push({ params, filters: flag });
  }
  return out;
}

function expand(axes: Record<string, number[]>): Array<Record<string, number>> {
  const keys = Object.keys(axes);
  const out: Array<Record<string, number>> = [];
  const walk = (index: number, current: Record<string, number>) => {
    if (index === keys.length) {
      out.push({ ...current });
      return;
    }
    const key = keys[index];
    for (const value of axes[key]) walk(index + 1, { ...current, [key]: value });
  };
  walk(0, {});
  return out;
}

const BASE_GRIDS: Record<string, Array<Record<string, number>>> = {
  "ema-momentum": expand({
    fast: [10, 20],
    slow: [40, 60],
    atrPeriod: [14],
    atrMult: [2, 3],
    rewardRisk: [1.5, 2],
  }),
  "mean-reversion": expand({
    period: [14, 30],
    entryZ: [1.2, 2],
    exitZ: [0.25],
    atrPeriod: [14],
    atrMult: [2, 3],
  }),
  "session-breakout": expand({
    rangeBars: [2, 4, 8],
    rewardRisk: [1.5, 2.5],
  }),
  "intraday-momentum": expand({
    fast: [8, 12],
    slow: [21, 34],
    breakout: [8],
    atrPeriod: [14],
    atrMult: [2],
  }),
};

export const SWEEP_TIMEFRAMES: Record<string, string[]> = {
  "ema-momentum": ["1H", "4H"],
  "mean-reversion": ["1H", "15m"],
  "session-breakout": ["15m"],
  "intraday-momentum": ["15m"],
};

export function historyBars(bar: string): number {
  if (bar === "4H") return 800;
  if (bar === "1H") return 1400;
  if (bar === "15m") return 2200;
  if (bar === "5m") return 2500;
  return 1500;
}
