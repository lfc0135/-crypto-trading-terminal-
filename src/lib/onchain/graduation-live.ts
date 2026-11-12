/**
 * Live PAPER trading for the graduation-window strategy. Nothing is signed, no wallet is loaded,
 * and no order is ever sent. The GMGN key is used only for read-only market data.
 *
 * Rules started from the backtest's train-selected config `g-grad-vol10k-half20-trail12` (STRATEGY_SEARCH.md),
 * with the first-bar volume floor lowered to $5k on 11 Nov 2026:
 * - Watch every pump.fun graduate (Pump.fun and pump_mayhem platforms on pump_amm / Raydium) quoted in SOL/USDC/USDT.
 *   Rugged or risky coins are NOT filtered out.
 * - The first post-graduation 5-minute bar must close up on at least $5k USD volume.
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
import { mentionClient, mentionJournalFields, type MentionAround } from "./x-mentions";

/** Logging-only X mention reading. Never used to filter or delay a trade decision past a short timeout. */
async function xMentions(symbol: string, token: string, aroundMs: number, around: MentionAround) {
  return mentionJournalFields(await mentionClient().countAround(symbol, token, aroundMs, around), around);
}

export const PRINCIPAL_USD = 10_000;
export const TRADE_FRACTION = 150 / 2_500; // 6% per trade, as in the backtest sleeve
export const LIVE_TRADE_USD = PRINCIPAL_USD * TRADE_FRACTION; // $600
export const MAX_OPEN = 5;
export const DAILY_LOSS_PAUSE_USD = PRINCIPAL_USD * (250 / 2_500); // $1,000
export const RULE_ID = "g-grad-vol5k-half20-trail12-cap25-theme";
export const PREV_RULE_ID = "g-grad-vol5k-half20-trail12";
/** Per-trade loss cap (approved 12 Nov 2026): the stop is never wider than 25% under the fill, for the whole position. */
export const LOSS_CAP_PCT = 0.25;

/**
 * Theme priority (approved 12 Nov 2026). Tagged graduations are processed first, size $900, and need only $3k on the
 * first bar. At most 2 tagged entries per theme in any rolling 30 minutes.
 */
export const THEME_TRADE_USD = 900;
export const THEME_MIN_GRAD_VOL_USD = 3_000;
export const THEME_MAX_ENTRIES = 2;
export const THEME_WINDOW_MS = 30 * 60_000;
export const THEMES: { id: string; pattern: RegExp }[] = [
  { id: "gta", pattern: /\bgta\s*6|\bgta|rockstar|vice\s*city/i },
  { id: "jensen-nvidia", pattern: /jensen|huang|nvidia|nvda/i },
];
export function themeOf(...texts: (string | undefined | null)[]): string | null {
  const hay = texts.filter(Boolean).join(" \n ");
  for (const t of THEMES) if (t.pattern.test(hay)) return t.id;
  return null;
}

/** Dubai calendar day (UTC+4, no DST) for the no-re-entry rule. */
export function dubaiDay(ms: number): string { return new Date(ms + 4 * 3_600_000).toISOString().slice(0, 10); }
/** Normalized full name and leading word, e.g. "Rockstar G" -> ["rockstarg", "rockstar"]. */
export function nameKeys(...texts: (string | undefined | null)[]): string[] {
  const keys = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    const full = t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const lead = (t.toLowerCase().match(/[\p{L}\p{N}]+/u) ?? [""])[0];
    if (full) keys.add(full);
    if (lead) keys.add(lead);
  }
  return [...keys];
}
const STOP_REASONS = /^(stop|loss-cap)$/;
/** After a stop-out or loss-cap exit, the same normalized name/symbol (or leading word) is blocked for that Dubai day. */
export function reentryBlock(state: LiveState, symbol: string, name: string | undefined, now: number): string | null {
  const mine = new Set(nameKeys(symbol, name));
  const today = dubaiDay(now);
  for (const t of state.closed) {
    if (!STOP_REASONS.test(t.reason) || dubaiDay(t.exitTime) !== today) continue;
    if (nameKeys(t.symbol, t.name).some((k) => mine.has(k))) return t.symbol;
  }
  return null;
}
export function themeEntriesInWindow(state: LiveState, theme: string, now: number): number {
  const recent = (x: { theme?: string | null; openedAt?: number; fillTime: number }) => x.theme === theme && now - (x.openedAt ?? x.fillTime) < THEME_WINDOW_MS;
  return state.positions.filter(recent).length + state.closed.filter((t) => recent({ theme: t.theme, openedAt: t.openedAt, fillTime: t.fillTime })).length;
}

