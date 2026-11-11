/**
 * Strategy-search engine for the meme sleeve. Paper research only.
 * Each candidate trade is simulated on its own pool tape with the same pool-impact
 * cost model as the momentum replay (buyExecution / sellExecution, 0.25% pool fee,
 * $0.02 priority fee per transaction, depth implied from trailing volume once a pool
 * collapses) plus an extra thin-pool slippage haircut on every fill. A shared
 * $2,500 sleeve then admits trades in time order: $150 a trade, max 5 open, one per
 * pool, and a $250 realized daily loss pause.
 */
import { buyExecution, sellExecution } from "./model";
import { estimateQuoteReserve, pullbackEntries } from "./pullback";

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

export interface Tape {
  symbol: string;
  pool: string;
  bars: Bar[];
  quoteReserveUsd: number;
  createdMs: number;
  rugged: boolean;
  /** Launchpad graduation time (pump.fun / letsbonk completed_at), if known. */
  graduatedMs?: number | null;
}

export type EntryFamily = "breakout" | "pullback" | "early-accel" | "flush" | "graduation";

export interface EntryRule {
  family: EntryFamily;
  // breakout
  lookbackBars?: number;
  volumeMultiple?: number;
  // pullback
  retrace?: number;
  confirm?: "higher-low" | "reclaim";
  // pullback / flush filters
  minSpikeVolUsd?: number;
  minLiquidityUsd?: number;
  maxAgeHours?: number;
  // early-accel
  earlyHours?: number;
  accelBars?: number;
  accelMinMovePct?: number;
  // flush
  flushPct?: number;
  flushBars?: number;
  minFlushVolUsd?: number;
  // graduation window
  minGradVolUsd?: number;
  gradMinMs?: number;
  gradMaxMs?: number;
  // time of day: allowed UTC 8-hour buckets (0: 00-08, 1: 08-16, 2: 16-24)
  hourBuckets?: number[];
}

export interface ExitRule {
  stopPct?: number; // fixed stop under fill; ignored when the entry supplies a structure stop and useStructureStop
  useStructureStop?: boolean;
  takeProfit?: number | null; // full close at +x unless scaleFraction set
  scaleFraction?: number; // sell this share at takeProfit, trail the rest
  breakevenAfterScale?: boolean;
  trailActivate?: number | null; // start trailing once peak >= fill*(1+x)
  trailPct?: number | null;
  targetHalfRetrace?: boolean; // flush: target = low + 50% of the flush
  maxHoldMs: number;
  /** Widest allowed structure stop below the fill (default 30%). */
  maxStructureStop?: number;
  /** If set, a structure stop wider than this is tightened to fill*(1-x) instead of skipping the trade. */
  capStructureStop?: number;
}

export interface Candidate { pool: string; symbol: string; signalTime: number; fillIdx: number; stop: number | null; target: number | null; rugged: boolean }

export interface SimTrade {
  symbol: string;
  pool: string;
  rugged: boolean;
  entryTime: number;
  exitTime: number;
  pnlUsd: number;
  pnlPct: number;
  reason: string;
  /** Bar time of the half-at-target sale, if it happened (live journal uses this). */
  scaledAt?: number | null;
  scaleProceedsUsd?: number | null;
}

export const TRADE_USD = 150;
export const SLEEVE_USD = 2_500;
export const PRIORITY_USD = 0.02;
export const POOL_FEE = 0.0025;
const MAX_STRUCTURE_STOP = 0.3;

/** Extra slippage per side on top of constant-product impact. Thin pools pay more. */
export function thinSlip(reserveUsd: number): number {
  if (reserveUsd < 25_000) return 0.015;
  if (reserveUsd < 75_000) return 0.008;
  if (reserveUsd < 250_000) return 0.004;
  return 0.002;
}

function bucketOf(time: number): number {
  return Math.floor(new Date(time).getUTCHours() / 8);
}

const timeIndex = new WeakMap<Bar[], Map<number, number>>();

