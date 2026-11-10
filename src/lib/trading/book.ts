import crypto from "node:crypto";
import { ONCHAIN_PAPER_FEE_BPS, ONCHAIN_PAPER_SLIPPAGE_BPS, PAPER_MAKER_FEE_BPS, PAPER_SLIPPAGE_BPS, PAPER_TAKER_FEE_BPS } from "../defaults";
import { evaluateOrder } from "../risk/engine";
import { dubaiDayKey } from "../time";
import { applyBuy, applySell } from "./accounting";
import { DEFAULT_BORROW_DAILY, HARD_MAX_LEVERAGE, borrowCost, liquidationPrice, marginAndBorrow } from "./margin";
import { floorToStep, sizeLongSpot } from "./sizing";
import type { Fill, GmgnChain, Ledger, Position, WorkingOrder } from "../types";

export interface Quote {
  bid: number;
  last: number;
  ask: number;
}

export interface OrderInput {
  venue: "okx" | "gmgn";
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty?: number;
  usdSize?: number;
  limitPrice?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  sizeFromRisk?: boolean;
  leverage?: number;
  chain?: GmgnChain;
  address?: string;
}

export interface Spec {
  minSz: number;
  lotSz: number;
}

export interface OrderOutcome {
  ok: boolean;
  message: string;
  reasons: string[];
  estimatedQty?: number;
  estimatedPrice?: number;
  notional?: number;
  risk?: number | null;
  riskPct?: number | null;
  positionPct?: number | null;
}

function audit(ledger: Ledger, level: "info" | "warn" | "danger", kind: string, message: string) {
  ledger.account.audits.unshift({ id: crypto.randomUUID(), ts: Date.now(), level, kind, message });
  if (ledger.account.audits.length > 400) ledger.account.audits.length = 400;
}

function pushFill(ledger: Ledger, fill: Fill) {
  ledger.account.fills.unshift(fill);
  if (ledger.account.fills.length > 400) ledger.account.fills.length = 400;
}

export function marksEquity(ledger: Ledger, marks: Record<string, number>): number {
  return ledger.account.positions.reduce((sum, position) => {
    const mark = marks[position.symbol] ?? position.avgPrice;
    const borrowed = position.borrowed ?? 0;
    return sum + position.qty * mark - borrowed;
  }, ledger.account.cash);
}

export function reservedCash(ledger: Ledger): number {
  return ledger.account.openOrders.reduce((sum, order) => sum + (order.side === "buy" ? order.reservedCash : 0), 0);
}

function feeRate(venue: "okx" | "gmgn"): number {
  return (venue === "gmgn" ? ONCHAIN_PAPER_FEE_BPS : PAPER_TAKER_FEE_BPS) / 10_000;
}

function slipRate(venue: "okx" | "gmgn"): number {
  return (venue === "gmgn" ? ONCHAIN_PAPER_SLIPPAGE_BPS : PAPER_SLIPPAGE_BPS) / 10_000;
}

function referencePrice(input: OrderInput, quote: Quote): number {
  if (input.type === "limit") return input.limitPrice ?? 0;
  if (input.side === "buy") return quote.ask > 0 ? quote.ask : quote.last;
  return quote.bid > 0 ? quote.bid : quote.last;
}

function slipped(price: number, side: "buy" | "sell", venue: "okx" | "gmgn"): number {
  const slip = slipRate(venue);
  return side === "buy" ? price * (1 + slip) : price * (1 - slip);
}

