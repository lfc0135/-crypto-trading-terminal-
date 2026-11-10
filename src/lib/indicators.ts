import type { Candle } from "./types";

export function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function windowMean(values: number[], end: number, period: number): number | null {
  if (period <= 0 || end + 1 < period || end >= values.length) return null;
  let sum = 0;
  for (let i = end - period + 1; i <= end; i += 1) sum += values[i];
  return sum / period;
}

/** Population standard deviation of the window ending at `end`. */
export function windowStdev(values: number[], end: number, period: number): number | null {
  const mean = windowMean(values, end, period);
  if (mean == null) return null;
  let acc = 0;
  for (let i = end - period + 1; i <= end; i += 1) {
    const d = values[i] - mean;
    acc += d * d;
  }
  return Math.sqrt(acc / period);
}

function trueRange(candles: Candle[], index: number): number {
  const cur = candles[index];
  const prev = candles[index - 1];
  return Math.max(
    cur.high - cur.low,
    Math.abs(cur.high - prev.close),
    Math.abs(cur.low - prev.close),
  );
}

/** Wilder ATR at `end`. Needs `period` completed true ranges before it. */
export function atrAt(candles: Candle[], end: number, period: number): number | null {
  if (period <= 0 || end < period || end >= candles.length) return null;
  let atr = 0;
  for (let i = 1; i <= period; i += 1) atr += trueRange(candles, i);
  atr /= period;
  for (let i = period + 1; i <= end; i += 1) {
    atr = (atr * (period - 1) + trueRange(candles, i)) / period;
  }
  return atr;
}

export function highestHigh(candles: Candle[], start: number, end: number): number | null {
  if (start < 0 || end < start || end >= candles.length) return null;
  let high = -Infinity;
  for (let i = start; i <= end; i += 1) high = Math.max(high, candles[i].high);
  return high;
}
