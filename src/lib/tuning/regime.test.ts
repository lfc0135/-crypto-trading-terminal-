import { describe, expect, it } from "vitest";
import type { Candle } from "../types";
import { buildRegime, regimeAllows } from "./regime";

function daily(count: number, start: number, step: number): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i += 1) {
    price += step;
    const time = Date.UTC(2021, 0, 1) + i * 24 * 60 * 60_000;
    out.push({ time, open: price - step / 2, high: price + 1, low: price - 1, close: price, volume: 1 });
  }
  return out;
}

describe("BTC regime", () => {
  it("allows longs only above the 200-day average when daily ATR is not extreme", () => {
    const calm = buildRegime(daily(220, 100, 0.2));
    const last = calm[calm.length - 1];
    expect(last.aboveMa).toBe(true);
    expect(last.allow).toBe(true);
    expect(regimeAllows(calm, last.time)).toBe(true);
    expect(regimeAllows(calm, calm[100].time)).toBe(false);
  });

  it("stays flat when daily ATR is more than 6% of price", () => {
    const candles = daily(220, 100, 0.2);
    for (let i = candles.length - 14; i < candles.length; i += 1) {
      candles[i].high = candles[i].close * 1.15;
      candles[i].low = candles[i].close * 0.85;
    }
    const wild = buildRegime(candles);
    expect(wild[wild.length - 1].allow).toBe(false);
  });
});