export const ENTRY: EntryRule = { family: "graduation", minGradVolUsd: 5_000, gradMinMs: 5 * 60_000, gradMaxMs: 30 * 60_000 };
export const EXIT: ExitRule = { useStructureStop: true, stopPct: 0.09, takeProfit: 0.2, scaleFraction: 0.5, trailActivate: 0.2, trailPct: 0.12, maxHoldMs: 3 * 3_600_000, maxStructureStop: 0.99, capStructureStop: LOSS_CAP_PCT };

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
  name?: string;
  theme?: string | null;
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
  name?: string;
  theme?: string | null;
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
  name?: string;
  theme?: string | null;
  openedAt?: number;
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

/** Hard ceiling on every network call in the trader path, including reading the body. */
export const NET_TIMEOUT_MS = 12_000;

export interface NetResult { status: number; ok: boolean; headers: Headers; json: unknown }

/**
 * fetch with a hard deadline: an AbortController aborts the request and a racing timer rejects even if the
 * runtime ignores the abort (a stuck socket or body read). The body is read inside the same deadline.
 */
export async function fetchWithDeadline(url: string, init: RequestInit = {}, ms = NET_TIMEOUT_MS, fetchImpl: typeof fetch = fetch): Promise<NetResult> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ac.abort(); reject(new Error(`timeout after ${ms}ms`)); }, ms);
  });
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(url, { ...init, signal: ac.signal });
        const text = await res.text();
        let json: unknown = {};
        try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
        return { status: res.status, ok: res.ok, headers: res.headers, json };
      })(),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

/**
 * GMGN pacing. Free tier is ~5 weight / 5 s shared with gmgn-logger; trenches weighs ~2-3. The trader polls at most
 * once per 30 s and never sleeps waiting for GMGN: if a poll is not due, or we are backing off, the cycle skips
 * detection and still manages open positions on GeckoTerminal bars.
 */
export const GMGN_POLL_MS = 30_000;
export const GMGN_BACKOFF_BASE_MS = 30_000;
export const GMGN_BACKOFF_CAP_MS = 5 * 60_000;
export const gmgnGate = { nextAt: 0, strikes: 0, lastReason: "" };

/** Exponential back-off with jitter: base * 2^(strikes-1), capped, then +/-20% jitter. Honours a later reset_at up to the cap. */
export function gmgnBackoffMs(strikes: number, resetInMs: number | null, rand: () => number = Math.random): number {
  const exp = Math.min(GMGN_BACKOFF_CAP_MS, GMGN_BACKOFF_BASE_MS * 2 ** Math.max(0, strikes - 1));
  const jittered = exp * (0.8 + 0.4 * rand());
  const withReset = resetInMs != null && resetInMs > jittered ? resetInMs : jittered;
  return Math.round(Math.min(GMGN_BACKOFF_CAP_MS, withReset));
}

// GeckoTerminal free tier ~30 calls/min shared with the logger. One call per 3 s = 20/min.
const geckoSpacer = new Spacer(3_000);

export interface Graduate { token: string; pool: string; symbol: string; name?: string; description?: string; platform: string; exchange: string; quote: string; gradMs: number; liquidity: number | null }