/**
 * Quote-side depth for a fill. Starts from the momentum replay's estimate, then caps it at
 * 20x the median 5-minute USD volume of the trailing hour. A pool whose bars trade $60 cannot
 * absorb a $150 clip at the quoted price, whatever its listed reserve says.
 */
export function reserveAt(tape: Tape, time: number): number {
  const est = estimateQuoteReserve(tape.bars, time, tape.quoteReserveUsd);
  const base = est > 0 ? est : Math.max(0, tape.quoteReserveUsd);
  let index = timeIndex.get(tape.bars);
  if (!index) {
    index = new Map(tape.bars.map((b, i) => [b.time, i]));
    timeIndex.set(tape.bars, index);
  }
  const at = index.get(time);
  if (at == null) return base;
  // Bar 0 can carry the migration print, so depth starts at bar 1.
  const vols = tape.bars.slice(Math.max(1, at - 12), at).map((b) => b.volume).filter((v) => v > 0).sort((a, b) => a - b);
  if (vols.length === 0) return 0;
  const median = vols[Math.floor(vols.length / 2)];
  return Math.min(base, median * 20);
}

/** Stop fills on a breaking bar: at the level if the bar closes back above it, else halfway to the close. */
function stopFill(b: Bar, level: number): number {
  if (b.open < level) return b.open;
  // Sensitivity switch for research runs only: fill exactly at the level, as the momentum replay does.
  if (typeof process !== "undefined" && process.env.STRATEGY_STOP_FILL === "level") return level;
  if (b.close >= level) return level;
  return (level + Math.max(b.close, b.low)) / 2;
}

