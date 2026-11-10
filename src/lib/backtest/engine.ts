import { PAPER_SLIPPAGE_BPS, PAPER_TAKER_FEE_BPS } from "../defaults";
import { DEFAULT_BORROW_DAILY, HARD_MAX_LEVERAGE, borrowCost, liquidationPrice, marginAndBorrow } from "../trading/margin";
import { dubaiDayKey } from "../time";
import { evaluateOrder } from "../risk/engine";
import { classifyDailyTarget, maxDrawdown, monthlyReturns, sharpeRatio, type DailyTargetReport, type MonthRow } from "../targets";
import { applyBuy, applySell } from "../trading/accounting";
import { sizeLongSpot } from "../trading/sizing";
import type { Candle, RiskLimits } from "../types";

export interface OpenLot {
  qty: number;
  avgPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface BarContext {
  history: Candle[];
  bar: Candle;
  index: number;
  barDurationMs: number;
  position: OpenLot | null;
  equity: number;
  cash: number;
  initialEquity: number;
}

export interface Signal {
  action: "hold" | "buy" | "close";
  stopLoss?: number;
  takeProfit?: number;
  qty?: number;
  /** Entries always fill on the next bar's open. Session flats may fill this close. */
  fill?: "next-open" | "this-close";
  reason?: string;
}

export interface StrategyInstance {
  onBar: (ctx: BarContext) => Signal;
}

export interface BacktestConfig {
  initialEquity: number;
  principal: number;
  feeBps: number;
  slippageBps: number;
  limits: RiskLimits;
  barDurationMs: number;
  minSz: number;
  lotSz: number;
  /** Frozen daily simple rate on borrowed USDT. */
  borrowDailyRate: number;
  targets: { dailyLow: number; dailyHigh: number };
}

export interface ClosedTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  reason: string;
}

export interface BacktestResult {
  candles: number;
  start: number | null;
  end: number | null;
  endingEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  sharpeNote: string;
  winRate: number;
  closedTrades: number;
  winners: number;
  losers: number;
  profitFactor: number | null;
  feesPaid: number;
  borrowPaid: number;
  liquidations: number;
  leverage: number;
  rejectedEntries: number;
  monthlyReturns: MonthRow[];
  daily: DailyTargetReport;
  equityCurve: { time: number; equity: number }[];
  trades: ClosedTrade[];
  assumptions: string[];
}

interface Pending {
  kind: "buy" | "close";
  qty: number;
  stopLoss: number | null;
  takeProfit: number | null;
  reason: string;
}

const DEFAULTS: BacktestConfig = {
  initialEquity: 50_000,
  principal: 50_000,
  feeBps: PAPER_TAKER_FEE_BPS,
  slippageBps: PAPER_SLIPPAGE_BPS,
  limits: {
    maxPositionPct: 0.1,
    maxDailyLossPct: 0.015,
    maxDrawdownPct: 0.08,
    perTradeRiskPct: 0.004,
    maxLeverage: HARD_MAX_LEVERAGE,
  },
  barDurationMs: 60 * 60 * 1000,
  minSz: 0,
  lotSz: 0,
  borrowDailyRate: DEFAULT_BORROW_DAILY,
  targets: { dailyLow: 0.02, dailyHigh: 0.03 },
};

function slip(price: number, side: "buy" | "sell", bps: number): number {
  const m = bps / 10_000;
  return side === "buy" ? price * (1 + m) : price * (1 - m);
}

function feeOf(notional: number, bps: number): number {
  return notional * (bps / 10_000);
}