export function markBook(ledger: Ledger, marks: Record<string, number>, now = Date.now()) {
  const account = ledger.account;
  for (const position of [...account.positions]) {
    const borrowed = position.borrowed ?? 0;
    if (borrowed > 0) {
      const last = position.lastBorrowTs ?? position.openedAt;
      const cost = borrowCost(borrowed, position.borrowDailyRate ?? DEFAULT_BORROW_DAILY, now - last);
      if (cost > 0) {
        account.cash -= cost;
        position.lastBorrowTs = now;
      }
    }
    const mark = marks[position.symbol];
    if (!(mark > 0)) continue;
    const liq = position.liquidationPrice;
    if (liq != null && mark <= liq) {
      closePosition(ledger, position, slipped(Math.min(mark, liq), "sell", position.venue), "liquidation", "Liquidated. Mark traded through the isolated liquidation price.");
      continue;
    }
    if (position.stopLoss != null && mark <= position.stopLoss) {
      const raw = Math.min(position.stopLoss, mark);
      closePosition(ledger, position, slipped(raw, "sell", position.venue), "stop", "Stop filled in the paper book.");
    } else if (position.takeProfit != null && mark >= position.takeProfit) {
      closePosition(ledger, position, slipped(position.takeProfit, "sell", position.venue), "take-profit", "Take-profit filled in the paper book.");
    }
  }
  for (const order of [...account.openOrders]) {
    const mark = marks[order.symbol];
    if (!(mark > 0)) continue;
    const marketable = order.side === "buy" ? mark <= order.limitPrice : mark >= order.limitPrice;
    if (!marketable) continue;
    const raw = order.side === "buy" ? Math.min(order.limitPrice, mark) : Math.max(order.limitPrice, mark);
    fillWorking(ledger, order, raw);
  }
  const equity = marksEquity(ledger, marks);
  const today = dubaiDayKey(new Date(now));
  if (today !== account.dayKey) {
    account.dayKey = today;
    account.dayStartEquity = equity;
    account.dailyKillLatched = false;
    audit(ledger, "info", "session", `New Dubai day ${today}. Daily loss switch cleared. Day-start equity ${equity.toFixed(2)}.`);
  }
  if (equity > account.peakEquity) account.peakEquity = equity;
  const limits = ledger.settings.limits;
  const dayLoss = account.dayStartEquity > 0 ? (account.dayStartEquity - equity) / account.dayStartEquity : 0;
  const drawdown = account.peakEquity > 0 ? (account.peakEquity - equity) / account.peakEquity : 0;
  if (dayLoss >= limits.maxDailyLossPct && !account.dailyKillLatched) {
    account.dailyKillLatched = true;
    audit(ledger, "danger", "kill", `Daily loss switch tripped at ${(dayLoss * 100).toFixed(2)}% of the Dubai-day start.`);
  }
  if (drawdown >= limits.maxDrawdownPct && !account.drawdownKillLatched) {
    account.drawdownKillLatched = true;
    account.drawdownKillEver = true;
    audit(ledger, "danger", "kill", `Drawdown switch tripped at ${(drawdown * 100).toFixed(2)}% from peak equity.`);
  }
  const last = account.equityCurve[account.equityCurve.length - 1];
  if (!last || now - last.ts > 10 * 60_000 || Math.abs(last.equity - equity) > 1) {
    account.equityCurve.push({ ts: now, equity });
    if (account.equityCurve.length > 2000) account.equityCurve.splice(0, account.equityCurve.length - 2000);
  }
}

function settleSell(ledger: Ledger, position: Position, price: number, qty: number): { fee: number; realizedPnl: number } {
  const fee = price * qty * feeRate(position.venue);
  const borrowed = position.borrowed ?? 0;
  if (borrowed > 0) {
    const portion = Math.min(1, qty / position.qty);
    const borrowedPart = borrowed * portion;
    ledger.account.cash += price * qty - fee - borrowedPart;
    position.borrowed = borrowed - borrowedPart;
    position.margin = (position.margin ?? 0) * (1 - portion);
    return { fee, realizedPnl: (price - position.avgPrice) * qty - fee };
  }
  const sold = applySell({ cash: ledger.account.cash, qty: position.qty, avgPrice: position.avgPrice }, price, qty, fee);
  ledger.account.cash = sold.cash;
  return { fee, realizedPnl: sold.realizedPnl };
}

