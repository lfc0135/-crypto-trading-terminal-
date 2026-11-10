import { expectedMoveCoversCost, PAPER_MAKER_FEE_BPS, PAPER_SLIPPAGE_BPS, PAPER_TAKER_FEE_BPS } from "../defaults";
import { atrAt } from "../indicators";
import { DEFAULT_BORROW_DAILY } from "../trading/margin";
import { regimeAllows, type RegimePoint } from "./regime";
import type { Candle } from "../types";

export interface CrossSectionResult {
  trades: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  expectancy: number;
  endingEquity: number;
  notes: string[];
}

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function indexByDay(candles: Candle[]): Map<string, Candle> {
  const map = new Map<string, Candle>();
  for (const bar of candles) map.set(dayKey(bar.time), bar);
  return map;
}

/**
 * Weekly cross-sectional momentum. Holds the strongest `hold` names of the supplied universe,
 * equal weight, only while the BTC regime allows longs. Maker entry, taker exit.
 */
export function runCrossSection(input: {
  series: Record<string, Candle[]>;
  regime: RegimePoint[];
  lookback: number;
  hold?: number;
  rebalanceDays?: number;
  initialEquity?: number;
  atrMult?: number;
  tradeFrom?: number;
  tradeUntil?: number;
}): CrossSectionResult {
  const symbols = Object.keys(input.series);
  const byDay = Object.fromEntries(symbols.map((symbol) => [symbol, indexByDay(input.series[symbol])]));
  const calendar = [...new Set(symbols.flatMap((symbol) => input.series[symbol].map((bar) => dayKey(bar.time))))].sort();
  const hold = input.hold ?? 3;
  const every = input.rebalanceDays ?? 7;
  const equity0 = input.initialEquity ?? 50_000;
  const atrMult = input.atrMult ?? 3;
  let cash = equity0;
  const positions = new Map<string, { qty: number; entry: number; stop: number; borrowed: number }>();
  let peak = equity0;
  let maxDd = 0;
  let trades = 0;
  let pnlSum = 0;
  let lastDay: string | null = null;
  const maker = PAPER_MAKER_FEE_BPS / 10_000;
  const taker = (PAPER_TAKER_FEE_BPS + PAPER_SLIPPAGE_BPS) / 10_000;

  const markOf = (day: string) => {
    let value = cash;
    for (const [symbol, position] of positions) {
      const bar = byDay[symbol].get(day);
      if (bar) value += position.qty * bar.close - position.borrowed;
    }
    return value;
  };

  for (let i = 0; i < calendar.length; i += 1) {
    const day = calendar[i];
    const sample = symbols.map((symbol) => byDay[symbol].get(day)).find(Boolean);
    if (!sample) continue;
    if (input.tradeFrom != null && sample.time < input.tradeFrom) continue;
    if (input.tradeUntil != null && sample.time >= input.tradeUntil) break;
    lastDay = day;
    const allow = regimeAllows(input.regime, sample.time);
    for (const [symbol, position] of [...positions]) {
      const bar = byDay[symbol].get(day);
      if (!bar) continue;
      if (!allow || bar.low <= position.stop) {
        const raw = !allow ? bar.close : bar.open <= position.stop ? bar.open : position.stop;
        const fill = raw * (1 - taker);
        const proceeds = fill * position.qty - position.borrowed;
        const pnl = (fill - position.entry) * position.qty;
        cash += proceeds;
        pnlSum += pnl;
        trades += 1;
        positions.delete(symbol);
      }
    }
    if (i % every === 0 && allow && sample) {
      const ranked: Array<{ symbol: string; momentum: number; atr: number; close: number }> = [];
      for (const symbol of symbols) {
        const history = input.series[symbol].filter((bar) => bar.time <= sample.time);
        if (history.length <= input.lookback) continue;
        const now = history[history.length - 1].close;
        const then = history[history.length - 1 - input.lookback].close;
        const atr = atrAt(history, history.length - 1, 14);
        if (!(then > 0) || atr == null) continue;
        ranked.push({ symbol, momentum: now / then - 1, atr, close: now });
      }
      ranked.sort((a, b) => b.momentum - a.momentum);
      const picks = ranked.filter((row) => row.momentum > 0 && expectedMoveCoversCost(row.close, row.close + atrMult * row.atr)).slice(0, hold);
      const keep = new Set(picks.map((row) => row.symbol));
      for (const [symbol, position] of [...positions]) {
        if (keep.has(symbol)) continue;
        const bar = byDay[symbol].get(day);
        if (!bar) continue;
        const fill = bar.close * (1 - taker);
        cash += fill * position.qty - position.borrowed;
        pnlSum += (fill - position.entry) * position.qty;
        trades += 1;
        positions.delete(symbol);
      }
      const slots = picks.filter((row) => !positions.has(row.symbol));
      if (slots.length > 0) {
        const budget = (cash * 0.2) / slots.length;
        for (const row of slots) {
          const next = calendar[i + 1];
          const fillBar = next ? byDay[row.symbol].get(next) : undefined;
          if (!fillBar || !(fillBar.open > row.close) || !(fillBar.low <= row.close)) continue;
          const notional = budget;
          const margin = notional / 2;
          const fee = notional * maker;
          if (margin + fee > cash) continue;
          cash -= margin + fee;
          positions.set(row.symbol, {
            qty: notional / row.close,
            entry: row.close,
            stop: row.close - atrMult * row.atr,
            borrowed: notional - margin,
          });
        }
      }
    }
    let borrow = 0;
    for (const position of positions.values()) borrow += position.borrowed * DEFAULT_BORROW_DAILY;
    cash -= borrow;
    const equity = markOf(day);
    if (equity > peak) peak = equity;
    if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak);
  }
  const endDay = lastDay;
  if (endDay) {
    for (const [symbol, position] of [...positions]) {
      const bar = byDay[symbol].get(endDay);
      if (!bar) continue;
      const fill = bar.close * (1 - taker);
      cash += fill * position.qty - position.borrowed;
      pnlSum += (fill - position.entry) * position.qty;
      trades += 1;
      positions.delete(symbol);
    }
  }
  const ending = cash;
  return {
    trades,
    totalReturnPct: equity0 > 0 ? ending / equity0 - 1 : 0,
    maxDrawdownPct: maxDd,
    expectancy: trades > 0 ? pnlSum / trades : 0,
    endingEquity: ending,
    notes: [
      "Cross-sectional book holds the strongest names, equal weight, rebalanced every 7 daily bars.",
      "Entries are maker limits at the signal close and fill only if the next day trades down to that price without gapping through it.",
      "Exits and stops pay the taker fee plus slippage. Longs are off unless BTC is above its 200-day average and daily ATR is at most 6% of price.",
    ],
  };
}
