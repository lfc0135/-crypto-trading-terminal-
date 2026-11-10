import { atrAt, windowMean } from "../indicators";
import type { Candle } from "../types";

/** Daily ATR / close above this is treated as an extreme-volatility regime. */
export const EXTREME_DAILY_ATR_RATIO = 0.06;

export interface RegimePoint {
  time: number;
  allow: boolean;
  aboveMa: boolean;
  atrRatio: number | null;
}

/** Longs are allowed only after a completed daily bar closes above its 200-day average and ATR is not extreme. */
export function buildRegime(btcDaily: Candle[]): RegimePoint[] {
  const closes = btcDaily.map((bar) => bar.close);
  const out: RegimePoint[] = [];
  for (let i = 0; i < btcDaily.length; i += 1) {
    const ma = windowMean(closes, i, 200);
    const atr = atrAt(btcDaily, i, 14);
    const atrRatio = atr != null && closes[i] > 0 ? atr / closes[i] : null;
    const aboveMa = ma != null && closes[i] > ma;
    const calm = atrRatio != null && atrRatio <= EXTREME_DAILY_ATR_RATIO;
    out.push({
      time: btcDaily[i].time,
      allow: aboveMa && calm,
      aboveMa,
      atrRatio,
    });
  }
  return out;
}

/** Use the last BTC daily bar that was already closed at `time`. The same day's bar is usable at its own close. */
export function regimeAllows(points: RegimePoint[], time: number): boolean {
  let allowed = false;
  for (const point of points) {
    if (point.time > time) break;
    allowed = point.allow;
  }
  return allowed;
}