function closePosition(ledger: Ledger, position: Position, price: number, orderType: Fill["orderType"], note: string) {
  const { fee, realizedPnl } = settleSell(ledger, position, price, position.qty);
  const sold = { cash: ledger.account.cash, realizedPnl };
  ledger.account.positions = ledger.account.positions.filter((item) => item.id !== position.id);
  ledger.account.openOrders = ledger.account.openOrders.filter((order) => order.symbol !== position.symbol || order.side !== "sell");
  pushFill(ledger, {
    id: crypto.randomUUID(),
    ts: Date.now(),
    venue: position.venue,
    symbol: position.symbol,
    side: "sell",
    qty: position.qty,
    price,
    fee,
    realizedPnl: sold.realizedPnl,
    orderType,
    route: "paper",
    note,
  });
  audit(ledger, "warn", "fill", `${note} ${position.symbol} ${position.qty} @ ${price.toFixed(6)}. Realized ${sold.realizedPnl.toFixed(2)}.`);
}

function fillWorking(ledger: Ledger, order: WorkingOrder, rawPrice: number) {
  const makerBuy = order.side === "buy" && order.venue === "okx";
  const price = makerBuy ? rawPrice : slipped(rawPrice, order.side, order.venue);
  ledger.account.openOrders = ledger.account.openOrders.filter((item) => item.id !== order.id);
  if (order.side === "buy") {
    openLong(ledger, {
      venue: order.venue,
      symbol: order.symbol,
      qty: order.qty,
      price,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      orderType: "limit",
      chain: order.chain,
      address: order.address,
      leverage: order.leverage,
      borrowDailyRate: order.borrowDailyRate,
      feeRate: makerBuy ? PAPER_MAKER_FEE_BPS / 10_000 : undefined,
      note: "Paper limit buy filled.",
    });
  } else {
    const position = ledger.account.positions.find((item) => item.symbol === order.symbol);
    if (!position) return;
    const qty = Math.min(order.qty, position.qty);
    const { fee, realizedPnl } = settleSell(ledger, position, price, qty);
    position.qty -= qty;
    if (position.qty <= 1e-12) ledger.account.positions = ledger.account.positions.filter((item) => item.id !== position.id);
    else if ((position.leverage ?? 1) > 1) position.liquidationPrice = liquidationPrice(position.avgPrice, position.leverage ?? 1);
    pushFill(ledger, {
      id: crypto.randomUUID(),
      ts: Date.now(),
      venue: order.venue,
      symbol: order.symbol,
      side: "sell",
      qty,
      price,
      fee,
      realizedPnl,
      orderType: "limit",
      route: "paper",
      note: "Paper limit sell filled.",
    });
  }
}

