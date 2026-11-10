import { buyExecution, priorityFeeUsd, sellExecution, type TokenCheck } from "./model";

/** Wallet scoring stays in the codebase. Momentum does not require it. */
export interface MomentumConfig {
  walletGate: boolean;
  tradeUsd: number;
  lookbackBars: number;
  volumeMultiple: number;
  takeProfit: number;
  hardStop: number;
  progressPct: number;
  progressWindowMs: number;
  maxHoldMs: number;
  minLiquidityUsd: number;
  minAgeMs: number;
}

/** The +20% rule. Stays selectable even if a tighter combo becomes the default. */
export const CLASSIC_MOMENTUM = {
  takeProfit: 0.2,
  hardStop: 0.09,
  progressPct: 0.05,
  progressWindowMs: 45 * 60_000,
  maxHoldMs: 3 * 60 * 60_000,
} as const;

/** Six combos. Not a full factorial. The classic +20% rule is reported beside them and is not in this list. */
export const TUNE_GRID = [
  { id: "tp10-stop6-p3-20m-hold60", takeProfit: 0.1, hardStop: 0.06, progressPct: 0.03, progressWindowMs: 20 * 60_000, maxHoldMs: 60 * 60_000 },
  { id: "tp10-stop8-p5-30m-hold90", takeProfit: 0.1, hardStop: 0.08, progressPct: 0.05, progressWindowMs: 30 * 60_000, maxHoldMs: 90 * 60_000 },
  { id: "tp10-stop9-p3-30m-hold60", takeProfit: 0.1, hardStop: 0.09, progressPct: 0.03, progressWindowMs: 30 * 60_000, maxHoldMs: 60 * 60_000 },
  { id: "tp12-stop6-p5-20m-hold90", takeProfit: 0.12, hardStop: 0.06, progressPct: 0.05, progressWindowMs: 20 * 60_000, maxHoldMs: 90 * 60_000 },
  { id: "tp12-stop8-p3-30m-hold60", takeProfit: 0.12, hardStop: 0.08, progressPct: 0.03, progressWindowMs: 30 * 60_000, maxHoldMs: 60 * 60_000 },
  { id: "tp12-stop9-p5-20m-hold90", takeProfit: 0.12, hardStop: 0.09, progressPct: 0.05, progressWindowMs: 20 * 60_000, maxHoldMs: 90 * 60_000 },
] as const;

export function defaultMomentumConfig(): MomentumConfig {
  return {
    walletGate: false,
    tradeUsd: 150,
    lookbackBars: 6,
    volumeMultiple: 3,
    takeProfit: 0.2,
    hardStop: 0.09,
    progressPct: 0.05,
    progressWindowMs: 45 * 60 * 1000,
    maxHoldMs: 3 * 60 * 60 * 1000,
    minLiquidityUsd: 50_000,
    minAgeMs: 5 * 60 * 1000,
  };
}

export function normalizeConfig(raw: Partial<MomentumConfig> | null | undefined): MomentumConfig {
  const base = defaultMomentumConfig();
  if (!raw) return base;
  const trade = Number(raw.tradeUsd);
  const stop = Number(raw.hardStop);
  return {
    ...base,
    ...raw,
    walletGate: raw.walletGate === true,
    tradeUsd: trade >= 100 && trade <= 250 ? trade : base.tradeUsd,
    hardStop: stop >= 0.06 && stop <= 0.09 ? stop : base.hardStop,
    takeProfit: preset(raw.takeProfit, [0.1, 0.12, 0.2], base.takeProfit),
    progressPct: preset(raw.progressPct, [0.03, 0.05], base.progressPct),
    progressWindowMs: preset(raw.progressWindowMs, [20 * 60_000, 30 * 60_000, 45 * 60_000], base.progressWindowMs),
    maxHoldMs: preset(raw.maxHoldMs, [60 * 60_000, 90 * 60_000, 3 * 60 * 60_000], base.maxHoldMs),
    lookbackBars: raw.lookbackBars && raw.lookbackBars >= 3 && raw.lookbackBars <= 12 ? raw.lookbackBars : base.lookbackBars,
    volumeMultiple: raw.volumeMultiple && raw.volumeMultiple >= 2 && raw.volumeMultiple <= 8 ? raw.volumeMultiple : base.volumeMultiple,
  };
}

