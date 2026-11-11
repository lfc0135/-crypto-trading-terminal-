/**
 * Live PAPER trading for the graduation-window strategy. Nothing is signed, no wallet is loaded,
 * and no order is ever sent. The GMGN key is used only for read-only market data.
 *
 * Rules are the backtest's train-selected config `g-grad-vol10k-half20-trail12` (STRATEGY_SEARCH.md):
 * - Watch every pump.fun graduate (Pump.fun and pump_mayhem platforms on pump_amm / Raydium) quoted in SOL/USDC/USDT.
 *   Rugged or risky coins are NOT filtered out.
 * - The first post-graduation 5-minute bar must close up on at least $10k USD volume.
 * - Enter at the open of the bar after the first up-closing bar whose fill is 5 to 30 minutes after graduation.
 * - Stop 0.5% under the post-graduation low (the migration bar contributes only its close), up to 99% wide.
 * - Sell half at +20%, then trail the rest 12% under the peak. Max hold 3 hours.
 * - Costs: constant-product impact, 0.25% pool fee, $0.02 priority fee per transaction, thin-pool slippage
 *   (1.5% / 0.8% / 0.4% / 0.2%), depth cap 20x trailing median 5m volume, 25% participation cap, stressed stops.
 * - Sizing scaled from the backtest's $150 on $2,500 (6%): $600 a trade on a $10,000 principal, max 5 open,
 *   one per pool, and a $1,000 realized daily loss pause (UTC day, 10% as in the backtest's $250 on $2,500).
 * The trade walk itself is `candidates()` + `simulate()` from strategy-search.ts, so live and backtest share one code path.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { candidates, simulate, type Bar, type EntryRule, type ExitRule, type Tape } from "./strategy-search";

export const PRINCIPAL_USD = 10_000;
export const TRADE_FRACTION = 150 / 2_500; // 6% per trade, as in the backtest sleeve
export const LIVE_TRADE_USD = PRINCIPAL_USD * TRADE_FRACTION; // $600
export const MAX_OPEN = 5;
export const DAILY_LOSS_PAUSE_USD = PRINCIPAL_USD * (250 / 2_500); // $1,000
export const RULE_ID = "g-grad-vol10k-half20-trail12";
export const ENTRY: EntryRule = { family: "graduation", minGradVolUsd: 10_000, gradMinMs: 5 * 60_000, gradMaxMs: 30 * 60_000 };
export const EXIT: ExitRule = { useStructureStop: true, stopPct: 0.09, takeProfit: 0.2, scaleFraction: 0.5, trailActivate: 0.2, trailPct: 0.12, maxHoldMs: 3 * 3_600_000, maxStructureStop: 0.99 };

const BAR_MS = 5 * 60_000;
const QUOTES = new Set([
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

export const DIR = path.join(process.cwd(), "data", "graduation");
export const JOURNAL = path.join(DIR, "journal.jsonl");
const STATE = path.join(DIR, "state.json");

export interface Watch {
  token: string;
  pool: string;
  symbol: string;
  platform: string;
  quote: string;
  gradMs: number;
  seenAt: number;
  status: "watching" | "entered" | "dropped";
  note?: string;
  nextFetchAt: number;
  fetches: number;
}

export interface LivePosition {
  pool: string;
  token: string;
  symbol: string;
  gradMs: number;
  signalTime: number;
  fillTime: number;
  fillPrice: number;
  stop: number;
  quoteReserveUsd: number;
  sizeUsd: number;
  scaledLogged: boolean;
  openedAt: number;
  lastMarkUsd: number | null;
  nextFetchAt: number;
}

export interface ClosedTrade {
  pool: string;
  token: string;
  symbol: string;
  fillTime: number;
  exitTime: number;
  sizeUsd: number;
  pnlUsd: number;
  pnlPct: number;
  reason: string;
  closedAt: number;
}

export interface LiveState {
  version: 1;
  rule: string;
  principal: number;
  startedAt: number;
  watches: Record<string, Watch>;
  positions: LivePosition[];
  closed: ClosedTrade[];
  stats: { cycles: number; gmgnOk: number; gmgn429: number; geckoOk: number; gecko429: number; graduationsSeen: number; lastCycleAt: number | null; lastError: string | null };
}

export function journal(event: string, data: Record<string, unknown>): void {
  fs.mkdirSync(DIR, { recursive: true });
  const now = Date.now();
  fs.appendFileSync(JOURNAL, `${JSON.stringify({ ts: new Date(now).toISOString(), event, ...data })}\n`);
}

export function loadState(): LiveState {
  if (fs.existsSync(STATE)) {
    try {
      const s = JSON.parse(fs.readFileSync(STATE, "utf8")) as LiveState;
      if (s.version === 1) return s;
    } catch { /* fall through */ }
  }
  return {
    version: 1,
    rule: RULE_ID,
    principal: PRINCIPAL_USD,
    startedAt: Date.now(),
    watches: {},
    positions: [],
    closed: [],
    stats: { cycles: 0, gmgnOk: 0, gmgn429: 0, geckoOk: 0, gecko429: 0, graduationsSeen: 0, lastCycleAt: null, lastError: null },
  };
}