function openLong(ledger: Ledger, input: {
  venue: "okx" | "gmgn";
  symbol: string;
  qty: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  orderType: Fill["orderType"];
  chain?: GmgnChain;
  address?: string;
  note: string;
  leverage?: number;
  borrowDailyRate?: number;
  feeRate?: number;
}) {
  const fee = input.price * input.qty * (input.feeRate ?? feeRate(input.venue));
  const leverage = input.venue === "gmgn" ? 1 : Math.min(HARD_MAX_LEVERAGE, Math.max(1, input.leverage ?? 1));
  const existing = ledger.account.positions.find((position) => position.symbol === input.symbol);
  const parts = marginAndBorrow(input.price * input.qty, leverage);
  const unit = input.price + fee / input.qty;
  if (leverage > 1) {
    ledger.account.cash -= parts.margin + fee;
    if (existing && (existing.borrowed ?? 0) > 0 && (existing.leverage ?? 1) === leverage) {
      const qty = existing.qty + input.qty;
      existing.avgPrice = (existing.avgPrice * existing.qty + unit * input.qty) / qty;
      existing.qty = qty;
      existing.margin = (existing.margin ?? 0) + parts.margin;
      existing.borrowed = (existing.borrowed ?? 0) + parts.borrowed;
      existing.liquidationPrice = liquidationPrice(existing.avgPrice, leverage);
      existing.borrowDailyRate = input.borrowDailyRate ?? existing.borrowDailyRate ?? DEFAULT_BORROW_DAILY;
      if (input.stopLoss != null) existing.stopLoss = input.stopLoss;
      if (input.takeProfit != null) existing.takeProfit = input.takeProfit;
    } else {
      ledger.account.positions.push({
        id: crypto.randomUUID(),
        venue: input.venue,
        symbol: input.symbol,
        qty: input.qty,
        avgPrice: unit,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        openedAt: Date.now(),
        chain: input.chain,
        address: input.address,
        leverage,
        margin: parts.margin,
        borrowed: parts.borrowed,
        liquidationPrice: liquidationPrice(input.price, leverage),
        borrowDailyRate: input.borrowDailyRate ?? DEFAULT_BORROW_DAILY,
        lastBorrowTs: Date.now(),
      });
    }
  } else {
    const bought = applyBuy(
      { cash: ledger.account.cash, qty: existing?.qty ?? 0, avgPrice: existing?.avgPrice ?? 0 },
      input.price,
      input.qty,
      fee,
    );
    ledger.account.cash = bought.cash;
    if (existing) {
      existing.qty = bought.qty;
      existing.avgPrice = bought.avgPrice;
      if (input.stopLoss != null) existing.stopLoss = input.stopLoss;
      if (input.takeProfit != null) existing.takeProfit = input.takeProfit;
    } else {
      ledger.account.positions.push({
        id: crypto.randomUUID(),
        venue: input.venue,
        symbol: input.symbol,
        qty: bought.qty,
        avgPrice: bought.avgPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        openedAt: Date.now(),
        chain: input.chain,
        address: input.address,
        leverage: 1,
      });
    }
  }
  pushFill(ledger, {
    id: crypto.randomUUID(),
    ts: Date.now(),
    venue: input.venue,
    symbol: input.symbol,
    side: "buy",
    qty: input.qty,
    price: input.price,
    fee,
    realizedPnl: 0,
    orderType: input.orderType,
    route: "paper",
    note: input.note,
  });
  audit(ledger, "info", "fill", `${input.note} ${input.symbol} ${input.qty} @ ${input.price.toFixed(6)}. Fee ${fee.toFixed(2)}.`);
}

