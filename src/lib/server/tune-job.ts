import fs from "node:fs";
import path from "node:path";
import { getCandlesSince } from "../brokers/okx";
import { BAR_MS } from "../strategies";
import { updateLedger } from "../store";
import { runCrossSection } from "../tuning/cross-section";
import { buildRegime, regimeAllows } from "../tuning/regime";
import type { StrategyInstance } from "../backtest/engine";
import { walkForward, type ScoredCandidate } from "../tuning/sweep";
import { ensureTrader } from "../trader/step";
import type { Candle } from "../types";

const START = Date.parse("2021-01-01T00:00:00Z");
const YEAR_2022 = Date.parse("2022-01-01T00:00:00Z");
const YEAR_2023 = Date.parse("2023-01-01T00:00:00Z");
const UNIVERSE = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "ADA-USDT", "AVAX-USDT", "LINK-USDT", "DOT-USDT", "BNB-USDT"];
const TREND_GRID = [20, 55].flatMap((lookback) => [2, 3].map((atrMult) => ({
  params: { lookback, atrPeriod: 14, atrMult, rewardRisk: 3 },
  filters: { trend: false, volatility: false, trail: false } as const,
})));

export interface TuningFile {
  generatedAt: string;
  note: string;
  rows: Array<ScoredCandidate & { symbol: string; holdout2022Return: number | null; holdout2022Trades: number | null }>;
}

const file = path.join(process.cwd(), "tuning", "results.json");
let running = false;

export function readTuning(): TuningFile | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as TuningFile;
}

export function tuningStatus(): { running: boolean; result: TuningFile | null } {
  return { running, result: readTuning() };
}

async function loadSince(instId: string, bar: string): Promise<Candle[]> {
  const cache = path.join(process.cwd(), "data", "candles", `${instId}-${bar}.json`);
  if (fs.existsSync(cache)) {
    const cached = JSON.parse(fs.readFileSync(cache, "utf8")) as Candle[];
    if (cached.length > 200 && cached[0].time <= START + 40 * 24 * 60 * 60 * 1000) return cached.filter((barRow) => barRow.time >= START);
  }
  const candles = await getCandlesSince(instId, bar, START);
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(candles));
  return candles;
}