export function saveState(s: LiveState): void {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${STATE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, STATE);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simple spacing limiter: at most one call per `gapMs`, plus a back-off window after a 429. */
class Spacer {
  private next = 0;
  constructor(private gapMs: number) {}
  blockedUntil = 0;
  async take(): Promise<void> {
    const now = Date.now();
    const at = Math.max(this.next, this.blockedUntil, now);
    this.next = at + this.gapMs;
    if (at > now) await sleep(at - now);
  }
}
// GMGN free tier ~5 weight / 5 s shared with the logger; trenches weighs 2. One call per 12 s keeps us well inside.
const gmgnSpacer = new Spacer(12_000);
// GeckoTerminal free tier ~30 calls/min shared with the logger. One call per 3 s = 20/min.
const geckoSpacer = new Spacer(3_000);

export interface Graduate { token: string; pool: string; symbol: string; platform: string; exchange: string; quote: string; gradMs: number; liquidity: number | null }

/** Read-only GMGN trenches "completed" list. The key is never logged. */
export async function fetchGraduates(state: LiveState): Promise<Graduate[] | null> {
  const key = process.env.GMGN_API_KEY;
  if (!key) throw new Error("GMGN_API_KEY is not set in the environment.");
  await gmgnSpacer.take();
  const params = new URLSearchParams({ chain: "sol", timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() });
  const res = await fetch(`https://openapi.gmgn.ai/v1/trenches?${params}`, {
    method: "POST",
    headers: { "X-APIKEY": key, "content-type": "application/json", "User-Agent": "graduation-paper/0.1" },
    body: JSON.stringify({ version: "v2", completed: { limit: 80 } }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e: unknown) => { throw new Error(`GMGN fetch failed: ${e instanceof Error ? e.message : "network"}`); });
  if (res.status === 429) {
    state.stats.gmgn429 += 1;
    const body = (await res.json().catch(() => ({}))) as { reset_at?: number };
    const reset = Number(body.reset_at ?? res.headers.get("x-ratelimit-reset"));
    gmgnSpacer.blockedUntil = Number.isFinite(reset) && reset > 1e9 ? Math.min(reset * 1000, Date.now() + 120_000) : Date.now() + 10_000;
    return null;
  }
  if (!res.ok) throw new Error(`GMGN HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { completed?: Record<string, unknown>[] } };
  state.stats.gmgnOk += 1;
  const rows = json.data?.completed ?? [];
  return rows.map((x) => ({
    token: String(x.address ?? ""),
    pool: String(x.pool_address ?? ""),
    symbol: String(x.symbol ?? "?"),
    platform: String(x.launchpad_platform ?? ""),
    exchange: String(x.exchange ?? ""),
    quote: String(x.quote_address ?? ""),
    gradMs: Number(x.complete_timestamp ?? x.open_timestamp ?? 0) * 1000,
    liquidity: x.liquidity != null ? Number(x.liquidity) : null,
  })).filter((g) => g.token && g.pool && g.gradMs > 0);
}

/** pump.fun graduates on the venues the backtest covered, quoted in SOL / USDC / USDT. No rug or safety filter. */
export function eligible(g: Graduate): { ok: boolean; why: string } {
  if (!/^(pump\.fun|pump_mayhem)$/i.test(g.platform) && !/pump$/.test(g.token)) return { ok: false, why: `launchpad ${g.platform || "unknown"} is not pump.fun` };
  if (!/pump_amm|pumpswap|raydium/i.test(g.exchange)) return { ok: false, why: `venue ${g.exchange || "unknown"} is not PumpSwap/Raydium` };
  if (!QUOTES.has(g.quote)) return { ok: false, why: "quote is not SOL/USDC/USDT" };
  return { ok: true, why: "" };
}

/** 5-minute USD bars from GeckoTerminal (same source as the backtest). Includes the in-progress bar last. */
export async function fetchBars(state: LiveState, pool: string): Promise<Bar[] | null> {
  await geckoSpacer.take();
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=100&currency=usd`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) return null;
  if (res.status === 429) { state.stats.gecko429 += 1; geckoSpacer.blockedUntil = Date.now() + 20_000; return null; }
  if (res.status === 404) return [];
  if (!res.ok) return null;
  state.stats.geckoOk += 1;
  const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (json.data?.attributes?.ohlcv_list ?? [])
    .filter((r) => r[4] > 0)
    .map((r) => ({ time: r[0] * 1000, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }))
    .sort((a, b) => a.time - b.time);
}

/** Current pool reserve (USD, both sides) from GeckoTerminal. */
export async function fetchReserveUsd(state: LiveState, pool: string): Promise<number | null> {
  await geckoSpacer.take();
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res) return null;
  if (res.status === 429) { state.stats.gecko429 += 1; geckoSpacer.blockedUntil = Date.now() + 20_000; return null; }
  if (!res.ok) return null;
  state.stats.geckoOk += 1;
  const json = (await res.json()) as { data?: { attributes?: { reserve_in_usd?: string } } };
  const v = Number(json.data?.attributes?.reserve_in_usd);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const nextBoundary = (now: number) => Math.floor(now / BAR_MS) * BAR_MS + BAR_MS + 25_000; // 25 s after the bar closes

function closedBars(bars: Bar[], now: number): Bar[] {
  return bars.filter((b) => b.time + BAR_MS <= now - 5_000);
}

export function utcDay(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

function realizedToday(state: LiveState, now: number): number {
  const day = utcDay(now);
  return state.closed.filter((t) => utcDay(t.exitTime) === day).reduce((s, t) => s + t.pnlUsd, 0);
}

/** One watch: decide drop / wait / enter on the bars seen so far. */
export async function evaluateWatch(state: LiveState, w: Watch, now: number): Promise<void> {
  const bars = await fetchBars(state, w.pool);
  w.fetches += 1;
  if (bars == null) { w.nextFetchAt = now + 30_000; return; }
  const closed = closedBars(bars, now);
  if (bars.length === 0 || closed.length === 0) {
    if (now - w.gradMs > 40 * 60_000) { w.status = "dropped"; w.note = "no candles from GeckoTerminal within 40 minutes"; journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note }); }
    else w.nextFetchAt = Math.min(now + 60_000, nextBoundary(now));
    return;
  }
  if (Math.abs(bars[0].time - w.gradMs) > 10 * 60_000) {
    w.status = "dropped";
    w.note = `first candle is ${Math.round((bars[0].time - w.gradMs) / 60_000)} min from graduation (the backtest needs the tape to start within 10 min)`;
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note });
    return;
  }
  const b0 = bars[0];
  const b0Closed = closed.length >= 1;
  if (b0Closed && !(b0.close > b0.open && b0.volume >= (ENTRY.minGradVolUsd ?? 10_000))) {
    w.status = "dropped";
    w.note = `first 5-min bar ${b0.close > b0.open ? "closed up" : "closed down"} on $${Math.round(b0.volume).toLocaleString()} volume (needs up and $10k+)`;
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note, bar0: b0 });
    return;
  }
  // Signal bars must be closed; the fill bar may be in progress (its open is final).
  const tapeForEntry: Bar[] = [...closed];
  const inProgress = bars.find((b) => b.time === closed[closed.length - 1].time + BAR_MS);
  if (inProgress) tapeForEntry.push(inProgress);
  const tape: Tape = { symbol: w.symbol, pool: w.pool, bars: tapeForEntry, quoteReserveUsd: 0, createdMs: w.gradMs, rugged: false, graduatedMs: w.gradMs };
  // Live honesty: only a fill on the bar that is open right now (or opened within the last 5.5 minutes) counts.
  // A signal that already happened before we looked is not tradable at its old price.
  const all = candidates(tape, ENTRY);
  const cands = all.filter((c) => now - tapeForEntry[c.fillIdx].time <= 5.5 * 60_000);
  if (all.length > cands.length && !w.note?.startsWith("stale")) {
    w.note = "stale signal ignored";
    journal("skip", { symbol: w.symbol, pool: w.pool, reason: "an earlier signal bar was missed (it closed before we were watching); waiting for a fresh one inside the window" });
  }
  if (cands.length > 0) {
    if (state.positions.length >= MAX_OPEN) { w.status = "dropped"; w.note = "signal, but 5 positions already open"; journal("skip", { symbol: w.symbol, pool: w.pool, reason: w.note }); return; }
    const realized = realizedToday(state, now);
    if (realized <= -DAILY_LOSS_PAUSE_USD) { w.status = "dropped"; w.note = `signal, but daily loss pause is on (realized ${realized.toFixed(2)})`; journal("skip", { symbol: w.symbol, pool: w.pool, reason: w.note }); return; }
    const reserve = await fetchReserveUsd(state, w.pool);
    const quoteReserveUsd = reserve != null ? reserve / 2 : 0;
    tape.quoteReserveUsd = quoteReserveUsd;
    // Take the first candidate that fills, as the backtest does.
    for (const c of cands) {
      const sim = simulate({ ...tape, bars: tapeForEntry.slice(0, c.fillIdx + 1) }, c, EXIT, LIVE_TRADE_USD);
      if (!sim || c.stop == null) continue;
      const fill = tapeForEntry[c.fillIdx];
      const pos: LivePosition = {
        pool: w.pool, token: w.token, symbol: w.symbol, gradMs: w.gradMs, signalTime: c.signalTime, fillTime: fill.time, fillPrice: fill.open,
        stop: c.stop, quoteReserveUsd, sizeUsd: LIVE_TRADE_USD, scaledLogged: false, openedAt: now, lastMarkUsd: null, nextFetchAt: nextBoundary(now),
      };
      state.positions.push(pos);
      w.status = "entered";
      journal("signal", { symbol: w.symbol, pool: w.pool, token: w.token, signalBar: tapeForEntry[c.fillIdx - 1], minutesAfterGraduation: Math.round((fill.time - w.gradMs) / 60_000) });
      journal("entry", {
        symbol: w.symbol, pool: w.pool, token: w.token, sizeUsd: LIVE_TRADE_USD, fillBarOpen: fill.open, fillTime: new Date(fill.time).toISOString(),
        stop: c.stop, stopPctBelow: +(1 - c.stop / fill.open).toFixed(4), target20: fill.open * 1.2, poolReserveUsd: reserve, quoteDepthUsd: quoteReserveUsd,
        note: "paper only, nothing signed",
      });
      return;
    }
    // Candidates existed but none could fill under the cost model (too thin / stop out of range). Keep watching in the window.
    const lastFill = cands[cands.length - 1];
    journal("skip", { symbol: w.symbol, pool: w.pool, reason: "signal bar seen but the fill is rejected by the cost model (pool too thin for a $600 clip, or no depth yet)", fillTime: new Date(tapeForEntry[lastFill.fillIdx].time).toISOString(), poolReserveUsd: reserve });
  }
  const lastPossibleFill = w.gradMs + (ENTRY.gradMaxMs ?? 30 * 60_000);
  if (closed[closed.length - 1].time + BAR_MS > lastPossibleFill + BAR_MS) {
    w.status = "dropped";
    w.note = "no fillable up-closing bar 5-30 minutes after graduation";
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note });
    return;
  }
  w.nextFetchAt = nextBoundary(now);
}

