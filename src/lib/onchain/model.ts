import { dubaiDayKey } from "../time";
import { defaultMomentumConfig, evaluateMomentumSafety, momentumBreakout, momentumPullback, normalizeConfig, type MomentumBar, type MomentumConfig } from "./momentum";

/** Paper sleeve taken from the $50,000 book. Not extra capital. */
export const SLEEVE_USD = 2_500;
export const MAX_PER_TOKEN_USD = 100;
export const MAX_OPEN = 5;
export const HARD_STOP = 0.35;
export const TAKE_HALF_AT = 0.5;
export const TRAIL_AFTER_HALF = 0.2;
export const MAX_HOLD_MS = 24 * 60 * 60 * 1000;
export const DAILY_LOSS_USD = 250;
export const CLUSTER_WALLETS = 3;
export const CLUSTER_WINDOW_MS = 30 * 60 * 1000;
export const FILL_DELAY_MS = 8_000;
export const PRIORITY_LAMPORTS = 105_000;
export const MIN_LIQUIDITY_USD = 50_000;
export const MIN_VOLUME_USD = 10_000;
export const MAX_VOLUME_TO_LIQUIDITY = 30;
export const MAX_TOP10 = 0.3;
export const MAX_DEV_SHARE = 0.05;
export const MAX_BUNDLER = 0.15;
export const MAX_SNIPER = 0.15;
export const MIN_AGE_MS = 5 * 60 * 1000;
export const MIN_SCORED_TRADES = 5;
export const MIN_WIN_RATE = 0.45;
export const MIN_MEDIAN_HOLD_MS = 60_000;
export const BOT_HOLD_MS = 2_000;
export const BOT_TRADE_COUNT = 400;

const EXCLUDED_TAGS = new Set(["sniper", "snipe_bot", "bundler", "rat_trader", "dex_bot", "dev", "insider"]);

export interface HolderShare {
  share: number;
  pool: boolean;
}

export interface TokenCheck {
  address: string;
  symbol: string;
  price: number | null;
  quoteReserveUsd: number | null;
  feeRate: number;
  ageMs: number | null;
  graduated: boolean | null;
  mintRevoked: boolean | null;
  freezeRevoked: boolean | null;
  lpBurnedOrLocked: boolean | null;
  holders: HolderShare[] | null;
  devShare: number | null;
  devSelling: boolean | null;
  honeypot: boolean | null;
  sellProceedsUsd: number | null;
  bundlerRate: number | null;
  sniperRate: number | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  wash: boolean | null;
  venue: string | null;
  bars?: MomentumBar[];
  buyTx5m?: number | null;
  buyTxAvg?: number | null;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
}

export function top10ExcludingPool(holders: HolderShare[] | null): number | null {
  if (!holders || holders.length === 0) return null;
  const people = holders.filter((row) => !row.pool && row.share > 0).sort((a, b) => b.share - a.share).slice(0, 10);
  if (people.length === 0) return null;
  return people.reduce((sum, row) => sum + row.share, 0);
}

export function simulateSell(price: number, quoteReserveUsd: number, notionalUsd: number, feeRate: number): number | null {
  if (!(price > 0) || !(quoteReserveUsd > 0) || !(notionalUsd > 0) || feeRate < 0 || feeRate >= 1) return null;
  const tokens = notionalUsd / price;
  const baseReserve = quoteReserveUsd / price;
  const sold = tokens * (1 - feeRate);
  if (!(baseReserve > 0) || sold >= baseReserve) return 0;
  const quoteOut = (quoteReserveUsd * sold) / (baseReserve + sold);
  return quoteOut;
}

export function buyExecution(mid: number, notionalUsd: number, quoteReserveUsd: number, feeRate: number): { price: number; tokens: number; impact: number } | null {
  if (!(mid > 0) || !(notionalUsd > 0) || !(quoteReserveUsd > 0) || notionalUsd >= quoteReserveUsd * 0.05) return null;
  const spent = notionalUsd * (1 - feeRate);
  const tokens = (spent / mid) * (quoteReserveUsd / (quoteReserveUsd + spent));
  if (!(tokens > 0)) return null;
  const price = notionalUsd / tokens;
  return { price, tokens, impact: price / mid - 1 };
}

export function sellExecution(mid: number, tokens: number, quoteReserveUsd: number, feeRate: number): { price: number; proceeds: number } | null {
  if (!(mid > 0) || !(tokens > 0) || !(quoteReserveUsd > 0)) return null;
  const baseReserve = quoteReserveUsd / mid;
  const sold = tokens * (1 - feeRate);
  if (!(baseReserve > sold)) return null;
  const proceeds = (quoteReserveUsd * sold) / (baseReserve + sold);
  return { price: proceeds / tokens, proceeds };
}