export async function runTuningJob(): Promise<TuningFile> {
  if (running) throw new Error("A sweep is already running.");
  running = true;
  try {
    const daily: Record<string, Candle[]> = {};
    for (const symbol of UNIVERSE) {
      try {
        const candles = await loadSince(symbol, "1D");
        if (candles.length > 400) daily[symbol] = candles;
      } catch {
        /* skip symbols OKX does not serve back to 2021 */
      }
    }
    const btc = daily["BTC-USDT"];
    if (!btc) throw new Error("BTC-USDT daily history is required for the regime filter.");
    const regime = buildRegime(btc);
    const gateRegime = (strategy: StrategyInstance): StrategyInstance => ({
      ...strategy,
      onBar(ctx) {
        const raw = strategy.onBar(ctx);
        const time = ctx.history[ctx.history.length - 1]?.time ?? 0;
        if (raw.action === "buy" && !regimeAllows(regime, time)) return { action: "hold", reason: "regime flat" };
        return raw;
      },
    });
    const rows: TuningFile["rows"] = [];
    const trendSymbols = Object.keys(daily);
    for (const symbol of trendSymbols) {
      for (const bar of symbol === "BTC-USDT" || symbol === "ETH-USDT" || symbol === "SOL-USDT" ? ["1D", "4H"] : ["1D"]) {
        const candles = bar === "1D" ? daily[symbol] : await loadSince(symbol, bar);
        if (candles.length < 400) continue;
        const scored = walkForward({
          candles,
          bar,
          barMs: BAR_MS[bar] ?? 24 * 60 * 60_000,
          strategyId: "ts-trend",
          grid: TREND_GRID.map((point) => ({ ...point })),
          split: Math.max(0.4, candles.filter((item) => item.time < YEAR_2023).length / candles.length),
          entryStyle: "maker",
          minTrainTrades: 8,
          minTestTrades: 5,
          wrap: gateRegime,
        });
        const chosen = scored.find((row) => row.selected)
          ?? scored.reduce((a, b) => (a.train.expectancy >= b.train.expectancy ? a : b));
        if (!chosen) continue;
        chosen.selected = true;
        const bear = walkForward({
          candles: candles.filter((item) => item.time < YEAR_2023),
          bar,
          barMs: BAR_MS[bar] ?? 24 * 60 * 60_000,
          strategyId: "ts-trend",
          grid: [{ params: chosen.params, filters: chosen.filters }],
          split: Math.max(0.3, candles.filter((item) => item.time < YEAR_2022).length / Math.max(1, candles.filter((item) => item.time < YEAR_2023).length)),
          entryStyle: "maker",
          minTrainTrades: 1,
          minTestTrades: 1,
          wrap: gateRegime,
        });
        const holdoutRow = bear.find((row) => row.selected);
        const holdout = holdoutRow?.test?.totalReturnPct ?? null;
        const holdoutTrades = holdoutRow?.test?.trades ?? 0;
        if (chosen.armed && !(chosen.train.expectancy > 0 && chosen.train.totalReturnPct > 0)) {
          chosen.armed = false;
          chosen.rejectReason = "training expectancy was not positive";
        } else if (chosen.armed && holdoutTrades < 1) {
          chosen.armed = false;
          chosen.rejectReason = "2022 holdout did not trade; BTC was under its 200-day average, so the bear year was not a test";
        } else if (chosen.armed && (holdout == null || holdout < -0.15)) {
          chosen.armed = false;
          chosen.rejectReason = "2022 holdout lost more than 15%";
        }
        rows.push({ ...chosen, symbol, holdout2022Return: holdout, holdout2022Trades: holdoutRow ? holdoutTrades : null });
      }
    }
    const xsFull = runCrossSection({ series: daily, regime, lookback: 60 });
    const xsBear = runCrossSection({ series: daily, regime, lookback: 60, tradeFrom: YEAR_2022, tradeUntil: YEAR_2023 });
    const xsLate = runCrossSection({ series: daily, regime, lookback: 60, tradeFrom: YEAR_2023 });
    const btc2023 = btc.find((barRow) => barRow.time >= YEAR_2023);
    const btcHold = btc2023 ? btc[btc.length - 1].close / btc2023.close - 1 : 0;
    const regimeOn2022 = regime.filter((point) => point.time >= YEAR_2022 && point.time < YEAR_2023 && point.allow).length;
    rows.push({
      symbol: "top-10",
      strategyId: "cross-section",
      bar: "1D",
      params: { lookback: 60, hold: 3 },
      filters: { trend: true, volatility: true, trail: false },
      train: { trades: 0, expectancy: 0, totalReturnPct: 0, maxDrawdownPct: 0, sharpe: 0, hitRate: 0, days: 0, endingEquity: 0 },
      test: {
        trades: xsLate.trades,
        expectancy: xsLate.expectancy,
        totalReturnPct: xsLate.totalReturnPct,
        maxDrawdownPct: xsLate.maxDrawdownPct,
        sharpe: 0,
        hitRate: 0,
        days: 0,
        endingEquity: xsLate.endingEquity,
      },
      fragile: false,
      rejectReason: `2022 had ${xsBear.trades} trades (${regimeOn2022} regime-on days). 2023+ book ${(xsLate.totalReturnPct * 100).toFixed(1)}% versus BTC buy-and-hold ${(btcHold * 100).toFixed(0)}%. Not an edge, and the paper loop cannot rebalance a basket.`,
      selected: true,
      armed: false,
      holdout2022Return: xsBear.totalReturnPct,
      holdout2022Trades: xsBear.trades,
    });
    const selected = rows.filter((row) => row.selected);
    const armed = selected.filter((row) => row.armed);
    const result: TuningFile = {
      generatedAt: new Date().toISOString(),
      note: armed.length
        ? `${armed.length} config(s) cleared training, the 2023+ window, and a 2022 holdout that actually traded. Armed for paper only. This is not a 2–3% daily edge. BTC buy-and-hold from the first 2023 close was ${(btcHold * 100).toFixed(0)}%.`
        : `Nothing is armed. BTC closed above its 200-day average on ${regimeOn2022} days in 2022, so the regime filter kept every long flat. A 0% holdout with no trades is not a bear-market test and is not a pass. From the first 2023 daily close, buy-and-hold BTC returned ${(btcHold * 100).toFixed(0)}%. The weekly momentum book returned ${(xsLate.totalReturnPct * 100).toFixed(1)}% over that window (${(xsFull.totalReturnPct * 100).toFixed(1)}% full sample, not used for selection) and did not beat holding BTC. Single-name trend results are in the table; none is an edge, and none hit the 2–3% day. The paper auto-trader will log signals and will not send orders. GMGN stays watch-only.`,
      rows: selected,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(process.cwd(), "TUNING.md"), renderMarkdown(result));
    await updateLedger(async (ledger) => {
      const trader = ensureTrader(ledger);
      trader.assignments = selected.filter((row) => row.strategyId !== "cross-section").map((row) => ({
        symbol: row.symbol,
        strategyId: row.strategyId,
        bar: row.bar,
        params: row.params,
        filters: row.filters,
        armed: row.armed,
        note: row.rejectReason ?? "out-of-sample pass",
      }));
      ledger.account.audits.unshift({
        id: crypto.randomUUID(),
        ts: Date.now(),
        level: "info",
        kind: "trader",
        message: `Sweep saved ${selected.length} train-selected configs, ${armed.length} armed for paper trading.`,
      });
    });
    return result;
  } finally {
    running = false;
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function renderMarkdown(result: TuningFile): string {
  const lines = [
    "# Walk-forward tuning",
    "",
    `Generated ${result.generatedAt}.`,
    "",
    result.note,
    "",
    "Train is 2021 through 2022. Out of sample is 2023 through the latest bar. A separate 2022 holdout trains on 2021 only. Entries are maker limits at 8 bps. Stops pay the 10 bp taker fee plus 2 bps. A trade is skipped unless the planned move is at least 3× that round trip. Longs are off unless BTC is above its 200-day average and 14-day ATR is at most 6% of price. Time-series tests use 4H and 1D on BTC, ETH, and SOL, and 1D on the rest. The momentum book is the strongest 3 of a fixed 10-name list, rebalanced every 7 daily bars. BNB-USDT on OKX starts 2022-12-20; the other nine start 2021-01-01. That list is not today's volume ranking. GMGN was not tested and stays watch-only. Cross-section Sharpe and daily hit rate are not computed and are left blank.",
    "",
    "| Symbol | Strategy | Bar | OOS trades | OOS return | OOS max DD | OOS Sharpe | OOS hit rate | 2022 holdout | Armed | Why |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const sorted = [...result.rows].sort((a, b) => (b.test?.expectancy ?? -1e12) - (a.test?.expectancy ?? -1e12));
  for (const row of sorted) {
    const holdoutCell = row.holdout2022Trades == null ? "—" : row.holdout2022Trades === 0 ? "no trades" : pct(row.holdout2022Return ?? 0);
    const test = row.strategyId === "cross-section" ? null : row.test;
    lines.push(`| ${row.symbol} | ${row.strategyId} | ${row.bar} | ${row.test?.trades ?? "—"} | ${row.test ? pct(row.test.totalReturnPct) : "—"} | ${row.test ? pct(row.test.maxDrawdownPct) : "—"} | ${test ? test.sharpe.toFixed(2) : "—"} | ${test ? pct(test.hitRate) : "—"} | ${holdoutCell} | ${row.armed ? "yes" : "no"} | ${row.rejectReason ?? "passed"} |`);
  }
  lines.push("", "A day hits the target only when mark-to-market P&L divided by starting principal lands inside 2–3%. Flat days count as misses. Nothing here is a promise of that band.");
  return lines.join("\n");
}