/** Walk an open position on closed 5-minute bars with the shared simulator. */
export async function evaluatePosition(state: LiveState, p: LivePosition, now: number): Promise<void> {
  const bars = await fetchBars(state, p.pool);
  if (bars == null) { p.nextFetchAt = now + 30_000; return; }
  const closed = closedBars(bars, now);
  const fillIdx = closed.findIndex((b) => b.time === p.fillTime);
  p.nextFetchAt = nextBoundary(now);
  if (fillIdx < 0) {
    // Fill bar not closed yet, or the tape lost it. If it has been too long, close at last seen price.
    if (now - p.fillTime > 4 * 3_600_000) {
      const last = bars[bars.length - 1];
      const pnl = last ? p.sizeUsd * (last.close / p.fillPrice - 1) : -p.sizeUsd;
      closeTrade(state, p, { pnlUsd: pnl, exitTime: last?.time ?? now, reason: "tape-lost" });
    }
    return;
  }
  // Bar 0 must start at graduation for the stop structure; reuse the candidate's frozen stop.
  const tape: Tape = { symbol: p.symbol, pool: p.pool, bars: closed, quoteReserveUsd: p.quoteReserveUsd, createdMs: p.gradMs, rugged: false, graduatedMs: p.gradMs };
  const sim = simulate(tape, { pool: p.pool, symbol: p.symbol, signalTime: p.signalTime, fillIdx, stop: p.stop, target: null, rugged: false }, EXIT, p.sizeUsd);
  if (!sim) {
    closeTrade(state, p, { pnlUsd: 0, exitTime: p.fillTime, reason: "fill-rejected-on-recheck" });
    return;
  }
  if (sim.scaledAt != null && !p.scaledLogged) {
    p.scaledLogged = true;
    journal("scale-out", { symbol: p.symbol, pool: p.pool, at: new Date(sim.scaledAt).toISOString(), soldHalfAt: p.fillPrice * 1.2, proceedsUsd: sim.scaleProceedsUsd, note: "half sold at +20%, rest trails 12% under the peak" });
  }
  if (sim.reason === "end-of-tape") {
    p.lastMarkUsd = sim.pnlUsd;
    return;
  }
  closeTrade(state, p, { pnlUsd: sim.pnlUsd, exitTime: sim.exitTime, reason: sim.reason });
}