export function placePaperOrder(ledger: Ledger, input: OrderInput, quote: Quote, spec: Spec, borrowDailyRate = DEFAULT_BORROW_DAILY): OrderOutcome {
  const requested = input.venue === "gmgn" ? 1 : (input.leverage ?? ledger.settings.limits.maxLeverage);
  if (requested > HARD_MAX_LEVERAGE + 1e-9) {
    return {
      ok: false,
      message: `Hard ceiling is ${HARD_MAX_LEVERAGE}×. This order asked for ${requested}×.`,
      reasons: [`Above the ${HARD_MAX_LEVERAGE}× ceiling.`],
    };
  }
  const leverage = input.venue === "gmgn" ? 1 : Math.min(requested, ledger.settings.limits.maxLeverage);
  const touch = referencePrice(input, quote);
  if (!(touch > 0)) return { ok: false, message: "No price for that market.", reasons: ["Missing price."] };
  // Market orders pay the bid/ask plus slippage. Size and risk are checked at that fill, not at the untouched quote.
  const fillPrice = input.type === "market" ? slipped(touch, input.side, input.venue) : touch;
  const position = ledger.account.positions.find((item) => item.symbol === input.symbol);
  const currentQty = position?.qty ?? 0;
  const openSell = ledger.account.openOrders
    .filter((order) => order.symbol === input.symbol && order.side === "sell")
    .reduce((sum, order) => sum + order.qty, 0);
  let qty = input.qty ?? 0;
  if (input.side === "buy" && input.sizeFromRisk) {
    if (!(input.stopLoss && input.stopLoss < fillPrice)) {
      return { ok: false, message: "Sizing from risk needs a stop below the entry.", reasons: ["Stop required."] };
    }
    const sized = sizeLongSpot({
      equity: marksEquity(ledger, { [input.symbol]: quote.last || fillPrice }),
      price: fillPrice,
      stop: input.stopLoss,
      limits: ledger.settings.limits,
      minSz: spec.minSz,
      lotSz: spec.lotSz,
      feeBps: input.venue === "gmgn" ? ONCHAIN_PAPER_FEE_BPS : PAPER_TAKER_FEE_BPS,
      currentQty,
      peakEquity: ledger.account.peakEquity,
      dayStartEquity: ledger.account.dayStartEquity,
      dailyKillLatched: ledger.account.dailyKillLatched,
      drawdownKillLatched: ledger.account.drawdownKillLatched,
      leverage,
    });
    if (!sized.ok) return { ok: false, message: sized.reasons[0] ?? "Risk sizer refused the order.", reasons: sized.reasons };
    qty = sized.qty;
  } else if (input.usdSize && input.usdSize > 0 && !(input.qty && input.qty > 0)) {
    qty = input.usdSize / fillPrice;
    if (spec.lotSz > 0) qty = floorToStep(qty, spec.lotSz);
  } else if (spec.lotSz > 0) {
    qty = floorToStep(qty, spec.lotSz);
  }
  if (input.side === "sell" && input.usdSize && !(input.qty && input.qty > 0)) {
    qty = Math.min(currentQty - openSell, input.usdSize / fillPrice);
    if (spec.lotSz > 0) qty = floorToStep(qty, spec.lotSz);
  }
  if (!(qty > 0)) return { ok: false, message: "Quantity is zero after lot rounding.", reasons: ["Zero quantity."] };
  if (spec.minSz > 0 && qty + 1e-12 < spec.minSz) {
    return {
      ok: false,
      message: `Size ${qty} is below the OKX minimum ${spec.minSz}. It was not rounded up.`,
      reasons: ["Below exchange minimum."],
    };
  }
  if (input.venue === "gmgn" && input.side === "buy" && qty * fillPrice < 5) {
    return { ok: false, message: "On-chain paper orders have a $5 minimum so dust is not treated as a position.", reasons: ["Below $5."] };
  }
  const equity = marksEquity(ledger, { [input.symbol]: quote.last || fillPrice });
  const decision = evaluateOrder({
    equity,
    peakEquity: ledger.account.peakEquity,
    dayStartEquity: ledger.account.dayStartEquity,
    limits: ledger.settings.limits,
    dailyKillLatched: ledger.account.dailyKillLatched,
    drawdownKillLatched: ledger.account.drawdownKillLatched,
    order: {
      side: input.side,
      qty,
      price: fillPrice,
      leverage,
      stopLoss: input.stopLoss ?? null,
      currentQty: input.side === "sell" ? currentQty - openSell : currentQty,
      feeBps: input.venue === "gmgn" ? ONCHAIN_PAPER_FEE_BPS : PAPER_TAKER_FEE_BPS,
    },
  });
  if (!decision.allowed) {
    return { ok: false, message: decision.reasons[0] ?? "Risk check failed.", reasons: decision.reasons, estimatedQty: qty, estimatedPrice: fillPrice };
  }
  const fee = fillPrice * qty * feeRate(input.venue);
  if (input.side === "buy") {
    const freeCash = ledger.account.cash - reservedCash(ledger);
    const cashNeed = (leverage > 1 ? (fillPrice * qty) / leverage : fillPrice * qty) + fee;
    if (cashNeed > freeCash + 1e-8) {
      return { ok: false, message: "Not enough free cash for the isolated margin and fee.", reasons: ["Insufficient cash."], estimatedQty: qty };
    }
  }
  if (input.side === "sell" && qty > currentQty - openSell + 1e-9) {
    return { ok: false, message: "That sell is larger than the free long. The desk does not open shorts.", reasons: ["Insufficient position."] };
  }

  const marketable = input.type === "market"
    || (input.side === "buy" && quote.ask > 0 && (input.limitPrice ?? 0) >= quote.ask)
    || (input.side === "sell" && quote.bid > 0 && (input.limitPrice ?? Infinity) <= quote.bid);

  if (!marketable && input.type === "limit") {
    const order: WorkingOrder = {
      id: crypto.randomUUID(),
      venue: input.venue,
      symbol: input.symbol,
      side: input.side,
      type: "limit",
      qty,
      limitPrice: input.limitPrice ?? fillPrice,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      reservedCash: input.side === "buy" ? (leverage > 1 ? (fillPrice * qty) / leverage : fillPrice * qty) + fee : 0,
      createdAt: Date.now(),
      chain: input.chain,
      address: input.address,
      leverage,
      borrowDailyRate,
    };
    ledger.account.openOrders.push(order);
    audit(ledger, "info", "order", `Resting paper ${input.side} ${qty} ${input.symbol} @ ${order.limitPrice}.`);
    return { ok: true, message: "Limit order is resting in the paper book.", reasons: [], estimatedQty: qty, estimatedPrice: order.limitPrice };
  }

  if (input.side === "buy") {
    const raw = input.type === "limit" && quote.ask > 0 ? Math.min(input.limitPrice ?? fillPrice, quote.ask) : touch;
    const price = input.type === "limit" ? raw : fillPrice;
    openLong(ledger, {
      venue: input.venue,
      symbol: input.symbol,
      qty,
      price,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      orderType: input.type,
      chain: input.chain,
      address: input.address,
      leverage,
      borrowDailyRate,
      note: input.venue === "gmgn"
        ? "Paper on-chain buy. Priced from GMGN plus a slippage model, not a live swap."
        : leverage > 1
          ? `Paper isolated margin buy at ${leverage}×. Borrow ${(borrowDailyRate * 100).toFixed(5)}% per day on the borrowed USDT.`
          : "Paper spot buy.",
    });
  } else if (position) {
    const price = input.type === "limit" && quote.bid > 0 ? Math.max(input.limitPrice ?? fillPrice, quote.bid) : fillPrice;
    const { fee: feeSell, realizedPnl } = settleSell(ledger, position, price, qty);
    position.qty -= qty;
    if (position.qty <= 1e-12) ledger.account.positions = ledger.account.positions.filter((item) => item.id !== position.id);
    else if ((position.leverage ?? 1) > 1) position.liquidationPrice = liquidationPrice(position.avgPrice, position.leverage ?? 1);
    pushFill(ledger, {
      id: crypto.randomUUID(),
      ts: Date.now(),
      venue: input.venue,
      symbol: input.symbol,
      side: "sell",
      qty,
      price,
      fee: feeSell,
      realizedPnl,
      orderType: input.type,
      route: "paper",
      note: "Paper spot sell.",
    });
    audit(ledger, "info", "fill", `Paper sell ${input.symbol} ${qty} @ ${price.toFixed(6)}. Realized ${realizedPnl.toFixed(2)}.`);
  }
  return {
    ok: true,
    message: "Paper order filled.",
    reasons: [],
    estimatedQty: qty,
    estimatedPrice: fillPrice,
    notional: decision.metrics.orderNotional,
    risk: decision.metrics.tradeRisk,
    riskPct: decision.metrics.tradeRiskPct,
    positionPct: decision.metrics.positionPct,
  };
}

export function cancelPaperOrder(ledger: Ledger, id: string): OrderOutcome {
  const order = ledger.account.openOrders.find((item) => item.id === id);
  if (!order) return { ok: false, message: "Order is not resting.", reasons: ["Not found."] };
  ledger.account.openOrders = ledger.account.openOrders.filter((item) => item.id !== id);
  audit(ledger, "info", "cancel", `Cancelled resting ${order.side} ${order.symbol}.`);
  return { ok: true, message: "Order cancelled.", reasons: [] };
}

/** Same checks as a paper order, without mutating the book. */
export function previewPaperOrder(ledger: Ledger, input: OrderInput, quote: Quote, spec: Spec, borrowDailyRate = DEFAULT_BORROW_DAILY): OrderOutcome {
  const clone = structuredClone(ledger);
  return placePaperOrder(clone, input, quote, spec, borrowDailyRate);
}
