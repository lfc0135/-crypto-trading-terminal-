import type { BarContext, Signal, StrategyInstance } from "../backtest/engine";
import { atrAt, emaSeries, highestHigh, windowMean, windowStdev } from "../indicators";
import { dubaiDayKey, isLastBarOfDubaiDay } from "../time";

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  description: string;
  timeframes: string[];
  params: ParamSpec[];
  create: (params: Record<string, number>) => StrategyInstance;
}

const hold = (): Signal => ({ action: "hold" });

function num(params: Record<string, number>, spec: ParamSpec): number {
  const value = params[spec.key];
  if (!Number.isFinite(value)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, value));
}

function pack(params: Record<string, number>, specs: ParamSpec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of specs) out[spec.key] = num(params, spec);
  return out;
}

const emaParams: ParamSpec[] = [
  { key: "fast", label: "Fast EMA", min: 3, max: 50, step: 1, default: 12 },
  { key: "slow", label: "Slow EMA", min: 8, max: 200, step: 1, default: 26 },
  { key: "atrPeriod", label: "ATR period", min: 5, max: 50, step: 1, default: 14 },
  { key: "atrMult", label: "ATR stop multiple", min: 0.5, max: 6, step: 0.1, default: 2.5 },
  { key: "rewardRisk", label: "Target / risk", min: 0.5, max: 5, step: 0.1, default: 2 },
];

const meanParams: ParamSpec[] = [
  { key: "period", label: "Lookback", min: 8, max: 100, step: 1, default: 20 },
  { key: "entryZ", label: "Entry z-score", min: 0.5, max: 4, step: 0.1, default: 1.5 },
  { key: "exitZ", label: "Exit z-score", min: 0, max: 2, step: 0.05, default: 0.25 },
  { key: "atrPeriod", label: "ATR period", min: 5, max: 50, step: 1, default: 14 },
  { key: "atrMult", label: "ATR stop multiple", min: 0.5, max: 6, step: 0.1, default: 2 },
];

const breakoutParams: ParamSpec[] = [
  { key: "rangeBars", label: "Opening range (bars)", min: 1, max: 16, step: 1, default: 3 },
  { key: "rewardRisk", label: "Target / risk", min: 0.5, max: 4, step: 0.1, default: 1.5 },
];

const intraParams: ParamSpec[] = [
  { key: "fast", label: "Fast EMA", min: 3, max: 30, step: 1, default: 8 },
  { key: "slow", label: "Slow EMA", min: 8, max: 80, step: 1, default: 21 },
  { key: "breakout", label: "Prior-bar high lookback", min: 3, max: 40, step: 1, default: 8 },
  { key: "atrPeriod", label: "ATR period", min: 5, max: 40, step: 1, default: 14 },
  { key: "atrMult", label: "ATR stop multiple", min: 0.5, max: 5, step: 0.1, default: 2 },
];

function createEma(params: Record<string, number>): StrategyInstance {
  const p = pack(params, emaParams);
  return {
    onBar(ctx: BarContext): Signal {
      const closes = ctx.history.map((c) => c.close);
      const fast = emaSeries(closes, p.fast);
      const slow = emaSeries(closes, p.slow);
      const i = closes.length - 1;
      if (i < 1 || fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null) return hold();
      const crossDown = fast[i - 1]! >= slow[i - 1]! && fast[i]! < slow[i]!;
      const crossUp = fast[i - 1]! <= slow[i - 1]! && fast[i]! > slow[i]!;
      if (ctx.position && crossDown) return { action: "close", reason: "fast EMA crossed under slow EMA" };
      if (!ctx.position && crossUp) {
        const atr = atrAt(ctx.history, i, p.atrPeriod);
        if (atr == null || atr <= 0) return hold();
        const stop = ctx.bar.close - p.atrMult * atr;
        const risk = ctx.bar.close - stop;
        if (!(risk > 0)) return hold();
        return {
          action: "buy",
          stopLoss: stop,
          takeProfit: ctx.bar.close + p.rewardRisk * risk,
          reason: "EMA cross up",
        };
      }
      return hold();
    },
  };
}