function closeTrade(state: LiveState, p: LivePosition, r: { pnlUsd: number; exitTime: number; reason: string }): void {
  state.positions = state.positions.filter((x) => x.pool !== p.pool);
  const t: ClosedTrade = { pool: p.pool, token: p.token, symbol: p.symbol, fillTime: p.fillTime, exitTime: r.exitTime, sizeUsd: p.sizeUsd, pnlUsd: r.pnlUsd, pnlPct: r.pnlUsd / p.sizeUsd, reason: r.reason, closedAt: Date.now() };
  state.closed.push(t);
  const total = state.closed.reduce((s, x) => s + x.pnlUsd, 0);
  journal("exit", { symbol: p.symbol, pool: p.pool, token: p.token, reason: r.reason, exitTime: new Date(r.exitTime).toISOString(), pnlUsdAfterCosts: +r.pnlUsd.toFixed(2), pnlPct: +(t.pnlPct * 100).toFixed(2), accountRealizedUsd: +total.toFixed(2), accountEquityUsd: +(PRINCIPAL_USD + total).toFixed(2) });
}

/** One detection + evaluation cycle. Returns a short status line. */
export async function cycle(state: LiveState): Promise<string> {
  const now = Date.now();
  let newCount = 0;
  let gmgnStatus = "ok";
  try {
    const grads = await fetchGraduates(state);
    if (grads == null) gmgnStatus = "429";
    else {
      for (const g of grads) {
        if (state.watches[g.pool]) continue;
        if (now - g.gradMs > 35 * 60_000) continue; // too late to see the 5-30 min window honestly
        const e = eligible(g);
        state.stats.graduationsSeen += 1;
        newCount += 1;
        const w: Watch = { token: g.token, pool: g.pool, symbol: g.symbol, platform: g.platform, quote: g.quote, gradMs: g.gradMs, seenAt: now, status: e.ok ? "watching" : "dropped", note: e.ok ? undefined : e.why, nextFetchAt: now, fetches: 0 };
        state.watches[g.pool] = w;
        journal("graduation", { symbol: g.symbol, token: g.token, pool: g.pool, platform: g.platform, venue: g.exchange, graduatedAt: new Date(g.gradMs).toISOString(), detectedAfterSec: Math.round((now - g.gradMs) / 1000), liquidityUsd: g.liquidity, watching: e.ok, reason: e.ok ? undefined : e.why });
      }
    }
  } catch (error) {
    gmgnStatus = error instanceof Error ? error.message : "error";
    state.stats.lastError = gmgnStatus;
  }
  // Open positions first, then watches in the order their bars close.
  for (const p of [...state.positions]) if (Date.now() >= p.nextFetchAt) await evaluatePosition(state, p, Date.now());
  const due = Object.values(state.watches).filter((w) => w.status === "watching" && Date.now() >= w.nextFetchAt).sort((a, b) => a.gradMs - b.gradMs);
  for (const w of due) await evaluateWatch(state, w, Date.now());
  // Forget old watches (keep 6 hours for the record).
  for (const [k, w] of Object.entries(state.watches)) if (w.status !== "watching" && now - w.gradMs > 6 * 3_600_000) delete state.watches[k];
  state.stats.cycles += 1;
  state.stats.lastCycleAt = now;
  const watching = Object.values(state.watches).filter((w) => w.status === "watching").length;
  return `gmgn=${gmgnStatus} new_graduations=${newCount} watching=${watching} open=${state.positions.length} closed=${state.closed.length}`;
}