export function runBacktest(candles: Candle[], strategy: StrategyInstance, config: Partial<BacktestConfig> = {}): BacktestResult {
  const cfg: BacktestConfig = {
    ...DEFAULTS,
    ...config,
    limits: { ...DEFAULTS.limits, ...config.limits, maxLeverage: Math.min(HARD_MAX_LEVERAGE, config.limits?.maxLeverage ?? DEFAULTS.limits.maxLeverage) },
    targets: { ...DEFAULTS.targets, ...config.targets },
  };
  const leverage = Math.min(HARD_MAX_LEVERAGE, Math.max(1, cfg.limits.maxLeverage));
  let cash = cfg.initialEquity;
  let qty = 0;
  let avg = 0;
  let stop: number | null = null;
  let take: number | null = null;
  let borrowed = 0;
  let liq: number | null = null;
  let entryTime = 0;
  let entryPrice = 0;
  let borrowPaid = 0;
  let liquidations = 0;
  let pending: Pending | null = null;
  let feesPaid = 0;
  let rejectedEntries = 0;
  let peak = cfg.initialEquity;
  let dayStart = cfg.initialEquity;
  let dayKey = "";
  const trades: ClosedTrade[] = [];
  const curve: { time: number; equity: number }[] = [];

  const position = (): OpenLot | null => (qty > 0 ? { qty, avgPrice: avg, stopLoss: stop, takeProfit: take } : null);

  const equityAt = (mark: number) => (qty > 0 && borrowed > 0 ? cash + qty * mark - borrowed : cash + qty * mark);

  const closeAt = (raw: number, time: number, reason: string) => {
    const fill = slip(raw, "sell", cfg.slippageBps);
    const fee = feeOf(fill * qty, cfg.feeBps);
    let pnl: number;
    if (borrowed > 0) {
      const proceeds = fill * qty - fee;
      cash += proceeds - borrowed;
      pnl = (fill - avg) * qty - fee;
    } else {
      const sold = applySell({ cash, qty, avgPrice: avg }, fill, qty, fee);
      cash = sold.cash;
      pnl = sold.realizedPnl;
    }
    feesPaid += fee;
    if (reason.startsWith("liquidat")) liquidations += 1;
    trades.push({
      entryTime,
      exitTime: time,
      entryPrice,
      exitPrice: fill,
      qty,
      pnl,
      reason,
    });
    qty = 0;
    avg = 0;
    borrowed = 0;
    liq = null;
    stop = null;
    take = null;
  };

  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i];
    const key = dubaiDayKey(new Date(bar.time));
    if (key !== dayKey) {
      dayKey = key;
      dayStart = equityAt(bar.open);
    }

    if (pending?.kind === "buy" && qty === 0) {
      const fill = slip(bar.open, "buy", cfg.slippageBps);
      const decision = evaluateOrder({
        equity: cash,
        peakEquity: peak,
        dayStartEquity: dayStart,
        limits: cfg.limits,
        dailyKillLatched: false,
        drawdownKillLatched: false,
        order: {
          side: "buy",
          qty: pending.qty,
          price: fill,
          leverage,
          stopLoss: pending.stopLoss,
          currentQty: 0,
          feeBps: cfg.feeBps,
        },
      });
      const fee = feeOf(fill * pending.qty, cfg.feeBps);
      const parts = marginAndBorrow(fill * pending.qty, leverage);
      if (!decision.allowed || parts.margin + fee > cash) {
        rejectedEntries += 1;
      } else if (leverage > 1) {
        cash -= parts.margin + fee;
        qty = pending.qty;
        avg = fill + fee / pending.qty;
        borrowed = parts.borrowed;
        liq = liquidationPrice(fill, leverage);
        stop = pending.stopLoss;
        take = pending.takeProfit;
        entryTime = bar.time;
        entryPrice = fill;
        feesPaid += fee;
      } else {
        const bought = applyBuy({ cash, qty, avgPrice: avg }, fill, pending.qty, fee);
        cash = bought.cash;
        qty = bought.qty;
        avg = bought.avgPrice;
        borrowed = 0;
        liq = null;
        stop = pending.stopLoss;
        take = pending.takeProfit;
        entryTime = bar.time;
        entryPrice = fill;
        feesPaid += fee;
      }
      pending = null;
    } else if (pending?.kind === "close" && qty > 0) {
      closeAt(bar.open, bar.time, pending.reason);
      pending = null;
    }

    if (qty > 0 && liq != null && bar.open <= liq) {
      closeAt(bar.open, bar.time, "liquidated on a gap through the liquidation price");
    } else if (qty > 0 && stop != null && take != null && bar.low <= stop && bar.high >= take) {
      const raw = bar.open <= stop ? bar.open : stop;
      closeAt(raw, bar.time, "stop (stop and target both traded; stop is assumed first)");
    } else if (qty > 0 && stop != null && bar.low <= stop) {
      const raw = bar.open <= stop ? bar.open : stop;
      closeAt(raw, bar.time, bar.open <= stop ? "stop gapped through the open" : "stop");
    } else if (qty > 0 && take != null && bar.high >= take) {
      const raw = bar.open >= take ? bar.open : take;
      closeAt(raw, bar.time, "take-profit");
    } else if (qty > 0 && liq != null && bar.low <= liq) {
      closeAt(liq, bar.time, "liquidated");
    }

    const equityNow = equityAt(bar.close);
    if (equityNow > peak) peak = equityNow;
    const history = candles.slice(0, i + 1);
    const signal = strategy.onBar({
      history,
      bar,
      index: i,
      barDurationMs: cfg.barDurationMs,
      position: position(),
      equity: equityNow,
      cash,
      initialEquity: cfg.initialEquity,
    });

    if (signal.action === "close" && qty > 0 && !pending) {
      if (signal.fill === "this-close") closeAt(bar.close, bar.time, signal.reason ?? "session flat");
      else pending = { kind: "close", qty, stopLoss: null, takeProfit: null, reason: signal.reason ?? "exit" };
    } else if (signal.action === "buy" && qty === 0 && !pending) {
      const stopLoss = signal.stopLoss ?? null;
      let orderQty = signal.qty;
      if (orderQty == null) {
        if (stopLoss == null) {
          rejectedEntries += 1;
        } else {
          const sized = sizeLongSpot({
            equity: equityNow,
            price: bar.close,
            stop: stopLoss,
            limits: cfg.limits,
            minSz: cfg.minSz,
            lotSz: cfg.lotSz,
            feeBps: cfg.feeBps,
            currentQty: 0,
            peakEquity: peak,
            dayStartEquity: dayStart,
            dailyKillLatched: false,
            drawdownKillLatched: false,
          });
          if (!sized.ok) rejectedEntries += 1;
          else orderQty = sized.qty;
        }
      }
      if (orderQty != null && orderQty > 0 && qty === 0 && !pending) {
        const decision = evaluateOrder({
          equity: equityNow,
          peakEquity: peak,
          dayStartEquity: dayStart,
          limits: cfg.limits,
          dailyKillLatched: false,
          drawdownKillLatched: false,
          order: {
            side: "buy",
            qty: orderQty,
            price: bar.close,
            leverage,
            stopLoss,
            currentQty: 0,
            feeBps: cfg.feeBps,
          },
        });
        if (!decision.allowed) rejectedEntries += 1;
        else {
          pending = {
            kind: "buy",
            qty: orderQty,
            stopLoss,
            takeProfit: signal.takeProfit ?? null,
            reason: signal.reason ?? "entry",
          };
        }
      }
    }

    if (qty > 0 && borrowed > 0) {
      const cost = borrowCost(borrowed, cfg.borrowDailyRate, cfg.barDurationMs);
      cash -= cost;
      borrowPaid += cost;
    }
    const marked = equityAt(bar.close);
    if (marked > peak) peak = marked;
    curve.push({ time: bar.time, equity: marked });
  }

  const endingEquity = curve.length ? curve[curve.length - 1].equity : cfg.initialEquity;
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl < 0);
  const grossWin = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const barsPerYear = cfg.barDurationMs > 0 ? (365 * 24 * 60 * 60 * 1000) / cfg.barDurationMs : 0;
  const daily = classifyDailyTarget(curve, cfg.initialEquity, cfg.principal, { low: cfg.targets.dailyLow, high: cfg.targets.dailyHigh });
  const sharpe = sharpeRatio(curve.map((p) => p.equity), barsPerYear);
  return {
    candles: candles.length,
    start: candles[0]?.time ?? null,
    end: candles[candles.length - 1]?.time ?? null,
    endingEquity,
    totalReturnPct: cfg.initialEquity > 0 ? endingEquity / cfg.initialEquity - 1 : 0,
    maxDrawdownPct: maxDrawdown(curve.map((p) => p.equity)),
    sharpe,
    sharpeNote: daily.days < 30
      ? "Sharpe uses bar-close returns, a 0% risk-free rate, and the bar length to annualize. Fewer than 30 Dubai days makes it unstable."
      : "Sharpe uses bar-close returns and a 0% risk-free rate, annualized from the bar length.",
    winRate: trades.length ? winners.length / trades.length : 0,
    closedTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    feesPaid,
    borrowPaid,
    liquidations,
    leverage,
    rejectedEntries,
    monthlyReturns: monthlyReturns(curve, cfg.initialEquity, cfg.principal),
    daily,
    equityCurve: curve,
    trades,
    assumptions: [
      "Signals are computed on a closed bar and filled on the next bar's open. The signal bar is not the fill bar.",
      "Session flats fill at that bar's close, which is already printed when the signal is known.",
      "If a bar trades through both the stop and the target, the stop is filled and the target is ignored.",
      "A gap through the stop fills at the open, not at the stop.",
      `Fees are ${cfg.feeBps} bps per side and slippage is ${cfg.slippageBps} bps. Stops are not free.`,
      "Size comes from the per-trade risk budget and the stop, then the margin cap times leverage. The backtest uses the same risk engine as paper orders.",
      `Isolated margin at ${leverage}×. Notional cap is ${(cfg.limits.maxPositionPct * leverage * 100).toFixed(0)}% of equity. Borrow is charged at a frozen ${(cfg.borrowDailyRate * 100).toFixed(5)}% per day on the borrowed USDT (OKX basic USDT rate, not stacked with perp funding). A long is liquidated if price trades through the isolated liquidation price before the stop. Shorts are not opened.`,
      `A day "hits" the target only when that day's mark-to-market P&L divided by the starting principal sits inside ${(cfg.targets.dailyLow * 100).toFixed(2)}–${(cfg.targets.dailyHigh * 100).toFixed(2)}%. Days above the band are exceeded, not hits. Flat days are misses.`,
      "The partial last OKX candle is dropped before this run. No parameter search is applied.",
    ],
  };
}