/** Read-only GMGN trenches "completed" list. The key is never logged. Returns "skip" when a poll is not due. */
export async function fetchGraduates(state: LiveState): Promise<Graduate[] | "skip" | "backoff" | null> {
  const key = process.env.GMGN_API_KEY;
  if (!key) throw new Error("GMGN_API_KEY is not set in the environment.");
  const now = Date.now();
  if (now < gmgnGate.nextAt) return gmgnGate.strikes > 0 ? "backoff" : "skip";
  gmgnGate.nextAt = now + GMGN_POLL_MS;
  const params = new URLSearchParams({ chain: "sol", timestamp: String(Math.floor(now / 1000)), client_id: crypto.randomUUID() });
  let res: NetResult;
  try {
    res = await fetchWithDeadline(`https://openapi.gmgn.ai/v1/trenches?${params}`, {
      method: "POST",
      headers: { "X-APIKEY": key, "content-type": "application/json", "User-Agent": "graduation-paper/0.2" },
      body: JSON.stringify({ version: "v2", completed: { limit: 80 } }),
    });
  } catch (e: unknown) {
    throw new Error(`GMGN fetch failed: ${e instanceof Error ? e.message : "network"}`);
  }
  if (res.status === 429 || res.status === 403) {
    state.stats.gmgn429 += 1;
    const body = (res.json ?? {}) as { reset_at?: number; error?: string; message?: string; code?: string };
    const reason = String(body.error ?? body.code ?? body.message ?? `HTTP ${res.status}`);
    const reset = Number(body.reset_at ?? res.headers.get("x-ratelimit-reset"));
    const resetInMs = Number.isFinite(reset) && reset > 1e9 ? reset * 1000 - now : null;
    gmgnGate.strikes += 1;
    const wait = gmgnBackoffMs(gmgnGate.strikes, resetInMs);
    gmgnGate.nextAt = now + wait;
    gmgnGate.lastReason = reason;
    state.stats.lastError = `GMGN ${res.status} ${reason} backoff=${Math.round(wait / 1000)}s`;
    journal("ops", { kind: "gmgn-backoff", status: res.status, reason, strikes: gmgnGate.strikes, backoffSec: Math.round(wait / 1000), retryAt: new Date(now + wait).toISOString(), resetAt: resetInMs != null ? new Date(now + resetInMs).toISOString() : null, note: "detection paused; open positions still managed on GeckoTerminal bars" });
    console.log(`${new Date().toISOString()} gmgn backoff ${res.status} ${reason} strikes=${gmgnGate.strikes} retry_in=${Math.round(wait / 1000)}s`);
    return null;
  }
  if (!res.ok) throw new Error(`GMGN HTTP ${res.status}`);
  if (gmgnGate.strikes > 0) {
    journal("ops", { kind: "gmgn-recovered", afterStrikes: gmgnGate.strikes, lastReason: gmgnGate.lastReason });
    console.log(`${new Date().toISOString()} gmgn recovered after ${gmgnGate.strikes} back-off(s)`);
  }
  gmgnGate.strikes = 0;
  const json = res.json as { data?: { completed?: Record<string, unknown>[] } };
  state.stats.gmgnOk += 1;
  const rows = json.data?.completed ?? [];
  return rows.map((x) => ({
    token: String(x.address ?? ""),
    pool: String(x.pool_address ?? ""),
    symbol: String(x.symbol ?? "?"),
    name: x.name != null ? String(x.name) : undefined,
    description: x.description != null ? String(x.description) : undefined,
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
  const res = await fetchWithDeadline(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=100&currency=usd`, {
    headers: { accept: "application/json" },
  }).catch(() => null);
  if (!res) return null;
  if (res.status === 429) { state.stats.gecko429 += 1; geckoSpacer.blockedUntil = Date.now() + 20_000; return null; }
  if (res.status === 404) return [];
  if (!res.ok) return null;
  state.stats.geckoOk += 1;
  const json = res.json as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (json.data?.attributes?.ohlcv_list ?? [])
    .filter((r) => r[4] > 0)
    .map((r) => ({ time: r[0] * 1000, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }))
    .sort((a, b) => a.time - b.time);
}

/** Current pool reserve (USD, both sides) from GeckoTerminal. */
export async function fetchReserveUsd(state: LiveState, pool: string): Promise<number | null> {
  await geckoSpacer.take();
  const res = await fetchWithDeadline(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}`, { headers: { accept: "application/json" } }).catch(() => null);
  if (!res) return null;
  if (res.status === 429) { state.stats.gecko429 += 1; geckoSpacer.blockedUntil = Date.now() + 20_000; return null; }
  if (!res.ok) return null;
  state.stats.geckoOk += 1;
  const json = res.json as { data?: { attributes?: { reserve_in_usd?: string } } };
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
    if (now - w.gradMs > 40 * 60_000) { w.status = "dropped"; w.note = "no candles from GeckoTerminal within 40 minutes"; journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) }); }
    else w.nextFetchAt = Math.min(now + 60_000, nextBoundary(now));
    return;
  }
  if (Math.abs(bars[0].time - w.gradMs) > 10 * 60_000) {
    w.status = "dropped";
    w.note = `first candle is ${Math.round((bars[0].time - w.gradMs) / 60_000)} min from graduation (the backtest needs the tape to start within 10 min)`;
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) });
    return;
  }
  const b0 = bars[0];
  const b0Closed = closed.length >= 1;
  const entryRule: EntryRule = w.theme ? { ...ENTRY, minGradVolUsd: THEME_MIN_GRAD_VOL_USD } : ENTRY;
  const tradeUsd = w.theme ? THEME_TRADE_USD : LIVE_TRADE_USD;
  const minVol = entryRule.minGradVolUsd ?? 5_000;
  if (b0Closed && !(b0.close > b0.open && b0.volume >= minVol)) {
    w.status = "dropped";
    const floorLabel = minVol >= 1000 ? `$${Math.round(minVol / 1000)}k+` : `$${minVol}+`;
    w.note = `first 5-min bar ${b0.close > b0.open ? "closed up" : "closed down"} on $${Math.round(b0.volume).toLocaleString()} volume (needs up and ${floorLabel})`;
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note, bar0: b0, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) });
    return;
  }
  // Signal bars must be closed; the fill bar may be in progress (its open is final).
  const tapeForEntry: Bar[] = [...closed];
  const inProgress = bars.find((b) => b.time === closed[closed.length - 1].time + BAR_MS);
  if (inProgress) tapeForEntry.push(inProgress);
  const tape: Tape = { symbol: w.symbol, pool: w.pool, bars: tapeForEntry, quoteReserveUsd: 0, createdMs: w.gradMs, rugged: false, graduatedMs: w.gradMs };
  // Live honesty: only a fill on a bar that opened within the last 2 minutes counts (we check ~25 s after each close).
  // A signal that already happened before we looked is not tradable at its old price.
  const all = candidates(tape, entryRule);
  const cands = all.filter((c) => now - tapeForEntry[c.fillIdx].time <= 2 * 60_000);
  if (all.length > cands.length && !w.note?.startsWith("stale")) {
    w.note = "stale signal ignored";
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: "an earlier signal bar was missed (it closed before we were watching); waiting for a fresh one inside the window", ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) });
  }
  if (cands.length > 0) {
    if (state.positions.length >= MAX_OPEN) { w.status = "dropped"; w.note = "signal, but 5 positions already open"; journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) }); return; }
    const realized = realizedToday(state, now);
    if (realized <= -DAILY_LOSS_PAUSE_USD) { w.status = "dropped"; w.note = `signal, but daily loss pause is on (realized ${realized.toFixed(2)})`; journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) }); return; }
    const blockedBy = reentryBlock(state, w.symbol, w.name, now);
    if (blockedBy) { w.status = "dropped"; w.note = `signal, but no re-entry today: ${blockedBy} was stopped out earlier this Dubai day`; journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, theme: w.theme ?? null, reason: w.note, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) }); return; }
    if (w.theme && themeEntriesInWindow(state, w.theme, now) >= THEME_MAX_ENTRIES) { w.status = "dropped"; w.note = `signal, but copycat limit: ${THEME_MAX_ENTRIES} ${w.theme} entries already in the last 30 minutes`; journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, theme: w.theme, reason: w.note, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) }); return; }
    const reserve = await fetchReserveUsd(state, w.pool);
    const quoteReserveUsd = reserve != null ? reserve / 2 : 0;
    tape.quoteReserveUsd = quoteReserveUsd;
    // Take the first candidate that fills, as the backtest does.
    for (const c of cands) {
      const sim = simulate({ ...tape, bars: tapeForEntry.slice(0, c.fillIdx + 1) }, c, EXIT, tradeUsd);
      if (!sim || c.stop == null) continue;
      const fill = tapeForEntry[c.fillIdx];
      const pos: LivePosition = {
        pool: w.pool, token: w.token, symbol: w.symbol, gradMs: w.gradMs, signalTime: c.signalTime, fillTime: fill.time, fillPrice: fill.open,
        stop: c.stop, quoteReserveUsd, sizeUsd: tradeUsd, scaledLogged: false, openedAt: now, lastMarkUsd: null, nextFetchAt: nextBoundary(now),
        name: w.name, theme: w.theme ?? null,
      };
      state.positions.push(pos);
      w.status = "entered";
      const entryMentions = await xMentions(w.symbol, w.token, fill.time, "entry");
      journal("signal", { symbol: w.symbol, pool: w.pool, token: w.token, signalBar: tapeForEntry[c.fillIdx - 1], minutesAfterGraduation: Math.round((fill.time - w.gradMs) / 60_000), ...entryMentions });
      journal("entry", {
        symbol: w.symbol, pool: w.pool, token: w.token, theme: w.theme ?? null, sizeUsd: tradeUsd, fillBarOpen: fill.open, fillTime: new Date(fill.time).toISOString(),
        stop: Math.max(c.stop, fill.open * (1 - LOSS_CAP_PCT)), structureStop: c.stop, stopPctBelow: +(1 - Math.max(c.stop, fill.open * (1 - LOSS_CAP_PCT)) / fill.open).toFixed(4), target20: fill.open * 1.2, poolReserveUsd: reserve, quoteDepthUsd: quoteReserveUsd,
        note: "paper only, nothing signed",
        ...entryMentions,
      });
      return;
    }
    // Candidates existed but none could fill under the cost model (too thin / stop out of range). Keep watching in the window.
    const lastFill = cands[cands.length - 1];
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: "signal bar seen but the fill is rejected by the cost model (pool too thin for the clip, or no depth yet)", fillTime: new Date(tapeForEntry[lastFill.fillIdx].time).toISOString(), poolReserveUsd: reserve, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) });
  }
  const lastPossibleFill = w.gradMs + (ENTRY.gradMaxMs ?? 30 * 60_000);
  if (closed[closed.length - 1].time + BAR_MS > lastPossibleFill + BAR_MS) {
    w.status = "dropped";
    w.note = "no fillable up-closing bar 5-30 minutes after graduation";
    journal("skip", { symbol: w.symbol, pool: w.pool, token: w.token, reason: w.note, ...(await xMentions(w.symbol, w.token, w.gradMs, "graduation")) });
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
      await closeTrade(state, p, { pnlUsd: pnl, exitTime: last?.time ?? now, reason: "tape-lost" });
    }
    return;
  }
  // Bar 0 must start at graduation for the stop structure; reuse the candidate's frozen stop.
  const tape: Tape = { symbol: p.symbol, pool: p.pool, bars: closed, quoteReserveUsd: p.quoteReserveUsd, createdMs: p.gradMs, rugged: false, graduatedMs: p.gradMs };
  const sim = simulate(tape, { pool: p.pool, symbol: p.symbol, signalTime: p.signalTime, fillIdx, stop: p.stop, target: null, rugged: false }, EXIT, p.sizeUsd);
  if (!sim) {
    await closeTrade(state, p, { pnlUsd: 0, exitTime: p.fillTime, reason: "fill-rejected-on-recheck" });
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
  // A stop at the 25% cap (tighter than the structure stop) is reported as a loss-cap exit.
  const capLevel = p.fillPrice * (1 - LOSS_CAP_PCT);
  const reason = sim.reason === "stop" && capLevel > p.stop ? "loss-cap" : sim.reason;
  await closeTrade(state, p, { pnlUsd: sim.pnlUsd, exitTime: sim.exitTime, reason });
}

