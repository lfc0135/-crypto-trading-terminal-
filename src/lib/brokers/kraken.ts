import { PAPER_MAKER_FEE_BPS, PAPER_TAKER_FEE_BPS } from "../defaults";
import { dubaiDayKey } from "../time";
import type { Candle, Ledger } from "../types";

/** Published Kraken Futures base schedule. The public ticker does not include the account tier. */
export const KRAKEN_FUTURES_MAKER_BPS = 2;
export const KRAKEN_FUTURES_TAKER_BPS = 5;

export const KRAKEN_MAJORS = [
  { symbol: "BTC-USDT", kraken: "PF_XBTUSD", base: "BTC" },
  { symbol: "ETH-USDT", kraken: "PF_ETHUSD", base: "ETH" },
  { symbol: "SOL-USDT", kraken: "PF_SOLUSD", base: "SOL" },
] as const;

const BAR_RESOLUTION: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};

export function paperExchange(): "okx" | "kraken" | "both" {
  const raw = (process.env.PAPER_EXCHANGE ?? "okx").trim().toLowerCase();
  if (raw === "kraken" || raw === "both") return raw;
  return "okx";
}

export function krakenSymbol(symbol: string): string | null {
  return KRAKEN_MAJORS.find((row) => row.symbol === symbol.toUpperCase())?.kraken ?? null;
}

export function isKrakenMajor(symbol: string): boolean {
  return krakenSymbol(symbol) != null;
}

export function divergenceBps(okx: number, kraken: number): number | null {
  if (!(okx > 0) || !(kraken > 0)) return null;
  return ((kraken - okx) / okx) * 10_000;
}

interface FuturesTicker {
  symbol?: string;
  last?: number;
  markPrice?: number;
  bid?: number;
  ask?: number;
  relativeFundingRate?: number;
  suspended?: boolean;
}

let tickerCache: { at: number; rows: FuturesTicker[] } | null = null;

async function futuresTickers(): Promise<FuturesTicker[]> {
  if (tickerCache && Date.now() - tickerCache.at < 15_000) return tickerCache.rows;
  const res = await fetch("https://futures.kraken.com/derivatives/api/v3/tickers", { cache: "no-store" });
  if (!res.ok) throw new Error(`Kraken futures tickers failed (${res.status}).`);
  const json = await res.json() as { tickers?: FuturesTicker[] };
  const rows = json.tickers ?? [];
  tickerCache = { at: Date.now(), rows };
  return rows;
}

export interface KrakenQuote {
  symbol: string;
  krakenSymbol: string;
  bid: number;
  ask: number;
  last: number;
  mark: number;
  /** Relative funding for the next hour, scaled to a daily simple rate. */
  fundingDaily: number;
}

export async function getKrakenQuote(symbol: string): Promise<KrakenQuote> {
  const mapped = krakenSymbol(symbol);
  if (!mapped) throw new Error(`${symbol} is not a Kraken major. Paper futures here are BTC, ETH, and SOL.`);
  const row = (await futuresTickers()).find((item) => item.symbol === mapped);
  if (!row || row.suspended || !(Number(row.markPrice) > 0)) throw new Error(`No public Kraken futures quote for ${mapped}.`);
  const mark = Number(row.markPrice);
  const bid = Number(row.bid) > 0 ? Number(row.bid) : mark;
  const ask = Number(row.ask) > 0 ? Number(row.ask) : mark;
  const hourly = Number(row.relativeFundingRate);
  return {
    symbol: symbol.toUpperCase(),
    krakenSymbol: mapped,
    bid,
    ask,
    last: Number(row.last) > 0 ? Number(row.last) : mark,
    mark,
    fundingDaily: Number.isFinite(hourly) ? hourly * 24 : 0,
  };
}

export async function getKrakenCandles(symbol: string, bar: string, limit = 400): Promise<Candle[]> {
  const mapped = krakenSymbol(symbol);
  const resolution = BAR_RESOLUTION[bar];
  if (!mapped || !resolution) throw new Error(`No Kraken candles for ${symbol} ${bar}.`);
  const res = await fetch(`https://futures.kraken.com/api/charts/v1/trade/${mapped}/${resolution}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Kraken candles failed (${res.status}).`);
  const json = await res.json() as { candles?: { time: number; open: string; high: string; low: string; close: string; volume: string }[] };
  const candles = (json.candles ?? []).map((row) => ({
    time: row.time,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  })).filter((row) => row.close > 0);
  candles.sort((a, b) => a.time - b.time);
  return candles.slice(-limit);
}

export interface MajorDivergence {
  symbol: string;
  okx: number | null;
  kraken: number | null;
  diffBps: number | null;
  fundingDaily: number | null;
}

export async function compareMajors(okxLast: Record<string, number>): Promise<MajorDivergence[]> {
  let rows: FuturesTicker[] = [];
  try {
    rows = await futuresTickers();
  } catch {
    rows = [];
  }
  return KRAKEN_MAJORS.map((major) => {
    const ticker = rows.find((row) => row.symbol === major.kraken);
    const kraken = ticker && Number(ticker.markPrice) > 0 ? Number(ticker.markPrice) : null;
    const okx = okxLast[major.symbol] > 0 ? okxLast[major.symbol] : null;
    const hourly = ticker ? Number(ticker.relativeFundingRate) : NaN;
    return {
      symbol: major.symbol,
      okx,
      kraken,
      diffBps: okx != null && kraken != null ? divergenceBps(okx, kraken) : null,
      fundingDaily: Number.isFinite(hourly) ? hourly * 24 : null,
    };
  });
}

export function krakenPaperScore(ledger: Ledger, marks: Record<string, number>, now = Date.now()) {
  const day = dubaiDayKey(new Date(now));
  const fills = ledger.account.fills.filter((fill) => fill.venue === "kraken" && dubaiDayKey(new Date(fill.ts)) === day);
  const positions = ledger.account.positions.filter((position) => position.venue === "kraken");
  const realizedPnl = fills.reduce((sum, fill) => sum + fill.realizedPnl, 0);
  const mtmPnl = positions.reduce((sum, position) => {
    const mark = marks[position.symbol] ?? position.avgPrice;
    return sum + (mark - position.avgPrice) * position.qty;
  }, 0);
  return {
    realizedPnl,
    mtmPnl,
    trades: fills.length,
    openPositions: positions.length,
    fees: {
      krakenMakerBps: KRAKEN_FUTURES_MAKER_BPS,
      krakenTakerBps: KRAKEN_FUTURES_TAKER_BPS,
      okxMakerBps: PAPER_MAKER_FEE_BPS,
      okxTakerBps: PAPER_TAKER_FEE_BPS,
    },
  };
}