export function priorityFeeUsd(solPrice: number): number {
  if (!(solPrice > 0)) return 0.02;
  return (PRIORITY_LAMPORTS / 1e9) * solPrice;
}

export function evaluateToken(token: TokenCheck): GateResult {
  const reasons: string[] = [];
  if (token.graduated !== true) reasons.push(token.graduated === false ? "Token is still on the bonding curve." : "Graduation is unverified.");
  if (token.mintRevoked !== true) reasons.push(token.mintRevoked === false ? "Mint authority is still set." : "Mint authority is unverified.");
  if (token.freezeRevoked !== true) reasons.push(token.freezeRevoked === false ? "Freeze authority is still set." : "Freeze authority is unverified.");
  if (token.lpBurnedOrLocked !== true) reasons.push(token.lpBurnedOrLocked === false ? "LP is not burned or locked." : "LP burn or lock is unverified.");
  const top10 = top10ExcludingPool(token.holders);
  if (top10 == null) reasons.push("Top-10 holders excluding the pool are unverified.");
  else if (top10 > MAX_TOP10) reasons.push(`Top 10 excluding the pool hold ${(top10 * 100).toFixed(1)}%.`);
  if (token.devShare == null) reasons.push("Dev wallet share is unverified.");
  else if (token.devShare > MAX_DEV_SHARE) reasons.push(`Dev wallet holds ${(token.devShare * 100).toFixed(1)}%.`);
  if (token.devSelling == null) reasons.push("Dev selling is unverified.");
  else if (token.devSelling) reasons.push("Dev wallet is selling.");
  const simOk = token.sellProceedsUsd != null && token.sellProceedsUsd > 0;
  if (token.honeypot === true || token.sellProceedsUsd === 0) reasons.push("Honeypot: a sell does not return funds.");
  else if (token.honeypot !== false && !simOk) reasons.push("Honeypot check is unverified.");
  if (token.bundlerRate == null) reasons.push("Bundled-buy share is unverified.");
  else if (token.bundlerRate > MAX_BUNDLER) reasons.push(`Bundled buys are ${(token.bundlerRate * 100).toFixed(1)}%.`);
  if (token.sniperRate == null) reasons.push("Sniper share is unverified.");
  else if (token.sniperRate > MAX_SNIPER) reasons.push(`Snipers are ${(token.sniperRate * 100).toFixed(1)}%.`);
  if (token.liquidityUsd == null || token.liquidityUsd < MIN_LIQUIDITY_USD) reasons.push(`Liquidity is under $${MIN_LIQUIDITY_USD.toLocaleString("en-US")}.`);
  if (token.volumeUsd == null || token.volumeUsd < MIN_VOLUME_USD) reasons.push("Volume is too thin to look real.");
  else if (token.liquidityUsd != null && token.volumeUsd > token.liquidityUsd * MAX_VOLUME_TO_LIQUIDITY) reasons.push("Volume is extreme versus liquidity.");
  if (token.wash !== false) reasons.push(token.wash ? "Wash-trading flag is on." : "Wash-trading flag is unverified.");
  if (token.ageMs == null || token.ageMs < MIN_AGE_MS) reasons.push("Token is under 5 minutes old.");
  if (!(token.price != null && token.price > 0) || !(token.quoteReserveUsd != null && token.quoteReserveUsd > 0)) reasons.push("Pool depth is missing, so a delayed fill cannot be priced.");
  return { pass: reasons.length === 0, reasons };
}

export interface WalletClose {
  pnl: number;
  holdMs: number;
  ts: number;
}