async function closeTrade(state: LiveState, p: LivePosition, r: { pnlUsd: number; exitTime: number; reason: string }): Promise<void> {
  state.positions = state.positions.filter((x) => x.pool !== p.pool);
  const t: ClosedTrade = { pool: p.pool, token: p.token, symbol: p.symbol, fillTime: p.fillTime, exitTime: r.exitTime, sizeUsd: p.sizeUsd, pnlUsd: r.pnlUsd, pnlPct: r.pnlUsd / p.sizeUsd, reason: r.reason, closedAt: Date.now(), name: p.name, theme: p.theme ?? null, openedAt: p.openedAt };
  state.closed.push(t);
  const total = state.closed.reduce((s, x) => s + x.pnlUsd, 0);
  journal("exit", { symbol: p.symbol, pool: p.pool, token: p.token, reason: r.reason, exitTime: new Date(r.exitTime).toISOString(), pnlUsdAfterCosts: +r.pnlUsd.toFixed(2), pnlPct: +(t.pnlPct * 100).toFixed(2), accountRealizedUsd: +total.toFixed(2), accountEquityUsd: +(PRINCIPAL_USD + total).toFixed(2), ...(await xMentions(p.symbol, p.token, r.exitTime, "exit")) });
}

/** Called after each unit of work so the supervisor watchdog can tell a slow cycle from a stuck one. */
export let onProgress: () => void = () => {};
export function setProgressHook(fn: () => void): void { onProgress = fn; }

