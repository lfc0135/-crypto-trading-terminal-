/** First pullback after a hype spike. Paper replay and the optional live preset share this rule. */

export type PullbackConfirm = "higher-low" | "reclaim";

export interface PullbackRules {
  spikePct: number;
  spikeBars: number;
  retrace: number;
  confirm: PullbackConfirm;
  maxPullbackBars: number;
  stopBuffer: number;
  volumeMultiple: number;
}

export const DEFAULT_PULLBACK = {
  entryMode: "breakout" as const,
  spikePct: 0.3,
  spikeBars: 12,
  retrace: 0.4,
  confirm: "higher-low" as const,
  maxPullbackBars: 24,
  stopBuffer: 0.005,
};

export interface PullbackBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PullbackSignal {
  ok: boolean;
  reasons: string[];
  spikeLow: number | null;
  spikeHigh: number | null;
  pullbackLow: number | null;
  stop: number | null;
  retracePct: number | null;
}

export interface PullbackEntry {
  time: number;
  spikeLow: number;
  spikeHigh: number;
  pullbackLow: number;
  stop: number;
  retracePct: number;
}

/** 24 combos. Spike size stays fixed at +30% in 60 minutes with 3× volume. */
export const PULLBACK_GRID = [
  { id: "pb-r25-hl-tp12-hold60", retrace: 0.25, confirm: "higher-low" as const, takeProfit: 0.12, maxHoldMs: 60 * 60_000 },
  { id: "pb-r25-hl-tp12-hold180", retrace: 0.25, confirm: "higher-low" as const, takeProfit: 0.12, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r25-hl-tp20-hold60", retrace: 0.25, confirm: "higher-low" as const, takeProfit: 0.2, maxHoldMs: 60 * 60_000 },
  { id: "pb-r25-hl-tp20-hold180", retrace: 0.25, confirm: "higher-low" as const, takeProfit: 0.2, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r25-rc-tp12-hold60", retrace: 0.25, confirm: "reclaim" as const, takeProfit: 0.12, maxHoldMs: 60 * 60_000 },
  { id: "pb-r25-rc-tp12-hold180", retrace: 0.25, confirm: "reclaim" as const, takeProfit: 0.12, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r25-rc-tp20-hold60", retrace: 0.25, confirm: "reclaim" as const, takeProfit: 0.2, maxHoldMs: 60 * 60_000 },
  { id: "pb-r25-rc-tp20-hold180", retrace: 0.25, confirm: "reclaim" as const, takeProfit: 0.2, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r40-hl-tp12-hold60", retrace: 0.4, confirm: "higher-low" as const, takeProfit: 0.12, maxHoldMs: 60 * 60_000 },
  { id: "pb-r40-hl-tp12-hold180", retrace: 0.4, confirm: "higher-low" as const, takeProfit: 0.12, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r40-hl-tp20-hold60", retrace: 0.4, confirm: "higher-low" as const, takeProfit: 0.2, maxHoldMs: 60 * 60_000 },
  { id: "pb-r40-hl-tp20-hold180", retrace: 0.4, confirm: "higher-low" as const, takeProfit: 0.2, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r40-rc-tp12-hold60", retrace: 0.4, confirm: "reclaim" as const, takeProfit: 0.12, maxHoldMs: 60 * 60_000 },
  { id: "pb-r40-rc-tp12-hold180", retrace: 0.4, confirm: "reclaim" as const, takeProfit: 0.12, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r40-rc-tp20-hold60", retrace: 0.4, confirm: "reclaim" as const, takeProfit: 0.2, maxHoldMs: 60 * 60_000 },
  { id: "pb-r40-rc-tp20-hold180", retrace: 0.4, confirm: "reclaim" as const, takeProfit: 0.2, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r50-hl-tp12-hold60", retrace: 0.5, confirm: "higher-low" as const, takeProfit: 0.12, maxHoldMs: 60 * 60_000 },
  { id: "pb-r50-hl-tp12-hold180", retrace: 0.5, confirm: "higher-low" as const, takeProfit: 0.12, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r50-hl-tp20-hold60", retrace: 0.5, confirm: "higher-low" as const, takeProfit: 0.2, maxHoldMs: 60 * 60_000 },
  { id: "pb-r50-hl-tp20-hold180", retrace: 0.5, confirm: "higher-low" as const, takeProfit: 0.2, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r50-rc-tp12-hold60", retrace: 0.5, confirm: "reclaim" as const, takeProfit: 0.12, maxHoldMs: 60 * 60_000 },
  { id: "pb-r50-rc-tp12-hold180", retrace: 0.5, confirm: "reclaim" as const, takeProfit: 0.12, maxHoldMs: 3 * 60 * 60_000 },
  { id: "pb-r50-rc-tp20-hold60", retrace: 0.5, confirm: "reclaim" as const, takeProfit: 0.2, maxHoldMs: 60 * 60_000 },
  { id: "pb-r50-rc-tp20-hold180", retrace: 0.5, confirm: "reclaim" as const, takeProfit: 0.2, maxHoldMs: 3 * 60 * 60_000 },
] as const;

/** Headline +20% pullback preset: 40% retrace, higher-low, 3-hour hold. */
export const CLASSIC_PULLBACK = {
  entryMode: "pullback" as const,
  retrace: 0.4,
  confirm: "higher-low" as const,
  takeProfit: 0.2,
  hardStop: 0.09,
  progressPct: 0.05,
  progressWindowMs: 45 * 60_000,
  maxHoldMs: 3 * 60 * 60_000,
  spikePct: 0.3,
  spikeBars: 12,
  maxPullbackBars: 24,
  stopBuffer: 0.005,
} as const;

export function fifteenDayNet(dailyPct: number, principal = 10_000): number {
  if (!Number.isFinite(dailyPct)) return NaN;
  return principal * ((1 + dailyPct) ** 15 - 1);
}

export function classifyRug(bars: PullbackBar[], currentLiquidityUsd = 0): { rugged: boolean; peak: number; last: number; drawdown: number } {
  const ordered = [...bars].filter((bar) => bar.high > 0 && bar.close > 0);
  if (ordered.length === 0) return { rugged: currentLiquidityUsd > 0 && currentLiquidityUsd < 5_000, peak: 0, last: 0, drawdown: 0 };
  const peak = Math.max(...ordered.map((bar) => bar.high));
  const last = ordered[ordered.length - 1].close;
  const trough = Math.min(...ordered.map((bar) => bar.low));
  const drawdown = peak > 0 ? 1 - last / peak : 0;
  const flushed = peak > 0 && trough <= peak * 0.2;
  const endedLow = peak > 0 && last <= peak * 0.2;
  const thin = currentLiquidityUsd > 0 && currentLiquidityUsd < 10_000 && drawdown >= 0.7;
  return { rugged: endedLow || (flushed && drawdown >= 0.8) || thin, peak, last, drawdown };
}

/**
 * Current reserve is only used when the pool has not collapsed versus this bar.
 * After a rug, depth is implied from trailing 5-minute USD volume so historical
 * fills are still priced, with larger impact on thin bars.
 */
export function estimateQuoteReserve(bars: PullbackBar[], time: number, currentQuoteReserveUsd: number): number {
  const ordered = [...bars].filter((bar) => bar.close > 0).sort((a, b) => a.time - b.time);
  if (ordered.length === 0) return Math.max(0, currentQuoteReserveUsd);
  const peak = Math.max(...ordered.map((bar) => bar.high));
  const last = ordered[ordered.length - 1];
  const collapsed = peak > 0 && (last.close <= peak * 0.2 || !(currentQuoteReserveUsd >= 10_000));
  if (!collapsed && currentQuoteReserveUsd > 0) return currentQuoteReserveUsd;
  const at = (() => {
    const exact = ordered.findIndex((bar) => bar.time === time);
    if (exact >= 0) return exact;
    let i = ordered.length - 1;
    while (i >= 0 && ordered[i].time > time) i -= 1;
    return i;
  })();
  if (at < 0) return 0;
  const window = ordered.slice(Math.max(0, at - 11), at + 1);
  const recent = ordered.slice(Math.max(0, at - 5), at + 1);
  const vols = window.map((bar) => bar.volume).filter((value) => value > 0).sort((a, b) => a - b);
  const recentVols = recent.map((bar) => bar.volume).filter((value) => value > 0);
  const median = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
  const peakVol = recentVols.length ? Math.max(...recentVols) : 0;
  // 5-minute USD volume is the tape's best depth hint once current liquidity is stale.
  // Size the implied quote so a $150 clip can fill on a busy bar and is rejected on a dead one.
  const implied = Math.max(median * 15, peakVol * 6);
  return collapsed ? implied * 0.75 : implied;
}

function rulesFrom(config: Partial<PullbackRules>): PullbackRules {
  return {
    spikePct: config.spikePct && config.spikePct > 0 ? config.spikePct : DEFAULT_PULLBACK.spikePct,
    spikeBars: config.spikeBars && config.spikeBars >= 6 ? config.spikeBars : DEFAULT_PULLBACK.spikeBars,
    retrace: config.retrace && config.retrace > 0 ? config.retrace : DEFAULT_PULLBACK.retrace,
    confirm: config.confirm === "reclaim" ? "reclaim" : "higher-low",
    maxPullbackBars: config.maxPullbackBars && config.maxPullbackBars >= 6 ? config.maxPullbackBars : DEFAULT_PULLBACK.maxPullbackBars,
    stopBuffer: config.stopBuffer != null && config.stopBuffer >= 0 ? config.stopBuffer : DEFAULT_PULLBACK.stopBuffer,
    volumeMultiple: config.volumeMultiple && config.volumeMultiple >= 2 ? config.volumeMultiple : 3,
  };
}

function volumeSurge(bars: PullbackBar[], startIdx: number, highIdx: number, multiple: number): boolean {
  if (startIdx <= 0 || highIdx <= startIdx) return false;
  const pre = bars.slice(Math.max(0, startIdx - 12), startIdx);
  const avg = pre.length ? pre.reduce((sum, bar) => sum + bar.volume, 0) / pre.length : 0;
  if (!(avg > 0)) return false;
  const leg = bars.slice(startIdx, highIdx + 1);
  const peakVol = Math.max(...leg.map((bar) => bar.volume));
  return peakVol >= avg * multiple;
}

function vwapFrom(bars: PullbackBar[], from: number, to: number): number | null {
  let num = 0;
  let den = 0;
  for (let i = from; i <= to; i += 1) {
    const bar = bars[i];
    const typical = (bar.high + bar.low + bar.close) / 3;
    num += typical * bar.volume;
    den += bar.volume;
  }
  return den > 0 ? num / den : null;
}

interface Setup {
  startIdx: number;
  startLow: number;
  high: number;
  highIdx: number;
  retraceHit: boolean;
  pullbackLow: number;
  pullbackLowIdx: number;
}

function complete(setup: Setup, bar: PullbackBar, rules: PullbackRules): boolean {
  const range = setup.high - setup.startLow;
  if (!(range > 0)) return false;
  const level = setup.high - rules.retrace * range;
  return bar.low <= level;
}

function confirmed(bars: PullbackBar[], i: number, setup: Setup, rules: PullbackRules): boolean {
  if (!setup.retraceHit || i <= setup.highIdx || i <= setup.pullbackLowIdx) return false;
  const bar = bars[i];
  const prev = bars[i - 1];
  if (!(bar.close > bar.open && bar.close > prev.close)) return false;
  if (rules.confirm === "higher-low") {
    return bar.low > setup.pullbackLow;
  }
  const vwap = vwapFrom(bars, setup.startIdx, i);
  return vwap != null && bar.close > vwap;
}

/**
 * Walk the 5-minute tape and emit a signal only on the bar that confirms
 * the first pullback after a +30% volume spike. Does not chase the spike itself.
 */
export function pullbackEntries(bars: PullbackBar[], config: Partial<PullbackRules> = {}): PullbackEntry[] {
  const rules = rulesFrom(config);
  const ordered = [...bars].filter((bar) => bar.close > 0 && bar.high > 0 && bar.low > 0).sort((a, b) => a.time - b.time);
  const out: PullbackEntry[] = [];
  let setup: Setup | null = null;
  for (let i = 0; i < ordered.length; i += 1) {
    const bar = ordered[i];
    if (!setup) {
      const look = ordered.slice(Math.max(0, i - rules.spikeBars), i + 1);
      if (look.length < 4) continue;
      let startIdx = i;
      let startLow = bar.low;
      for (let j = Math.max(0, i - rules.spikeBars); j <= i; j += 1) {
        if (ordered[j].low <= startLow) {
          startLow = ordered[j].low;
          startIdx = j;
        }
      }
      if (startIdx >= i) continue;
      if (!(bar.high / startLow - 1 >= rules.spikePct)) continue;
      if (!volumeSurge(ordered, startIdx, i, rules.volumeMultiple)) continue;
      setup = {
        startIdx,
        startLow,
        high: bar.high,
        highIdx: i,
        retraceHit: false,
        pullbackLow: bar.low,
        pullbackLowIdx: i,
      };
      continue;
    }
    if (i <= setup.highIdx) continue;
    if (bar.high > setup.high) {
      if (!volumeSurge(ordered, setup.startIdx, i, rules.volumeMultiple)) {
        setup = null;
        continue;
      }
      setup.high = bar.high;
      setup.highIdx = i;
      setup.retraceHit = false;
      setup.pullbackLow = bar.low;
      setup.pullbackLowIdx = i;
      continue;
    }
    if (i - setup.highIdx > rules.maxPullbackBars) {
      setup = null;
      continue;
    }
    if (bar.low < setup.startLow) {
      setup = null;
      continue;
    }
    if (!setup.retraceHit && complete(setup, bar, rules)) {
      setup.retraceHit = true;
      setup.pullbackLow = bar.low;
      setup.pullbackLowIdx = i;
    } else if (setup.retraceHit && bar.low < setup.pullbackLow) {
      setup.pullbackLow = bar.low;
      setup.pullbackLowIdx = i;
    }
    if (confirmed(ordered, i, setup, rules)) {
      const range = setup.high - setup.startLow;
      const retracePct = range > 0 ? (setup.high - setup.pullbackLow) / range : 0;
      out.push({
        time: bar.time,
        spikeLow: setup.startLow,
        spikeHigh: setup.high,
        pullbackLow: setup.pullbackLow,
        stop: setup.pullbackLow * (1 - rules.stopBuffer),
        retracePct,
      });
      setup = null;
    }
  }
  return out;
}

export function momentumPullback(bars: PullbackBar[], config: Partial<PullbackRules> = {}): PullbackSignal {
  const ordered = [...bars].filter((bar) => bar.close > 0 && bar.high > 0).sort((a, b) => a.time - b.time);
  if (ordered.length < 8) {
    return { ok: false, reasons: ["Not enough 5-minute bars for a pullback."], spikeLow: null, spikeHigh: null, pullbackLow: null, stop: null, retracePct: null };
  }
  const last = ordered[ordered.length - 1];
  const entries = pullbackEntries(ordered, config);
  const hit = entries.find((row) => row.time === last.time);
  if (!hit) {
    return { ok: false, reasons: ["No confirmed first pullback after a hype spike."], spikeLow: null, spikeHigh: null, pullbackLow: null, stop: null, retracePct: null };
  }
  return {
    ok: true,
    reasons: [],
    spikeLow: hit.spikeLow,
    spikeHigh: hit.spikeHigh,
    pullbackLow: hit.pullbackLow,
    stop: hit.stop,
    retracePct: hit.retracePct,
  };
}

export const MAX_PULLBACK_STOP = 0.3;