export interface WalletStats {
  realizedPnl: number;
  winRate: number;
  trades: number;
  medianHoldMs: number;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function statsFromCloses(closes: WalletClose[], now: number): WalletStats | null {
  const windowed = closes.filter((row) => now - row.ts <= 90 * 24 * 60 * 60 * 1000 && now - row.ts >= 0);
  if (windowed.length < MIN_SCORED_TRADES) return null;
  const wins = windowed.filter((row) => row.pnl > 0).length;
  return {
    realizedPnl: windowed.reduce((sum, row) => sum + row.pnl, 0),
    winRate: wins / windowed.length,
    trades: windowed.length,
    medianHoldMs: median(windowed.map((row) => row.holdMs)),
  };
}

export function exclusionReason(tags: string[], stats: WalletStats | null): string | null {
  const hit = tags.map((tag) => tag.toLowerCase()).find((tag) => EXCLUDED_TAGS.has(tag));
  if (hit) return `tagged ${hit}`;
  if (!stats) return "fewer than 5 closed trades in the last 90 days";
  if (stats.medianHoldMs < BOT_HOLD_MS) return "median hold is under 2 seconds";
  if (stats.trades > BOT_TRADE_COUNT) return "trade count looks like a bot";
  if (!(stats.realizedPnl > 0)) return "realized P&L is not positive";
  if (stats.winRate < MIN_WIN_RATE) return "win rate is under 45%";
  if (stats.medianHoldMs < MIN_MEDIAN_HOLD_MS) return "median hold is under 1 minute";
  return null;
}

export interface ObservedTrade {
  wallet: string;
  token: string;
  symbol: string;
  side: "buy" | "sell";
  ts: number;
  usd: number;
  tags: string[];
  /** Present only when GMGN sent a complete 30-day wallet card. */
  gmgn?: WalletStats | null;
}

export interface WalletRecord {
  tags: string[];
  lots: { token: string; ts: number; cost: number }[];
  closes: WalletClose[];
  gmgn: WalletStats | null;
}

export interface WalletRank {
  address: string;
  realizedPnl: number;
  winRate: number;
  trades: number;
  medianHoldMs: number;
  eligible: boolean;
  reason: string;
  score: number;
}

export function rankWallets(book: Record<string, WalletRecord>, now: number): WalletRank[] {
  const rows = Object.entries(book).map(([address, record]) => {
    const observed = statsFromCloses(record.closes, now);
    const stats = observed ?? record.gmgn;
    const reason = exclusionReason(record.tags, stats);
    const score = stats && !reason ? stats.realizedPnl * stats.winRate * Math.log10(1 + stats.trades) : 0;
    return {
      address,
      realizedPnl: stats?.realizedPnl ?? 0,
      winRate: stats?.winRate ?? 0,
      trades: stats?.trades ?? observed?.trades ?? record.closes.length,
      medianHoldMs: stats?.medianHoldMs ?? 0,
      eligible: reason == null,
      reason: reason ?? "scored",
      score,
    };
  });
  rows.sort((a, b) => b.score - a.score || b.realizedPnl - a.realizedPnl);
  return rows;
}

export function applyTrade(book: Record<string, WalletRecord>, trade: ObservedTrade): void {
  const current = book[trade.wallet] ?? { tags: [], lots: [], closes: [], gmgn: null };
  const tags = [...new Set([...current.tags, ...trade.tags])];
  const gmgn = trade.gmgn ?? current.gmgn;
  if (trade.side === "buy" && trade.usd > 0) {
    current.lots.push({ token: trade.token, ts: trade.ts, cost: trade.usd });
  } else if (trade.side === "sell") {
    const index = current.lots.findIndex((lot) => lot.token === trade.token);
    if (index >= 0) {
      const lot = current.lots.splice(index, 1)[0];
      current.closes.push({ pnl: trade.usd - lot.cost, holdMs: Math.max(0, trade.ts - lot.ts), ts: trade.ts });
      if (current.closes.length > 80) current.closes.splice(0, current.closes.length - 80);
    }
  }
  if (current.lots.length > 40) current.lots.splice(0, current.lots.length - 40);
  book[trade.wallet] = { ...current, tags, gmgn };
}

export interface Cluster {
  token: string;
  symbol: string;
  wallets: string[];
  firstTs: number;
  lastTs: number;
}

export function findClusters(trades: ObservedTrade[], eligible: Set<string>, now: number): Cluster[] {
  const groups = new Map<string, Cluster>();
  for (const trade of trades) {
    if (trade.side !== "buy" || !eligible.has(trade.wallet)) continue;
    if (now - trade.ts > CLUSTER_WINDOW_MS || trade.ts > now) continue;
    const current = groups.get(trade.token) ?? { token: trade.token, symbol: trade.symbol, wallets: [], firstTs: trade.ts, lastTs: trade.ts };
    if (!current.wallets.includes(trade.wallet)) current.wallets.push(trade.wallet);
    current.firstTs = Math.min(current.firstTs, trade.ts);
    current.lastTs = Math.max(current.lastTs, trade.ts);
    current.symbol = trade.symbol || current.symbol;
    groups.set(trade.token, current);
  }
  return [...groups.values()].filter((row) => row.wallets.length >= CLUSTER_WALLETS);
}

export interface SleevePosition {
  id: string;
  address: string;
  symbol: string;
  qty: number;
  avgCost: number;
  spent: number;
  openedAt: number;
  halfTaken: boolean;
  peakPrice: number;
  lastPrice: number;
  feeRate: number;
  /** Pullback entries store the stop under the pullback low. */
  stopPrice?: number;
}

export interface SleevePending {
  address: string;
  symbol: string;
  signalTs: number;
  signalPrice: number;
  wallets: string[];
  readyAt: number;
  stopPrice?: number;
}

export interface SleeveFill {
  id: string;
  ts: number;
  address: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  pnl: number;
  note: string;
}

export interface SleeveLog {
  id: string;
  ts: number;
  kind: "signal" | "skip" | "fill" | "exit" | "pause" | "info";
  address?: string;
  symbol?: string;
  message: string;
}

export interface OnchainState {
  version: 1;
  principal: number;
  cash: number;
  dayKey: string;
  paused: boolean;
  pauseReason: string | null;
  positions: SleevePosition[];
  pending: SleevePending[];
  recent: ObservedTrade[];
  wallets: Record<string, WalletRecord>;
  logs: SleeveLog[];
  fills: SleeveFill[];
  startedAt: number | null;
  lastTickAt: number | null;
  lastError: string | null;
  gmgn: boolean;
  solPriceNote: string | null;
  ticks: number;
  config: MomentumConfig;
}

export function emptyOnchain(now: number, principal = SLEEVE_USD): OnchainState {
  return {
    version: 1,
    principal,
    cash: principal,
    dayKey: dubaiDayKey(new Date(now)),
    paused: false,
    pauseReason: null,
    positions: [],
    pending: [],
    recent: [],
    wallets: {},
    logs: [],
    fills: [],
    startedAt: now,
    lastTickAt: null,
    lastError: null,
    gmgn: false,
    solPriceNote: null,
    ticks: 0,
    config: defaultMomentumConfig(),
  };
}

function pushLog(state: OnchainState, log: Omit<SleeveLog, "id">): void {
  state.logs.unshift({ ...log, id: `${log.ts}-${state.logs.length}-${log.kind}` });
  if (state.logs.length > 200) state.logs.length = 200;
}

export function dayRealized(state: OnchainState, now: number): number {
  const day = dubaiDayKey(new Date(now));
  return state.fills.filter((fill) => dubaiDayKey(new Date(fill.ts)) === day).reduce((sum, fill) => sum + fill.pnl, 0);
}

export function markSleeve(state: OnchainState, prices: Map<string, number>): number {
  return state.positions.reduce((sum, position) => {
    const mark = prices.get(position.address) ?? position.avgCost;
    return sum + position.qty * mark;
  }, state.cash);
}

function sellQty(state: OnchainState, position: SleevePosition, qty: number, price: number, proceeds: number, fee: number, now: number, note: string): void {
  const basis = position.avgCost * qty;
  const pnl = proceeds - fee - basis;
  position.qty -= qty;
  position.spent = Math.max(0, position.spent - basis);
  state.cash += proceeds - fee;
  state.fills.unshift({
    id: `${now}-sell-${position.address}`,
    ts: now,
    address: position.address,
    symbol: position.symbol,
    side: "sell",
    qty,
    price,
    fee,
    pnl,
    note,
  });
  if (state.fills.length > 200) state.fills.length = 200;
  pushLog(state, { ts: now, kind: "exit", address: position.address, symbol: position.symbol, message: note });
}

export interface TickInput {
  now: number;
  trades: ObservedTrade[];
  tokens: TokenCheck[];
  priorityUsd: number;
  gmgn: boolean;
  solPriceNote: string | null;
}

export function stepOnchain(state: OnchainState, input: TickInput): OnchainState {
  const now = input.now;
  state.gmgn = input.gmgn;
  state.solPriceNote = input.solPriceNote;
  state.config = normalizeConfig(state.config);
  state.lastTickAt = now;
  state.lastError = null;
  state.ticks += 1;
  const day = dubaiDayKey(new Date(now));
  if (state.dayKey !== day) {
    state.dayKey = day;
    state.paused = false;
    state.pauseReason = null;
    pushLog(state, { ts: now, kind: "info", message: `New Dubai day ${day}. The $250 daily pause is clear.` });
  }
  state.recent = state.recent.filter((trade) => now - trade.ts <= CLUSTER_WINDOW_MS && trade.ts <= now);
  for (const trade of input.trades) {
    applyTrade(state.wallets, trade);
    const seen = state.recent.some((row) => row.wallet === trade.wallet && row.token === trade.token && row.side === trade.side && row.ts === trade.ts);
    if (!seen) state.recent.push(trade);
  }
  if (state.recent.length > 400) state.recent.splice(0, state.recent.length - 400);
  const walletCount = Object.keys(state.wallets).length;
  if (walletCount > 500) {
    const ranked = rankWallets(state.wallets, now);
    const keep = new Set(ranked.slice(0, 500).map((row) => row.address));
    for (const address of Object.keys(state.wallets)) if (!keep.has(address)) delete state.wallets[address];
  }
  const ranks = rankWallets(state.wallets, now);
  const eligible = new Set(ranks.filter((row) => row.eligible).map((row) => row.address));
  const byAddress = new Map(input.tokens.map((token) => [token.address, token]));

  for (const position of [...state.positions]) {
    const token = byAddress.get(position.address);
    const mid = token?.price ?? null;
    if (!(mid != null && mid > 0) || !(token?.quoteReserveUsd != null && token.quoteReserveUsd > 0)) {
      pushLog(state, { ts: now, kind: "skip", address: position.address, symbol: position.symbol, message: "Exit skipped. No fresh pool price." });
      continue;
    }
    position.lastPrice = mid;
    if (mid > position.peakPrice) position.peakPrice = mid;
    if (!state.config.walletGate) {
      const cfg = state.config;
      const hardPx = position.stopPrice && position.stopPrice > 0 ? position.stopPrice : position.avgCost * (1 - cfg.hardStop);
      const age = now - position.openedAt;
      const progressed = position.peakPrice >= position.avgCost * (1 + cfg.progressPct);
      let qty = 0;
      let note = "";
      if (age >= cfg.maxHoldMs) {
        qty = position.qty;
        note = `Max hold of ${Math.round(cfg.maxHoldMs / 60_000)}m. Closed the full position.`;
      } else if (mid <= hardPx) {
        qty = position.qty;
        note = position.stopPrice
          ? "Hard stop under the pullback low."
          : `Hard stop at -${Math.round(cfg.hardStop * 100)}%.`;
      } else if (cfg.entryMode !== "pullback" && age >= cfg.progressWindowMs && !progressed) {
        qty = position.qty;
        note = "Time stop. Price never reached +5% inside the window.";
      } else if (mid >= position.avgCost * (1 + cfg.takeProfit)) {
        qty = position.qty;
        note = `Take profit at +${Math.round(cfg.takeProfit * 100)}% of principal.`;
      }
      if (qty > 0) {
        const exec = sellExecution(mid, qty, token.quoteReserveUsd, position.feeRate);
        if (!exec) pushLog(state, { ts: now, kind: "skip", address: position.address, symbol: position.symbol, message: "Exit skipped. The pool cannot absorb the sell." });
        else sellQty(state, position, qty, exec.price, exec.proceeds, input.priorityUsd, now, `${note} Fill $${exec.price.toPrecision(4)} after pool impact. Priority fee $${input.priorityUsd.toFixed(3)}.`);
      }
      continue;
    }
    const hard = position.avgCost * (1 - HARD_STOP);
    const trail = position.halfTaken ? position.peakPrice * (1 - TRAIL_AFTER_HALF) : hard;
    const stop = Math.max(hard, trail);
    let qty = 0;
    let note = "";
    if (now - position.openedAt >= MAX_HOLD_MS) {
      qty = position.qty;
      note = "Max hold of 24h. Paper sell of the rest.";
    } else if (mid <= hard) {
      qty = position.qty;
      note = "Hard stop at -35%.";
    } else if (position.halfTaken && mid <= stop) {
      qty = position.qty;
      note = "Trailing stop on the remainder.";
    } else if (!position.halfTaken && mid >= position.avgCost * (1 + TAKE_HALF_AT)) {
      qty = position.qty / 2;
      note = "Took half at +50%.";
      position.halfTaken = true;
    }
    if (qty > 0) {
      const exec = sellExecution(mid, qty, token.quoteReserveUsd, position.feeRate);
      if (!exec) {
        pushLog(state, { ts: now, kind: "skip", address: position.address, symbol: position.symbol, message: "Exit skipped. The pool cannot absorb the sell." });
        if (note.startsWith("Took half")) position.halfTaken = false;
      } else {
        sellQty(state, position, qty, exec.price, exec.proceeds, input.priorityUsd, now, `${note} Fill $${exec.price.toPrecision(4)} after pool impact. Priority fee $${input.priorityUsd.toFixed(3)}.`);
      }
    }
  }
  state.positions = state.positions.filter((position) => position.qty > 1e-12);

  const realized = dayRealized(state, now);
  if (realized <= -DAILY_LOSS_USD && !state.paused) {
    state.paused = true;
    state.pauseReason = `Dubai-day realized loss is $${Math.abs(realized).toFixed(2)}. New entries are paused.`;
    pushLog(state, { ts: now, kind: "pause", message: state.pauseReason });
  }

  for (const pending of [...state.pending]) {
    if (now < pending.readyAt) continue;
    const token = byAddress.get(pending.address);
    state.pending = state.pending.filter((row) => row.address !== pending.address);
    if (!token) {
      pushLog(state, { ts: now, kind: "skip", address: pending.address, symbol: pending.symbol, message: "Delayed fill cancelled. The pool quote expired." });
      continue;
    }
    const gate = state.config.walletGate ? evaluateToken(token) : evaluateMomentumSafety(token);
    if (!gate.pass || token.price == null || token.quoteReserveUsd == null) {
      pushLog(state, { ts: now, kind: "skip", address: pending.address, symbol: pending.symbol, message: `Delayed fill cancelled. ${gate.reasons[0] ?? "Gate failed."}` });
      continue;
    }
    openPosition(state, token, pending, input.priorityUsd, now);
  }

  if (state.ticks === 1) {
    pushLog(state, {
      ts: now,
      kind: "info",
      message: state.config.walletGate
        ? "Wallet gate is on. Entries still require a scored cluster."
        : state.config.entryMode === "pullback"
          ? "Pullback mode. Wallet scoring is off. A buy waits for the first pullback after a hype spike, then a higher-low or VWAP reclaim. The stop sits under the pullback low. Safety is mint, freeze, a sell that returns funds, $50k liquidity, and 5 minutes of age."
          : "Momentum mode. Wallet scoring is off. A buy needs a breakout, 3× volume, rising buys, and accelerating price. Safety is mint, freeze, a sell that returns funds, $50k liquidity, and 5 minutes of age.",
    });
  }
  if (!state.config.legacyEntries) {
    // Breakout, pullback and smart-money entries are switched off. Only the graduation-window paper account trades.
    if (!state.logs.some((log) => log.message.startsWith("Legacy entries are off."))) {
      pushLog(state, { ts: now, kind: "info", message: "Legacy entries are off. Breakout, pullback and smart-money entries are disabled; the graduation-window paper account is the only active strategy. Open positions here still get exits." });
    }
    return state;
  }
  if (!state.config.walletGate) {
    const seenMomentum = new Set<string>();
    for (const token of input.tokens) {
      if (seenMomentum.has(token.address)) continue;
      seenMomentum.add(token.address);
      if (state.positions.some((row) => row.address === token.address) || state.pending.some((row) => row.address === token.address)) continue;
      const gate = evaluateMomentumSafety(token);
      const pullback = state.config.entryMode === "pullback";
      const signal = !gate.pass
        ? null
        : pullback
          ? momentumPullback(token.bars ?? [], state.config)
          : momentumBreakout(token.bars ?? [], state.config, { now: token.buyTx5m ?? null, average: token.buyTxAvg ?? null });
      const message = !gate.pass
        ? gate.reasons.slice(0, 3).join(" ")
        : signal && !signal.ok
          ? signal.reasons[0] ?? "No momentum signal."
          : "";
      if (message) {
        const recent = state.logs.some((log) => log.address === token.address && log.message === message && now - log.ts < 30 * 60 * 1000);
        if (!recent) pushLog(state, { ts: now, kind: "skip", address: token.address, symbol: token.symbol, message });
        continue;
      }
      if (state.paused) continue;
      if (state.positions.length + state.pending.length >= MAX_OPEN) {
        pushLog(state, { ts: now, kind: "skip", address: token.address, symbol: token.symbol, message: "Five paper positions are already open." });
        continue;
      }
      const stopPrice = pullback && signal && "stop" in signal && signal.stop != null && signal.stop > 0 ? signal.stop : undefined;
      state.pending.push({
        address: token.address,
        symbol: token.symbol,
        signalTs: now,
        signalPrice: token.price ?? 0,
        wallets: [],
        readyAt: now + FILL_DELAY_MS,
        stopPrice,
      });
      const pullMsg = pullback && signal && "pullbackLow" in signal
        ? `First pullback after a hype spike. Retrace low ${signal.pullbackLow?.toPrecision(4) ?? "?"}. Stop under that low. Fill waits ${FILL_DELAY_MS / 1000}s.`
        : `Breakout above ${signal && "priorHigh" in signal ? signal.priorHigh?.toPrecision(4) ?? "the recent high" : "the recent high"} with ${signal && "volumeRatio" in signal ? signal.volumeRatio?.toFixed(1) ?? "?" : "?"}× volume. Fill waits ${FILL_DELAY_MS / 1000}s.`;
      pushLog(state, {
        ts: now,
        kind: "signal",
        address: token.address,
        symbol: token.symbol,
        message: pullMsg,
      });
    }
    return state;
  }
  const seen = new Set<string>();
  for (const token of input.tokens) {
    if (seen.has(token.address)) continue;
    seen.add(token.address);
    if (state.positions.some((row) => row.address === token.address) || state.pending.some((row) => row.address === token.address)) continue;
    const gate = evaluateToken(token);
    if (!gate.pass) {
      const message = gate.reasons.slice(0, 3).join(" ") || "Safety gate failed.";
      const recent = state.logs.some((log) => log.address === token.address && log.message === message && now - log.ts < 30 * 60 * 1000);
      if (!recent) pushLog(state, { ts: now, kind: "skip", address: token.address, symbol: token.symbol, message });
    }
  }
  if (state.paused) return state;
  const clusters = findClusters(state.recent, eligible, now);
  for (const cluster of clusters) {
    if (state.positions.some((row) => row.address === cluster.token) || state.pending.some((row) => row.address === cluster.token)) continue;
    if (state.positions.length + state.pending.length >= MAX_OPEN) {
      pushLog(state, { ts: now, kind: "skip", address: cluster.token, symbol: cluster.symbol, message: "Five paper positions are already open." });
      continue;
    }
    const token = byAddress.get(cluster.token);
    if (!token) {
      pushLog(state, { ts: now, kind: "signal", address: cluster.token, symbol: cluster.symbol, message: `${cluster.wallets.length} scored wallets bought. Safety data is not in this tick, so no order was queued.` });
      continue;
    }
    const gate = evaluateToken(token);
    if (!gate.pass || token.price == null) {
      pushLog(state, { ts: now, kind: "skip", address: cluster.token, symbol: cluster.symbol, message: gate.reasons.join(" ") });
      continue;
    }
    state.pending.push({
      address: cluster.token,
      symbol: cluster.symbol || token.symbol,
      signalTs: cluster.lastTs,
      signalPrice: token.price,
      wallets: cluster.wallets,
      readyAt: now + FILL_DELAY_MS,
    });
    pushLog(state, {
      ts: now,
      kind: "signal",
      address: cluster.token,
      symbol: cluster.symbol || token.symbol,
      message: `${cluster.wallets.length} scored wallets bought within 30 minutes. Paper fill waits ${FILL_DELAY_MS / 1000}s and then pays pool impact plus a priority fee.`,
    });
  }
  return state;
}

function openPosition(state: OnchainState, token: TokenCheck, pending: SleevePending, priorityUsd: number, now: number): void {
  if (state.positions.length >= MAX_OPEN) {
    pushLog(state, { ts: now, kind: "skip", address: token.address, symbol: token.symbol, message: "Five paper positions are already open." });
    return;
  }
  const budget = state.config.walletGate ? MAX_PER_TOKEN_USD : state.config.tradeUsd;
  if (state.cash < budget) {
    pushLog(state, { ts: now, kind: "skip", address: token.address, symbol: token.symbol, message: `Sleeve cash is under $${budget.toFixed(0)}.` });
    return;
  }
  const swap = budget - priorityUsd;
  const exec = token.price != null && token.quoteReserveUsd != null ? buyExecution(token.price, swap, token.quoteReserveUsd, token.feeRate) : null;
  if (!exec) {
    pushLog(state, { ts: now, kind: "skip", address: token.address, symbol: token.symbol, message: "Fill skipped. $100 is too large for this pool or the quote is missing." });
    return;
  }
  state.cash -= budget;
  state.positions.push({
    id: `${now}-${token.address.slice(0, 6)}`,
    address: token.address,
    symbol: token.symbol,
    qty: exec.tokens,
    avgCost: budget / exec.tokens,
    spent: budget,
    openedAt: now,
    halfTaken: false,
    peakPrice: exec.price,
    lastPrice: exec.price,
    feeRate: token.feeRate,
    stopPrice: pending.stopPrice,
  });
  state.fills.unshift({
    id: `${now}-buy-${token.address}`,
    ts: now,
    address: token.address,
    symbol: token.symbol,
    side: "buy",
    qty: exec.tokens,
    price: exec.price,
    fee: priorityUsd + (swap - exec.tokens * token.price!),
    pnl: 0,
    note: state.config.walletGate
      ? `Paper buy ${FILL_DELAY_MS / 1000}s after ${pending.wallets.length} wallets. Impact ${(exec.impact * 100).toFixed(2)}%. Priority fee $${priorityUsd.toFixed(3)}.`
      : state.config.entryMode === "pullback"
        ? `Pullback buy ${FILL_DELAY_MS / 1000}s after the first pullback confirmed. Impact ${(exec.impact * 100).toFixed(2)}%. Priority fee $${priorityUsd.toFixed(3)}.`
        : `Momentum buy ${FILL_DELAY_MS / 1000}s after the breakout. Impact ${(exec.impact * 100).toFixed(2)}%. Priority fee $${priorityUsd.toFixed(3)}.`,
  });
  pushLog(state, {
    ts: now,
    kind: "fill",
    address: token.address,
    symbol: token.symbol,
    message: `Bought $${budget.toFixed(0)} at $${exec.price.toPrecision(4)} versus the signal mid $${pending.signalPrice.toPrecision(4)}. Not the first fill.`,
  });
}

export function onchainPublic(state: OnchainState, now = Date.now()) {
  const prices = new Map(state.positions.map((position) => [position.address, position.lastPrice]));
  const ranks = rankWallets(state.wallets, now).slice(0, 12);
  const realized = dayRealized(state, now);
  const dayFills = state.fills.filter((fill) => dubaiDayKey(new Date(fill.ts)) === dubaiDayKey(new Date(now)));
  const reasonOf = (note: string) => {
    if (note.startsWith("Take profit")) return "take-profit";
    if (note.startsWith("Hard stop")) return "hard-stop";
    if (note.startsWith("Time stop")) return "time-stop";
    if (note.startsWith("Max hold")) return "max-hold";
    return null;
  };
  return {
    mode: state.config.walletGate ? "smart-money" as const : "momentum" as const,
    principal: state.principal,
    cash: state.cash,
    equity: markSleeve(state, prices),
    dayPnl: realized,
    dayPct: state.principal > 0 ? realized / state.principal : 0,
    paused: state.paused,
    pauseReason: state.pauseReason,
    openPositions: state.positions.length,
    positions: state.positions.map((position) => ({
      ...position,
      stop: position.stopPrice && position.stopPrice > 0
        ? position.stopPrice
        : position.avgCost * (1 - (state.config.walletGate ? HARD_STOP : state.config.hardStop)),
      target: position.avgCost * (1 + (state.config.walletGate ? TAKE_HALF_AT : state.config.takeProfit)),
      ageMs: now - position.openedAt,
    })),
    pending: state.pending,
    wallets: ranks,
    eligibleWallets: ranks.filter((row) => row.eligible).length,
    logs: state.logs.filter((log, index, all) => all.findIndex((row) => row.kind === log.kind && row.address === log.address && row.message === log.message) === index).slice(0, 40),
    fills: state.fills.slice(0, 20),
    trades: dayFills.length,
    signals: state.logs.filter((log) => log.kind === "signal").length,
    takeProfits: state.fills.filter((fill) => reasonOf(fill.note) === "take-profit").length,
    hardStops: state.fills.filter((fill) => reasonOf(fill.note) === "hard-stop").length,
    timeStops: state.fills.filter((fill) => reasonOf(fill.note) === "time-stop" || reasonOf(fill.note) === "max-hold").length,
    config: state.config,
    breaches: state.logs.filter((log) => dubaiDayKey(new Date(log.ts)) === dubaiDayKey(new Date(now)) && log.kind === "pause").map((log) => log.message),
    lastTickAt: state.lastTickAt,
    lastError: state.lastError,
    gmgn: state.gmgn,
    startedAt: state.startedAt,
    solPriceNote: state.solPriceNote,
    note: state.config.walletGate
      ? "Wallet gate is on. A buy still needs scored wallets plus the strict safety screen. Nothing is signed."
      : state.config.entryMode === "pullback"
        ? `Pullback paper test. Wallet scoring is off. Entry is the first pullback after a hype spike (${Math.round(state.config.retrace * 100)}% retrace, ${state.config.confirm}). Take profit closes the full position at +${Math.round(state.config.takeProfit * 100)}%. The stop sits under the pullback low. Max hold ${Math.round(state.config.maxHoldMs / 60_000)} minutes. The +20% breakout preset remains the default. Nothing is signed.`
        : `Momentum paper test. Wallet scoring is off. Take profit closes the full position at +${Math.round(state.config.takeProfit * 100)}%. Hard stop −${Math.round(state.config.hardStop * 100)}%. Time stop if price never reaches +${Math.round(state.config.progressPct * 100)}% within ${Math.round(state.config.progressWindowMs / 60_000)} minutes. Max hold ${Math.round(state.config.maxHoldMs / 60_000)} minutes. The +20% classic preset stays selectable. Nothing is signed.`,
  };
}