/** Signal bars for one tape. The fill is the next bar's open (must exist within 15 minutes). */
export function candidates(tape: Tape, rule: EntryRule): Candidate[] {
  const bars = tape.bars;
  const out: Candidate[] = [];
  const push = (i: number, stop: number | null, target: number | null) => {
    const next = bars[i + 1];
    if (!next || next.time - bars[i].time > 15 * 60_000) return;
    if (rule.hourBuckets && !rule.hourBuckets.includes(bucketOf(next.time))) return;
    if (rule.maxAgeHours != null) {
      if (!Number.isFinite(tape.createdMs)) return;
      if (next.time - tape.createdMs > rule.maxAgeHours * 3_600_000) return;
    }
    if (rule.minLiquidityUsd != null && reserveAt(tape, next.time) * 2 < rule.minLiquidityUsd) return;
    out.push({ pool: tape.pool, symbol: tape.symbol, signalTime: bars[i].time, fillIdx: i + 1, stop, target, rugged: tape.rugged });
  };
  if (rule.family === "breakout") {
    const lb = rule.lookbackBars ?? 6;
    const vm = rule.volumeMultiple ?? 3;
    for (let i = lb + 1; i < bars.length - 1; i += 1) {
      const prior = bars.slice(i - lb, i);
      const hi = Math.max(...prior.map((b) => b.high));
      const avgVol = prior.reduce((s, b) => s + b.volume, 0) / lb;
      const b = bars[i];
      if (b.close > hi && avgVol > 0 && b.volume >= avgVol * vm && b.close > bars[i - 1].close && b.close - b.open > 0) push(i, null, null);
    }
  } else if (rule.family === "pullback") {
    const index = new Map(bars.map((b, i) => [b.time, i]));
    for (const e of pullbackEntries(bars, { retrace: rule.retrace ?? 0.5, confirm: rule.confirm ?? "higher-low" })) {
      const i = index.get(e.time);
      if (i == null) continue;
      if (rule.minSpikeVolUsd != null) {
        let peakVol = 0;
        for (let j = i; j >= 0 && bars[i].time - bars[j].time <= 3 * 3_600_000; j -= 1) {
          if (bars[j].high >= e.spikeHigh * 0.999) { peakVol = Math.max(...bars.slice(Math.max(0, j - 12), j + 1).map((b) => b.volume)); break; }
        }
        if (peakVol < rule.minSpikeVolUsd) continue;
      }
      push(i, e.stop, null);
    }
  } else if (rule.family === "early-accel") {
    const first = bars[0];
    if (!first) return out;
    const created = Number.isFinite(tape.createdMs) ? tape.createdMs : first.time;
    // Only pools whose tape starts near launch, so "early" is real.
    if (first.time - created > 2 * 3_600_000) return out;
    const n = rule.accelBars ?? 3;
    const vm = rule.volumeMultiple ?? 3;
    for (let i = n + 3; i < bars.length - 1; i += 1) {
      if (bars[i].time - created > (rule.earlyHours ?? 24) * 3_600_000) break;
      const seq = bars.slice(i - n + 1, i + 1);
      const base = bars.slice(Math.max(0, i - n - 6), i - n + 1);
      const baseVol = base.reduce((s, b) => s + b.volume, 0) / base.length;
      let rising = true;
      for (let k = 1; k < seq.length; k += 1) if (!(seq[k].volume > seq[k - 1].volume && seq[k].close > seq[k - 1].close)) rising = false;
      const move = seq[seq.length - 1].close / seq[0].open - 1;
      if (rising && baseVol > 0 && seq[seq.length - 1].volume >= baseVol * vm && move >= (rule.accelMinMovePct ?? 0.1) && move < 1.5) push(i, null, null);
    }
  } else if (rule.family === "graduation") {
    const g = tape.graduatedMs;
    if (g == null || !Number.isFinite(g)) return out;
    // The tape must start at graduation, or the window is not observable.
    const first = 0;
    if (Math.abs(bars[0].time - g) > 10 * 60_000) return out;
    const b0 = bars[first];
    // First post-graduation 5-minute bar must close up on enough USD volume.
    if (!(b0.close > b0.open) || b0.volume < (rule.minGradVolUsd ?? 10_000)) return out;
    const lo = rule.gradMinMs ?? 5 * 60_000;
    const hi = rule.gradMaxMs ?? 30 * 60_000;
    // Bar 0 opens at the pool-initialization print, so its open/low are not tradable; its close is.
    let low = b0.close;
    for (let i = first; i < bars.length - 1; i += 1) {
      const b = bars[i];
      if (i > first) low = Math.min(low, b.low);
      const fillTime = bars[i + 1].time;
      if (fillTime - g > hi) break;
      if (fillTime - g < lo) continue;
      // Every qualifying bar in the window is offered; the caller takes the first one that fills.
      if (b.close > b.open) push(i, low * 0.995, null);
    }
  } else if (rule.family === "flush") {
    const fp = rule.flushPct ?? 0.3;
    const fb = rule.flushBars ?? 6;
    let cooldown = -1;
    for (let i = 12; i < bars.length - 1; i += 1) {
      if (i <= cooldown) continue;
      const win = bars.slice(i - fb, i);
      let hiIdx = i - fb;
      for (let j = i - fb; j < i; j += 1) if (bars[j].high > bars[hiIdx].high) hiIdx = j;
      const hi = bars[hiIdx].high;
      let low = Infinity;
      for (let j = hiIdx; j < i; j += 1) low = Math.min(low, bars[j].low);
      if (!(hi > 0) || !(low / hi - 1 <= -fp)) continue;
      const flushVol = win.reduce((s, b) => s + b.volume, 0);
      if (rule.minFlushVolUsd != null && flushVol < rule.minFlushVolUsd) continue;
      const b = bars[i];
      // First green bar that holds above the flush low: the bounce, not the knife.
      if (!(b.close > b.open && b.low >= low && b.volume > 0)) continue;
      const target = low + 0.5 * (hi - low);
      push(i, low * 0.98, target);
      cooldown = i + fb;
    }
  }
  return out;
}

