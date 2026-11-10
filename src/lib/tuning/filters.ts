import type { BarContext, Signal, StrategyInstance } from "../backtest/engine";
import { atrAt, emaSeries } from "../indicators";
import type { Candle } from "../types";

export interface FilterFlags {
  trend: boolean;
  volatility: boolean;
  trail: boolean;
}

export const NO_FILTERS: FilterFlags = { trend: false, volatility: false, trail: false };

/** Higher bar for the trend filter. 15m and below use 1H. 1H uses 4H. Above that uses 1D. */
export function higherTimeframeMs(barMs: number): number {
  if (barMs <= 15 * 60_000) return 60 * 60_000;
  if (barMs <= 60 * 60_000) return 4 * 60 * 60_000;
  return 24 * 60 * 60_000;
}

export function aggregateCloses(candles: Candle[], barMs: number, higherMs: number): number[] {
  const step = Math.max(1, Math.round(higherMs / barMs));
  const closes: number[] = [];
  for (let i = step - 1; i < candles.length; i += step) closes.push(candles[i].close);
  return closes;
}

/** True when the last completed higher-timeframe close is above its 200 EMA. False when there is not enough history. */
export function trendAllowsLong(candles: Candle[], barMs: number): boolean {
  const higher = aggregateCloses(candles, barMs, higherTimeframeMs(barMs));
  const ema = emaSeries(higher, 200);
  const last = ema[ema.length - 1];
  if (last == null) return false;
  return higher[higher.length - 1] > last;
}

export function applyFilters(
  inner: StrategyInstance,
  flags: FilterFlags,
  barMs: number,
  atrMult = 2,
): StrategyInstance {
  return {
    onBar(ctx: BarContext): Signal {
      const signal = inner.onBar(ctx);
      if (signal.action === "buy" && (flags.trend || flags.volatility)) {
        if (flags.trend && !trendAllowsLong(ctx.history, barMs)) {
          return { action: "hold", reason: "trend filter: higher-timeframe close is not above the 200 EMA" };
        }
        if (flags.volatility) {
          const atr = atrAt(ctx.history, ctx.history.length - 1, 14);
          const ratio = atr != null && ctx.bar.close > 0 ? atr / ctx.bar.close : null;
          if (ratio == null || ratio < 0.0015 || ratio > 0.04) {
            return { action: "hold", reason: "volatility filter: ATR is outside 0.15%–4% of price" };
          }
        }
      }
      if (flags.trail && ctx.position && signal.action !== "close") {
        const atr = atrAt(ctx.history, ctx.history.length - 1, 14);
        if (atr != null && ctx.bar.close > ctx.position.avgPrice) {
          const trail = ctx.bar.close - atrMult * atr;
          if (ctx.position.stopLoss == null || trail > ctx.position.stopLoss) {
            return { ...signal, trailStop: trail, reason: signal.reason ?? "trail stop tightened" };
          }
        }
      }
      return signal;
    },
  };
}