export function halfDays(times: number[]): { trainFrom: number; trainUntil: number; testFrom: number; testUntil: number; trainDays: string[]; testDays: string[] } | null {
  const days = [...new Set(times.map((time) => new Date(time).toISOString().slice(0, 10)))].sort();
  if (days.length < 2) return null;
  const mid = Math.ceil(days.length / 2);
  const trainDays = days.slice(0, mid);
  const testDays = days.slice(mid);
  if (testDays.length === 0) return null;
  const testFrom = Date.parse(`${testDays[0]}T00:00:00Z`);
  const testUntil = Date.parse(`${testDays[testDays.length - 1]}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  return {
    trainFrom: Date.parse(`${trainDays[0]}T00:00:00Z`),
    trainUntil: testFrom,
    testFrom,
    testUntil,
    trainDays,
    testDays,
  };
}

/** Highest out-of-sample daily sleeve return among combos with enough trades. In-sample is ignored. */
export function presetPatch(id: string): Partial<MomentumConfig> | null {
  if (id === "classic-tp20") return { ...CLASSIC_MOMENTUM, walletGate: false };
  const row = TUNE_GRID.find((item) => item.id === id);
  if (!row) return null;
  return {
    takeProfit: row.takeProfit,
    hardStop: row.hardStop,
    progressPct: row.progressPct,
    progressWindowMs: row.progressWindowMs,
    maxHoldMs: row.maxHoldMs,
    walletGate: false,
  };
}

export function pickOosWinner<T extends { id: string; oosDaily: number; oosTrades: number }>(rows: T[], minTrades = 15): T | null {
  const eligible = rows.filter((row) => row.oosTrades >= minTrades && row.oosDaily > 0);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, row) => (row.oosDaily > best.oosDaily ? row : best));
}

function preset(value: number | undefined, allowed: number[], fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const hit = allowed.find((item) => Math.abs(item - value) < 1e-6);
  return hit ?? fallback;
}

export interface MomentumBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  buys?: number | null;
}

export interface MomentumSignal {
  ok: boolean;
  reasons: string[];
  priorHigh: number | null;
  volumeRatio: number | null;
}

export function momentumBreakout(
  bars: MomentumBar[],
  config: MomentumConfig,
  buys?: { now: number | null; average: number | null },
): MomentumSignal {
  const ordered = [...bars].filter((bar) => bar.close > 0 && bar.high > 0).sort((a, b) => a.time - b.time);
  const need = config.lookbackBars + 2;
  if (ordered.length < need) {
    return { ok: false, reasons: ["Not enough 5-minute bars for a 30-minute breakout."], priorHigh: null, volumeRatio: null };
  }
  const last = ordered[ordered.length - 1];
  const prev = ordered[ordered.length - 2];
  const prev2 = ordered[ordered.length - 3];
  const prior = ordered.slice(-(config.lookbackBars + 1), -1);
  const priorHigh = Math.max(...prior.map((bar) => bar.high));
  const volAvg = prior.reduce((sum, bar) => sum + bar.volume, 0) / prior.length;
  const volumeRatio = volAvg > 0 ? last.volume / volAvg : null;
  const reasons: string[] = [];
  if (!(last.close > priorHigh)) reasons.push("Price is not above the recent high.");
  if (volumeRatio == null || volumeRatio < config.volumeMultiple) reasons.push("5-minute volume is under 3× its recent average.");
  const retNow = prev.close > 0 ? last.close / prev.close - 1 : 0;
  const retPrev = prev2.close > 0 ? prev.close / prev2.close - 1 : 0;
  if (!(retNow > retPrev && retNow > 0)) reasons.push("Price is not accelerating upward.");
  const buyNow = last.buys ?? buys?.now ?? null;
  const buyPrev = prev.buys ?? (buys?.average != null ? buys.average : null);
  const tapeHasBuys = ordered.some((bar) => bar.buys != null) || buys?.now != null || buys?.average != null;
  if (tapeHasBuys) {
    if (buyNow == null || buyPrev == null) reasons.push("Buy-transaction counts are missing on this tape.");
    else if (!(buyNow > buyPrev && buyNow > 0)) reasons.push("Buy-transaction count is not rising.");
  }
  return { ok: reasons.length === 0, reasons, priorHigh, volumeRatio };
}

/** Minimal gate: sellable, authorities revoked, enough liquidity, not brand new. */
export function evaluateMomentumSafety(token: TokenCheck): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (token.graduated === false) reasons.push("Token is still on the bonding curve.");
  else if (token.graduated !== true) reasons.push("Pool venue is unverified.");
  if (token.mintRevoked !== true) reasons.push(token.mintRevoked === false ? "Mint authority is still set." : "Mint authority is unverified.");
  if (token.freezeRevoked !== true) reasons.push(token.freezeRevoked === false ? "Freeze authority is still set." : "Freeze authority is unverified.");
  const simOk = token.sellProceedsUsd != null && token.sellProceedsUsd > 0;
  if (token.honeypot === true || token.sellProceedsUsd === 0) reasons.push("A simulated sell does not return funds.");
  else if (!simOk && token.honeypot !== false) reasons.push("Sellability is unverified.");
  if (token.liquidityUsd == null || token.liquidityUsd < 50_000) reasons.push("Liquidity is under $50,000.");
  if (token.ageMs == null || token.ageMs < 5 * 60 * 1000) reasons.push("Token is under 5 minutes old.");
  if (!(token.price != null && token.price > 0) || !(token.quoteReserveUsd != null && token.quoteReserveUsd > 0)) reasons.push("Pool depth is missing.");
  return { pass: reasons.length === 0, reasons };
}

export interface ReplaySeries {
  symbol: string;
  address: string;
  bars: MomentumBar[];
  quoteReserveUsd: number;
  feeRate: number;
  safetyPass: boolean;
}

export interface ReplayTrade {
  symbol: string;
  entryTime: number;
  exitTime: number;
  pnlUsd: number;
  pnlPct: number;
  reason: "take-profit" | "hard-stop" | "time-stop" | "max-hold";
}

export interface ReplayReport {
  scanned: number;
  tradedNames: number;
  excludedSafety: number;
  trades: ReplayTrade[];
  hitRate: number;
  avgWinPct: number | null;
  avgLossPct: number | null;
  expectancyPct: number | null;
  spanDays: number;
  totalPnlUsd: number;
  sleeveDailyPct: number;
  tradeDayAvgPct: number | null;
  flatDays: number;
  note: string;
}

interface OpenReplay {
  symbol: string;
  qty: number;
  avgCost: number;
  spent: number;
  openedAt: number;
  peak: number;
  reserve: number;
  feeRate: number;
  entryTime: number;
}

/**
 * One shared $2,500 sleeve across the supplied names. Same-bar stop is assumed
 * before take-profit. Buy counts are used when a bar has them.
 */
export function replayPortfolio(
  series: ReplaySeries[],
  config: MomentumConfig,
  priorityUsd = 0.02,
  window?: { from?: number; until?: number },
): ReplayReport {
  const usable = series.filter((row) => row.safetyPass && row.bars.length > config.lookbackBars + 3 && row.quoteReserveUsd > 0);
  const times = [...new Set(usable.flatMap((row) => row.bars.map((bar) => bar.time)))].sort((a, b) => a - b);
  const barAt = new Map<string, Map<number, MomentumBar>>();
  for (const row of usable) {
    const map = new Map<number, MomentumBar>();
    for (const bar of [...row.bars].sort((a, b) => a.time - b.time)) map.set(bar.time, bar);
    barAt.set(row.symbol, map);
  }
  let cash = 2_500;
  const open: OpenReplay[] = [];
  const trades: ReplayTrade[] = [];
  let dayKey = "";
  let dayPnl = 0;
  let paused = false;
  const dayReturns: number[] = [];

  const close = (position: OpenReplay, time: number, mid: number, reason: ReplayTrade["reason"]) => {
    const exec = sellExecution(mid, position.qty, position.reserve, position.feeRate);
    const proceeds = exec ? exec.proceeds : 0;
    const pnl = proceeds - priorityUsd - position.spent;
    cash += Math.max(0, proceeds - priorityUsd);
    trades.push({
      symbol: position.symbol,
      entryTime: position.entryTime,
      exitTime: time,
      pnlUsd: pnl,
      pnlPct: position.spent > 0 ? pnl / position.spent : 0,
      reason,
    });
    dayPnl += pnl;
    const index = open.indexOf(position);
    if (index >= 0) open.splice(index, 1);
  };

  for (const time of times) {
    const key = new Date(time).toISOString().slice(0, 10);
    if (dayKey && key !== dayKey) {
      dayReturns.push(dayPnl / 2_500);
      dayPnl = 0;
      paused = false;
    }
    dayKey = key;
    for (const position of [...open]) {
      if (time < position.openedAt) continue;
      const bar = barAt.get(position.symbol)?.get(time);
      if (!bar) continue;
      if (bar.high > position.peak) position.peak = bar.high;
      const hard = position.avgCost * (1 - config.hardStop);
      const tpMid = position.avgCost * (1 + config.takeProfit);
      const stopFirst = bar.low <= hard;
      if (stopFirst) {
        const fill = bar.open < hard ? bar.open : hard;
        close(position, time, fill, "hard-stop");
        continue;
      }
      if (bar.high >= tpMid) {
        close(position, time, tpMid, "take-profit");
        continue;
      }
      const age = time - position.openedAt;
      const progressed = position.peak >= position.avgCost * (1 + config.progressPct);
      if (age >= config.maxHoldMs) close(position, time, bar.close, "max-hold");
      else if (age >= config.progressWindowMs && !progressed) close(position, time, bar.close, "time-stop");
    }
    if (paused || dayPnl <= -250) {
      paused = dayPnl <= -250;
      continue;
    }
    const openWindow = (window?.from == null || time >= window.from) && (window?.until == null || time < window.until);
    if (!openWindow) continue;
    for (const row of usable) {
      if (open.some((position) => position.symbol === row.symbol)) continue;
      if (open.length >= 5 || cash < config.tradeUsd) continue;
      const history = row.bars.filter((bar) => bar.time <= time);
      const last = history[history.length - 1];
      if (!last || last.time !== time) continue;
      const signal = momentumBreakout(history, config);
      if (!signal.ok) continue;
      const next = row.bars.find((bar) => bar.time > time);
      if (!next) continue;
      const budget = config.tradeUsd;
      const exec = buyExecution(next.open, budget - priorityUsd, row.quoteReserveUsd, row.feeRate);
      if (!exec) continue;
      cash -= budget;
      open.push({
        symbol: row.symbol,
        qty: exec.tokens,
        avgCost: budget / exec.tokens,
        spent: budget,
        openedAt: next.time,
        peak: exec.price,
        reserve: row.quoteReserveUsd,
        feeRate: row.feeRate,
        entryTime: next.time,
      });
    }
  }
  if (dayKey) dayReturns.push(dayPnl / 2_500);
  const wins = trades.filter((trade) => trade.pnlUsd > 0);
  const losses = trades.filter((trade) => trade.pnlUsd <= 0);
  const avg = (rows: ReplayTrade[]) => (rows.length ? rows.reduce((sum, trade) => sum + trade.pnlPct, 0) / rows.length : null);
  const spanStart = window?.from ?? times[0] ?? 0;
  const spanEnd = window?.until ?? times[times.length - 1] ?? spanStart;
  const spanMs = spanEnd > spanStart ? spanEnd - spanStart : (times.length > 1 ? times[times.length - 1] - times[0] : 0);
  const spanDays = spanMs > 0 ? spanMs / (24 * 60 * 60 * 1000) : 0;
  const totalPnlUsd = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const tradeDays = dayReturns.filter((value) => value !== 0);
  return {
    scanned: series.length,
    tradedNames: usable.length,
    excludedSafety: series.length - usable.length,
    trades,
    hitRate: trades.length ? wins.length / trades.length : 0,
    avgWinPct: avg(wins),
    avgLossPct: avg(losses),
    expectancyPct: avg(trades),
    spanDays,
    totalPnlUsd,
    sleeveDailyPct: spanDays > 0 ? totalPnlUsd / 2_500 / spanDays : 0,
    tradeDayAvgPct: tradeDays.length ? tradeDays.reduce((sum, value) => sum + value, 0) / tradeDays.length : null,
    flatDays: dayReturns.filter((value) => value === 0).length,
    note: "Replay waits for the next 5-minute bar, charges pool impact and a priority fee, and takes the stop before the target when both trade. GeckoTerminal candles have no buy counts, so this replay does not enforce the rising-buy rule. The live loop does, using the pool's 5-minute versus hourly buy counts. The universe is pools that still exist.",
  };
}
