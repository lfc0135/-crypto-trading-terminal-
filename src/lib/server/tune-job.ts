import fs from "node:fs";
import path from "node:path";
import { getCandles, getSpotTickers } from "../brokers/okx";
import { BAR_MS } from "../strategies";
import { updateLedger } from "../store";
import { gridFor, historyBars, walkForward, type ScoredCandidate } from "../tuning/sweep";
import { ensureTrader } from "../trader/step";
import { isEligibleSpot } from "../watchlist/rank";

export interface TuningFile {
  generatedAt: string;
  note: string;
  rows: Array<ScoredCandidate & { symbol: string }>;
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

export async function runTuningJob(): Promise<TuningFile> {
  if (running) throw new Error("A sweep is already running.");
  running = true;
  try {
    const tickers = await getSpotTickers(0);
    const ranked = tickers.filter((row) => isEligibleSpot(row.instId)).sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);
    const symbols = ["BTC-USDT", "ETH-USDT", "SOL-USDT"];
    for (const row of ranked) {
      if (symbols.length >= 5) break;
      if (!symbols.includes(row.instId)) symbols.push(row.instId);
    }
    const rows: TuningFile["rows"] = [];
    for (const symbol of symbols) {
      for (const [strategyId, bars] of Object.entries({
        "ema-momentum": ["1H", "4H"],
        "mean-reversion": ["1H", "15m"],
        "session-breakout": ["15m"],
        "intraday-momentum": ["15m"],
      })) {
        for (const bar of bars) {
          const candles = await getCandles(symbol, bar, historyBars(bar), false);
          if (candles.length < 120) continue;
          const scored = walkForward({
            candles,
            bar,
            barMs: BAR_MS[bar] ?? 60 * 60_000,
            strategyId,
            grid: gridFor(strategyId),
          });
          for (const row of scored) rows.push({ ...row, symbol });
        }
      }
    }
    const selected = rows.filter((row) => row.selected);
    const armed = selected.filter((row) => row.armed);
    const quiet = symbols.filter((symbol) => !selected.some((row) => row.symbol === symbol));
    const result: TuningFile = {
      generatedAt: new Date().toISOString(),
      note: armed.length
        ? `${armed.length} config(s) cleared the out-of-sample gates and are armed for the paper auto-trader. That is not evidence of a 2–3% daily return.`
        : `No config cleared the out-of-sample gates (enough trades, expectancy above $1, positive return, positive Sharpe, drawdown under 25%). ${quiet.length ? `${quiet.join(", ")} produced no training sample of eight trades. ` : ""}Nothing is armed. The 2–3% daily band was not a fitting target.`,
      rows: selected,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(process.cwd(), "TUNING.md"), renderMarkdown(result));
    await updateLedger(async (ledger) => {
      const trader = ensureTrader(ledger);
      trader.assignments = selected.map((row) => ({
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
    "Parameters were chosen on the first 70% of each series. The numbers below are the later 30%, which the search did not see. Fees are 10 bps a side and slippage is 2 bps. Sizing uses 2× isolated margin and the same risk limits as the paper book.",
    "",
    "| Symbol | Strategy | Bar | Filters | Train trades | OOS trades | OOS expectancy | OOS return | OOS max DD | OOS Sharpe | OOS hit rate | Armed | Why |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const sorted = [...result.rows].sort((a, b) => (b.test?.expectancy ?? -1e12) - (a.test?.expectancy ?? -1e12));
  for (const row of sorted) {
    const filters = [row.filters.trend ? "trend" : "", row.filters.volatility ? "vol" : "", row.filters.trail ? "trail" : ""].filter(Boolean).join("+") || "none";
    lines.push(`| ${row.symbol} | ${row.strategyId} | ${row.bar} | ${filters} | ${row.train.trades} | ${row.test?.trades ?? "—"} | ${row.test ? row.test.expectancy.toFixed(2) : "—"} | ${row.test ? pct(row.test.totalReturnPct) : "—"} | ${row.test ? pct(row.test.maxDrawdownPct) : "—"} | ${row.test ? row.test.sharpe.toFixed(2) : "—"} | ${row.test ? pct(row.test.hitRate) : "—"} | ${row.armed ? "yes" : "no"} | ${row.rejectReason ?? "passed"} |`);
  }
  lines.push("", "A day hits the target only when mark-to-market P&L divided by starting principal lands inside 2–3%. Flat days count as misses. Nothing here is a promise of that band.");
  return lines.join("\n");
}