/**
 * Participation cap: one sale cannot take out more than 25% of the trailing hour's USD
 * volume (12 bars including this one). Anything above that is treated as unsellable.
 * This stops a $60-a-bar staircase tape from paying out thousands.
 */
export function participationCap(tape: Tape, time: number): number {
  let index = timeIndex.get(tape.bars);
  if (!index) {
    index = new Map(tape.bars.map((b, i) => [b.time, i]));
    timeIndex.set(tape.bars, index);
  }
  const at = index.get(time);
  if (at == null) return Infinity;
  let vol = 0;
  for (let i = Math.max(1, at - 11); i <= at; i += 1) vol += tape.bars[i].volume;
  return 0.25 * vol;
}

function sellAt(tape: Tape, time: number, mid: number, qty: number): number {
  const r = reserveAt(tape, time);
  const exec = sellExecution(mid * (1 - thinSlip(r * 2)), qty, r, POOL_FEE);
  const proceeds = exec ? Math.min(exec.proceeds, participationCap(tape, time)) : 0;
  return Math.max(0, proceeds - PRIORITY_USD);
}

/** Walk one trade forward on its own tape. Stop is checked before any target in the same bar. */
export function simulate(tape: Tape, c: Candidate, exit: ExitRule, tradeUsd: number = TRADE_USD): SimTrade | null {
  const bars = tape.bars;
  const fillBar = bars[c.fillIdx];
  const r0 = reserveAt(tape, fillBar.time);
  if (!(r0 > 0)) return null;
  const exec = buyExecution(fillBar.open * (1 + thinSlip(r0 * 2)), tradeUsd - PRIORITY_USD, r0, POOL_FEE);
  if (!exec) return null;
  const ref = fillBar.open;
  let stop = exit.useStructureStop && c.stop != null ? c.stop : ref * (1 - (exit.stopPct ?? 0.09));
  if (exit.capStructureStop != null) stop = Math.max(stop, ref * (1 - exit.capStructureStop));
  if (!(stop < ref) || stop < ref * (1 - (exit.maxStructureStop ?? MAX_STRUCTURE_STOP))) return null;
  const target = exit.targetHalfRetrace && c.target != null && c.target > ref * 1.02 ? c.target : exit.takeProfit != null ? ref * (1 + exit.takeProfit) : null;
  let qty = exec.tokens;
  let proceeds = 0;
  let scaled = false;
  let scaledAt: number | null = null;
  let scaleProceedsUsd: number | null = null;
  let peak = ref;
  let reason = "end-of-tape";
  let exitTime = bars[bars.length - 1].time;
  const done = (time: number, mid: number, why: string) => {
    proceeds += sellAt(tape, time, mid, qty);
    qty = 0;
    reason = why;
    exitTime = time;
  };
  for (let i = c.fillIdx; i < bars.length && qty > 0; i += 1) {
    const b = bars[i];
    // A tape hole longer than 6 hours (stitched launch window): close at the last bar before it.
    if (i > c.fillIdx && b.time - bars[i - 1].time > 6 * 3_600_000) { done(bars[i - 1].time, bars[i - 1].close, "tape-gap"); break; }
    const trailing = exit.trailPct != null && (exit.trailActivate == null || peak >= ref * (1 + exit.trailActivate) || scaled);
    const trailStop = trailing ? peak * (1 - (exit.trailPct ?? 0)) : -Infinity;
    const eff = Math.max(stop, trailStop);
    if (b.low <= eff) { done(b.time, stopFill(b, eff), trailStop > stop ? "trail-stop" : "stop"); break; }
    if (target != null && b.high >= target) {
      if (exit.scaleFraction != null && !scaled) {
        const part = qty * exit.scaleFraction;
        const r = reserveAt(tape, b.time);
        const ex = sellExecution(target * (1 - thinSlip(r * 2)), part, r, POOL_FEE);
        const got = ex ? Math.max(0, Math.min(ex.proceeds, participationCap(tape, b.time)) - PRIORITY_USD) : 0;
        proceeds += got;
        qty -= part;
        scaled = true;
        scaledAt = b.time;
        scaleProceedsUsd = got;
        if (exit.breakevenAfterScale) stop = Math.max(stop, ref);
      } else if (exit.scaleFraction == null) {
        done(b.time, target, "take-profit");
        break;
      }
    }
    if (b.high > peak) peak = b.high;
    const nowTrailing = exit.trailPct != null && (exit.trailActivate == null || peak >= ref * (1 + exit.trailActivate) || scaled);
    if (nowTrailing && b.close <= peak * (1 - (exit.trailPct ?? 0)) && i > c.fillIdx) { done(b.time, b.close, "trail-stop"); break; }
    if (b.time - fillBar.time >= exit.maxHoldMs) { done(b.time, b.close, "max-hold"); break; }
  }
  if (qty > 0) done(exitTime, bars[bars.length - 1].close, "end-of-tape");
  const pnl = proceeds - tradeUsd;
  return { symbol: c.symbol, pool: c.pool, rugged: c.rugged, entryTime: fillBar.time, exitTime, pnlUsd: pnl, pnlPct: pnl / tradeUsd, reason, scaledAt, scaleProceedsUsd };
}