function createMean(params: Record<string, number>): StrategyInstance {
  const p = pack(params, meanParams);
  return {
    onBar(ctx: BarContext): Signal {
      const closes = ctx.history.map((c) => c.close);
      const i = closes.length - 1;
      const mean = windowMean(closes, i, p.period);
      const sd = windowStdev(closes, i, p.period);
      if (mean == null || sd == null || sd === 0) return hold();
      const z = (ctx.bar.close - mean) / sd;
      if (ctx.position && z >= -p.exitZ) return { action: "close", reason: "z-score reverted" };
      if (!ctx.position && z <= -p.entryZ) {
        const atr = atrAt(ctx.history, i, p.atrPeriod);
        if (atr == null || atr <= 0) return hold();
        const stop = ctx.bar.close - p.atrMult * atr;
        if (!(ctx.bar.close > stop)) return hold();
        return {
          action: "buy",
          stopLoss: stop,
          takeProfit: mean,
          reason: "close stretched below the mean",
        };
      }
      return hold();
    },
  };
}

function createBreakout(params: Record<string, number>): StrategyInstance {
  const p = pack(params, breakoutParams);
  let day = "";
  let rangeHigh = 0;
  let rangeLow = 0;
  let count = 0;
  let armed = false;
  let entered = false;
  return {
    onBar(ctx: BarContext): Signal {
      const today = dubaiDayKey(new Date(ctx.bar.time));
      if (today !== day) {
        day = today;
        rangeHigh = ctx.bar.high;
        rangeLow = ctx.bar.low;
        count = 1;
        armed = count >= p.rangeBars;
        entered = false;
        if (ctx.position) return { action: "close", fill: "this-close", reason: "flat into the new Dubai day" };
        return hold();
      }
      const last = isLastBarOfDubaiDay(ctx.bar.time, ctx.barDurationMs);
      if (!armed) {
        rangeHigh = Math.max(rangeHigh, ctx.bar.high);
        rangeLow = Math.min(rangeLow, ctx.bar.low);
        count += 1;
        if (count >= p.rangeBars) armed = true;
        if (last && ctx.position) return { action: "close", fill: "this-close", reason: "session flat" };
        return hold();
      }
      if (last && ctx.position) return { action: "close", fill: "this-close", reason: "session flat" };
      if (!ctx.position && !entered && ctx.bar.close > rangeHigh && rangeHigh > rangeLow) {
        entered = true;
        const stop = rangeLow;
        const risk = ctx.bar.close - stop;
        if (!(risk > 0)) return hold();
        return {
          action: "buy",
          stopLoss: stop,
          takeProfit: ctx.bar.close + p.rewardRisk * risk,
          reason: "close broke the Dubai opening range",
        };
      }
      return hold();
    },
  };
}

function createIntraday(params: Record<string, number>): StrategyInstance {
  const p = pack(params, intraParams);
  let day = "";
  let entered = false;
  return {
    onBar(ctx: BarContext): Signal {
      const today = dubaiDayKey(new Date(ctx.bar.time));
      if (today !== day) {
        day = today;
        entered = false;
        if (ctx.position) return { action: "close", fill: "this-close", reason: "flat into the new Dubai day" };
      }
      const last = isLastBarOfDubaiDay(ctx.bar.time, ctx.barDurationMs);
      if (last && ctx.position) return { action: "close", fill: "this-close", reason: "session flat" };
      const closes = ctx.history.map((c) => c.close);
      const i = closes.length - 1;
      const fast = emaSeries(closes, p.fast);
      const slow = emaSeries(closes, p.slow);
      if (fast[i] == null || slow[i] == null) return hold();
      if (ctx.position && fast[i]! < slow[i]!) return { action: "close", reason: "fast EMA lost the slow EMA" };
      const priorEnd = i - 1;
      const priorStart = priorEnd - (p.breakout - 1);
      const priorHigh = highestHigh(ctx.history, priorStart, priorEnd);
      if (!ctx.position && !entered && priorHigh != null && fast[i]! > slow[i]! && ctx.bar.close > priorHigh) {
        const atr = atrAt(ctx.history, i, p.atrPeriod);
        if (atr == null || atr <= 0) return hold();
        const stop = ctx.bar.close - p.atrMult * atr;
        if (!(stop < ctx.bar.close)) return hold();
        entered = true;
        return {
          action: "buy",
          stopLoss: stop,
          takeProfit: ctx.bar.close + p.atrMult * atr * 1.5,
          reason: "intraday momentum break of the prior high",
        };
      }
      return hold();
    },
  };
}

const trendParams: ParamSpec[] = [
  { key: "lookback", label: "Breakout lookback", min: 10, max: 120, step: 1, default: 55 },
  { key: "atrPeriod", label: "ATR period", min: 5, max: 40, step: 1, default: 14 },
  { key: "atrMult", label: "ATR stop multiple", min: 1, max: 6, step: 0.1, default: 3 },
  { key: "rewardRisk", label: "Target / risk", min: 1, max: 6, step: 0.1, default: 3 },
];

