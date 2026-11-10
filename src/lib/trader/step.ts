import type { TraderDecision, TraderJob } from "./decide";
import { decide } from "./decide";
import { DEFAULT_BORROW_DAILY, HARD_MAX_LEVERAGE } from "../trading/margin";
import { placePaperOrder, type Quote, type Spec } from "../trading/book";
import type { Candle, Ledger, Position, TraderState } from "../types";

export function emptyTrader(): TraderState {
  return { enabled: false, assignments: [], lastBar: {}, lastTickAt: null, lastError: null };
}

export function ensureTrader(ledger: Ledger): TraderState {
  if (!ledger.trader) ledger.trader = emptyTrader();
  return ledger.trader;
}

function jobKey(job: TraderJob): string {
  return `${job.symbol}|${job.bar}`;
}

export function applyTraderBar(
  ledger: Ledger,
  job: TraderJob,
  candles: Candle[],
  quote: Quote,
  spec: Spec,
  borrowDailyRate = DEFAULT_BORROW_DAILY,
): { skipped: boolean; decision: TraderDecision | null; message: string } {
  const trader = ensureTrader(ledger);
  if (!trader.enabled) return { skipped: true, decision: null, message: "Auto-trader is stopped." };
  if (!job.armed) return { skipped: true, decision: null, message: `${job.symbol} is not armed.` };
  const closed = candles.filter((bar) => bar.time > 0);
  if (closed.length < 30) return { skipped: true, decision: null, message: "Not enough closed candles." };
  const key = jobKey(job);
  const last = closed[closed.length - 1].time;
  if (trader.lastBar[key] === last) return { skipped: true, decision: null, message: "Bar already processed." };
  const position = ledger.account.positions.find((item) => item.symbol === job.symbol);
  const actual = position
    ? { qty: position.qty, avgPrice: position.avgPrice, stopLoss: position.stopLoss, takeProfit: position.takeProfit }
    : null;
  const decision = decide(job, closed, actual);
  trader.lastBar[key] = last;
  trader.lastTickAt = Date.now();
  const prefix = `${job.symbol} ${job.strategyId} ${job.bar}`;
  if (decision.action === "hold") {
    note(ledger, `${prefix}: hold. ${decision.reason}`);
    return { skipped: false, decision, message: decision.reason };
  }
  if (decision.action === "trail" && position && decision.trailStop != null) {
    position.stopLoss = decision.trailStop;
    note(ledger, `${prefix}: trail stop moved to ${decision.trailStop}. ${decision.reason}`);
    return { skipped: false, decision, message: "Trail stop updated." };
  }
  if (decision.action === "close" && position) {
    const outcome = placePaperOrder(ledger, {
      venue: "okx",
      symbol: job.symbol,
      side: "sell",
      type: "market",
      qty: position.qty,
      leverage: 1,
    }, quote, spec, borrowDailyRate);
    note(ledger, `${prefix}: close. ${decision.reason} ${outcome.message}`);
    return { skipped: false, decision, message: outcome.message };
  }
  if (decision.action === "buy") {
    const outcome = placePaperOrder(ledger, {
      venue: "okx",
      symbol: job.symbol,
      side: "buy",
      type: "market",
      sizeFromRisk: true,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      leverage: Math.min(HARD_MAX_LEVERAGE, ledger.settings.limits.maxLeverage),
    }, quote, spec, borrowDailyRate);
    note(ledger, `${prefix}: buy. ${decision.reason} ${outcome.message}`);
    return { skipped: false, decision, message: outcome.message };
  }
  note(ledger, `${prefix}: ${decision.action}. ${decision.reason}`);
  return { skipped: false, decision, message: decision.reason };
}

function note(ledger: Ledger, message: string) {
  ledger.account.audits.unshift({
    id: crypto.randomUUID(),
    ts: Date.now(),
    level: "info",
    kind: "trader",
    message,
  });
  if (ledger.account.audits.length > 400) ledger.account.audits.length = 400;
}

export function summaryFrom(ledger: Ledger, equity: number) {
  const trader = ledger.trader ?? emptyTrader();
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dayFills = ledger.account.fills.filter((fill) => {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(fill.ts));
    return key === dayKey;
  });
  const realized = dayFills.reduce((sum, fill) => sum + fill.realizedPnl, 0);
  const drawdown = ledger.account.peakEquity > 0 ? (ledger.account.peakEquity - equity) / ledger.account.peakEquity : 0;
  const low = ledger.settings.targets.dailyLow;
  const high = ledger.settings.targets.dailyHigh;
  const dayReturn = ledger.account.principal > 0 ? realized / ledger.account.principal : 0;
  return {
    day: dayKey,
    equity,
    principal: ledger.account.principal,
    realizedPnl: realized,
    realizedReturn: dayReturn,
    mtmPnl: equity - ledger.account.dayStartEquity,
    trades: dayFills.length,
    drawdown,
    targetLow: low,
    targetHigh: high,
    insideBand: dayReturn >= low && dayReturn <= high,
    traderEnabled: trader.enabled,
    assignments: trader.assignments,
    lastTickAt: trader.lastTickAt,
    lastError: trader.lastError,
  };
}

export type { Position };