/** One cycle: manage open positions first, then GMGN detection (never blocking), then due watches. */
export async function cycle(state: LiveState): Promise<string> {
  // 1. Exits first, on GeckoTerminal bars, whatever GMGN is doing.
  for (const p of [...state.positions]) {
    if (Date.now() >= p.nextFetchAt) {
      try { await evaluatePosition(state, p, Date.now()); } catch (error) { p.nextFetchAt = Date.now() + 30_000; state.stats.lastError = `position ${p.symbol}: ${error instanceof Error ? error.message : String(error)}`; }
    }
    onProgress();
  }
  // 2. Detection.
  const now = Date.now();
  let newCount = 0;
  let gmgnStatus = "ok";
  try {
    const grads = await fetchGraduates(state);
    if (grads === "skip") gmgnStatus = "not-due";
    else if (grads === "backoff") gmgnStatus = `backoff(${gmgnGate.lastReason},retry_in=${Math.max(0, Math.round((gmgnGate.nextAt - Date.now()) / 1000))}s)`;
    else if (grads == null) gmgnStatus = `429(${gmgnGate.lastReason})`;
    else {
      const tagged = grads.map((g) => ({ g, theme: themeOf(g.name, g.symbol, g.description) }));
      tagged.sort((a, b) => Number(b.theme != null) - Number(a.theme != null));
      for (const { g, theme } of tagged) {
        if (state.watches[g.pool]) continue;
        if (now - g.gradMs > 35 * 60_000) continue; // too late to see the 5-30 min window honestly
        const e = eligible(g);
        state.stats.graduationsSeen += 1;
        newCount += 1;
        const w: Watch = { token: g.token, pool: g.pool, symbol: g.symbol, platform: g.platform, quote: g.quote, gradMs: g.gradMs, seenAt: now, status: e.ok ? "watching" : "dropped", note: e.ok ? undefined : e.why, nextFetchAt: now, fetches: 0, name: g.name, theme };
        state.watches[g.pool] = w;
        journal("graduation", { symbol: g.symbol, token: g.token, pool: g.pool, platform: g.platform, venue: g.exchange, name: g.name, theme, graduatedAt: new Date(g.gradMs).toISOString(), detectedAfterSec: Math.round((now - g.gradMs) / 1000), liquidityUsd: g.liquidity, watching: e.ok, reason: e.ok ? undefined : e.why, ...(e.ok ? await xMentions(g.symbol, g.token, g.gradMs, "graduation") : {}) });
      }
    }
  } catch (error) {
    gmgnStatus = error instanceof Error ? error.message : "error";
    state.stats.lastError = gmgnStatus;
  }
  onProgress();
  // 3. Watches in the order their bars close.
  const due = Object.values(state.watches).filter((w) => w.status === "watching" && Date.now() >= w.nextFetchAt).sort((a, b) => Number(b.theme != null) - Number(a.theme != null) || a.gradMs - b.gradMs);
  for (const w of due) {
    try { await evaluateWatch(state, w, Date.now()); } catch (error) { w.nextFetchAt = Date.now() + 30_000; state.stats.lastError = `watch ${w.symbol}: ${error instanceof Error ? error.message : String(error)}`; }
    onProgress();
  }
  // Forget old watches (keep 6 hours for the record).
  for (const [k, w] of Object.entries(state.watches)) if (w.status !== "watching" && now - w.gradMs > 6 * 3_600_000) delete state.watches[k];
  state.stats.cycles += 1;
  state.stats.lastCycleAt = now;
  const watching = Object.values(state.watches).filter((w) => w.status === "watching").length;
  return `gmgn=${gmgnStatus} new_graduations=${newCount} watching=${watching} open=${state.positions.length} closed=${state.closed.length}`;
}