function createTrend(params: Record<string, number>): StrategyInstance {
  const p = pack(params, trendParams);
  const closes: number[] = [];
  let fast: number | null = null;
  let slow: number | null = null;
  const kFast = 2 / 21;
  const kSlow = 2 / 51;
  return {
    onBar(ctx: BarContext): Signal {
      const i = ctx.history.length - 1;
      if (ctx.index === 0) {
        closes.length = 0;
        fast = null;
        slow = null;
      }
      if (closes.length === i) {
        closes.push(ctx.bar.close);
        if (closes.length === 20) fast = closes.reduce((sum, value) => sum + value, 0) / 20;
        else if (fast != null) fast = ctx.bar.close * kFast + fast * (1 - kFast);
        if (closes.length === 50) slow = closes.reduce((sum, value) => sum + value, 0) / 50;
        else if (slow != null) slow = ctx.bar.close * kSlow + slow * (1 - kSlow);
      }
      if (i < p.lookback || i < p.atrPeriod) return hold();
      const priorHigh = highestHigh(ctx.history, i - p.lookback, i - 1);
      const atr = atrAt(ctx.history, i, p.atrPeriod);
      if (priorHigh == null || atr == null || atr <= 0) return hold();
      if (ctx.position && fast != null && slow != null && fast < slow) {
        return { action: "close", reason: "trend lost: 20 EMA crossed under 50 EMA" };
      }
      if (!ctx.position && ctx.bar.close > priorHigh && fast != null && slow != null && fast > slow) {
        const stop = ctx.bar.close - p.atrMult * atr;
        if (!(stop < ctx.bar.close)) return hold();
        return {
          action: "buy",
          stopLoss: stop,
          takeProfit: ctx.bar.close + p.rewardRisk * (ctx.bar.close - stop),
          reason: "close broke the prior high with the 20/50 EMA still up",
        };
      }
      return hold();
    },
  };
}

export const STRATEGIES: StrategyDefinition[] = [
  {
    id: "ts-trend",
    name: "Time-series trend",
    description: "4H and daily. Buys a break of the prior N-bar high only while the 20 EMA is above the 50 EMA. Stop is an ATR multiple and the target is a multiple of that risk. Holds for multiple bars. Intended to run only when BTC is above its 200-day average.",
    timeframes: ["4H", "1D"],
    params: trendParams,
    create: createTrend,
  },
  {
    id: "ema-momentum",
    name: "EMA momentum",
    description: "Long-only spot. Buys when the fast EMA crosses above the slow EMA and exits on the cross down. Stop is an ATR multiple. Meant for 1H and 4H, not tuned to a daily return target.",
    timeframes: ["15m", "1H", "4H"],
    params: emaParams,
    create: createEma,
  },
  {
    id: "mean-reversion",
    name: "Mean reversion",
    description: "Long-only spot. Buys when the close is a chosen number of standard deviations below its mean, and exits as price snaps back. Stop is an ATR multiple.",
    timeframes: ["5m", "15m", "1H"],
    params: meanParams,
    create: createMean,
  },
  {
    id: "session-breakout",
    name: "Dubai session breakout",
    description: "Intraday, long-only, flat by the Dubai close. The first bars of the Dubai day set a range. A close above that range buys, with the stop at the range low. No overnight hold.",
    timeframes: ["1m", "5m", "15m"],
    params: breakoutParams,
    create: createBreakout,
  },
  {
    id: "intraday-momentum",
    name: "Intraday momentum",
    description: "Short-timeframe, long-only. Enters when the fast EMA is above the slow EMA and the close breaks the prior N-bar high. Flattens at the Dubai day boundary. Built for 1m, 5m, and 15m.",
    timeframes: ["1m", "5m", "15m"],
    params: intraParams,
    create: createIntraday,
  },
];

export function getStrategy(id: string): StrategyDefinition | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function defaultParams(strategy: StrategyDefinition): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of strategy.params) out[spec.key] = spec.default;
  return out;
}

export const BAR_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

export function normalizeBar(input: string): string {
  const key = input.trim();
  const map: Record<string, string> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1H",
    "1H": "1H",
    "4h": "4H",
    "4H": "4H",
    "1d": "1D",
    "1D": "1D",
  };
  return map[key] ?? "15m";
}