/** Shared sleeve: max 5 open, one per pool, $250 realized daily loss pause (UTC day). */
export function admit(trades: SimTrade[], from: number, until: number): SimTrade[] {
  const sorted = trades.filter((t) => t.entryTime >= from && t.entryTime < until).sort((a, b) => a.entryTime - b.entryTime || a.pool.localeCompare(b.pool));
  const open: SimTrade[] = [];
  const taken: SimTrade[] = [];
  for (const t of sorted) {
    for (let k = open.length - 1; k >= 0; k -= 1) if (open[k].exitTime <= t.entryTime) open.splice(k, 1);
    if (open.length >= 5 || open.some((o) => o.pool === t.pool)) continue;
    const day = new Date(t.entryTime).toISOString().slice(0, 10);
    const realized = taken.filter((x) => x.exitTime <= t.entryTime && new Date(x.exitTime).toISOString().slice(0, 10) === day).reduce((s, x) => s + x.pnlUsd, 0);
    if (realized <= -250) continue;
    open.push(t);
    taken.push(t);
  }
  return taken;
}

export interface Stats {
  trades: number;
  hitRate: number;
  avgWinPct: number | null;
  avgLossPct: number | null;
  totalPnlUsd: number;
  days: number;
  dailyPct: number;
  maxDrawdownPct: number;
  top3Share: number | null;
  ruggedTrades: number;
  net15dOn10k: number;
}

export function stats(trades: SimTrade[], days: number): Stats {
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const avg = (rows: SimTrade[]) => (rows.length ? rows.reduce((s, t) => s + t.pnlPct, 0) / rows.length : null);
  const total = trades.reduce((s, t) => s + t.pnlUsd, 0);
  let eq = SLEEVE_USD;
  let peakEq = SLEEVE_USD;
  let mdd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime - b.exitTime)) {
    eq += t.pnlUsd;
    peakEq = Math.max(peakEq, eq);
    mdd = Math.max(mdd, (peakEq - eq) / SLEEVE_USD);
  }
  const top3 = [...trades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(0, 3).reduce((s, t) => s + t.pnlUsd, 0);
  const dailyPct = days > 0 ? total / SLEEVE_USD / days : 0;
  return {
    trades: trades.length,
    hitRate: trades.length ? wins.length / trades.length : 0,
    avgWinPct: avg(wins),
    avgLossPct: avg(losses),
    totalPnlUsd: total,
    days,
    dailyPct,
    maxDrawdownPct: mdd,
    top3Share: total > 0 ? top3 / total : null,
    ruggedTrades: trades.filter((t) => t.rugged).length,
    net15dOn10k: 10_000 * ((1 + dailyPct) ** 15 - 1),
  };
}
