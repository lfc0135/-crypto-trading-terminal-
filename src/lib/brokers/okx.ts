import { okxSign } from "./sign";
import { okxKeysPresent, readConfig } from "../config";
import type { Candle, InstrumentSpec, OkxTicker } from "../types";

interface OkxEnvelope<T> {
  code: string;
  msg: string;
  data: T;
}

async function okxGet<T>(path: string): Promise<T> {
  const cfg = readConfig();
  const res = await fetch(`${cfg.okx.baseUrl}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`OKX public request failed (${res.status}).`);
  const json = (await res.json()) as OkxEnvelope<T>;
  if (json.code !== "0") throw new Error(json.msg || `OKX error ${json.code}`);
  return json.data;
}

export function parseOkxTicker(row: Record<string, string>): OkxTicker | null {
  const last = Number(row.last);
  if (!row.instId || !(last > 0)) return null;
  return {
    instId: row.instId,
    last,
    open24h: Number(row.open24h),
    bid: Number(row.bidPx),
    ask: Number(row.askPx),
    high24h: Number(row.high24h),
    low24h: Number(row.low24h),
    quoteVolume24h: Number(row.volCcy24h),
    baseVolume24h: Number(row.vol24h),
    ts: Number(row.ts),
  };
}

let tickerCache: { at: number; rows: OkxTicker[] } | null = null;

export async function getSpotTickers(maxAgeMs = 15_000): Promise<OkxTicker[]> {
  if (tickerCache && Date.now() - tickerCache.at < maxAgeMs) return tickerCache.rows;
  const data = await okxGet<Record<string, string>[]>("/api/v5/market/tickers?instType=SPOT");
  const rows = data.map(parseOkxTicker).filter((row): row is OkxTicker => row != null);
  tickerCache = { at: Date.now(), rows };
  return rows;
}

export async function getInstrument(instId: string): Promise<InstrumentSpec> {
  const data = await okxGet<Record<string, string>[]>(`/api/v5/public/instruments?instType=SPOT&instId=${encodeURIComponent(instId)}`);
  const row = data[0];
  if (!row) throw new Error(`OKX has no spot instrument ${instId}.`);
  return {
    instId: row.instId,
    base: row.baseCcy,
    quote: row.quoteCcy,
    minSz: Number(row.minSz),
    lotSz: Number(row.lotSz),
    tickSz: Number(row.tickSz),
    state: row.state,
  };
}

export async function getCandles(instId: string, bar: string, limit: number, includePartial: boolean): Promise<Candle[]> {
  const rows: string[][] = [];
  let after: string | undefined;
  while (rows.length < limit) {
    const batch = Math.min(100, limit - rows.length);
    const query = new URLSearchParams({ instId, bar, limit: String(batch) });
    if (after) query.set("after", after);
    const path = rows.length === 0 ? `/api/v5/market/candles?${query}` : `/api/v5/market/history-candles?${query}`;
    const data = await okxGet<string[][]>(path);
    if (!data.length) break;
    rows.push(...data);
    const oldest = data[data.length - 1]?.[0];
    if (!oldest || oldest === after) break;
    after = oldest;
    if (data.length < batch) break;
  }
  const candles: Candle[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const time = Number(row[0]);
    if (seen.has(time)) continue;
    if (!includePartial && row[8] === "0") continue;
    seen.add(time);
    candles.push({
      time,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    });
  }
  candles.sort((a, b) => a.time - b.time);
  return candles.slice(-limit);
}

export interface BookLevel {
  price: number;
  size: number;
}

export async function getOrderBook(instId: string, depth = 15): Promise<{ bids: BookLevel[]; asks: BookLevel[]; ts: number }> {
  const data = await okxGet<Array<{ bids: string[][]; asks: string[][]; ts: string }>>(
    `/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=${depth}`,
  );
  const book = data[0];
  const map = (levels: string[][]) => levels.map((level) => ({ price: Number(level[0]), size: Number(level[1]) }));
  return {
    bids: map(book?.bids ?? []).sort((a, b) => b.price - a.price),
    asks: map(book?.asks ?? []).sort((a, b) => a.price - b.price),
    ts: Number(book?.ts ?? Date.now()),
  };
}

export async function okxPlaceSpotOrder(input: {
  instId: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  limitPrice?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): Promise<{ order: unknown; protectionError: string | null }> {
  const orderBody: Record<string, string> = {
    instId: input.instId,
    tdMode: "cash",
    side: input.side,
    ordType: input.type,
    sz: String(input.qty),
    tgtCcy: "base_ccy",
  };
  if (input.type === "limit") {
    if (!(input.limitPrice && input.limitPrice > 0)) throw new Error("Limit price is required.");
    orderBody.px = String(input.limitPrice);
  }
  const order = await okxPrivate("POST", "/api/v5/trade/order", orderBody);
  let protectionError: string | null = null;
  if (input.stopLoss || input.takeProfit) {
    const algo: Record<string, string> = {
      instId: input.instId,
      tdMode: "cash",
      side: input.side === "buy" ? "sell" : "buy",
      sz: String(input.qty),
    };
    if (input.stopLoss && input.takeProfit) {
      algo.ordType = "oco";
      algo.slTriggerPx = String(input.stopLoss);
      algo.slOrdPx = "-1";
      algo.tpTriggerPx = String(input.takeProfit);
      algo.tpOrdPx = "-1";
    } else if (input.stopLoss) {
      algo.ordType = "conditional";
      algo.slTriggerPx = String(input.stopLoss);
      algo.slOrdPx = "-1";
    } else if (input.takeProfit) {
      algo.ordType = "conditional";
      algo.tpTriggerPx = String(input.takeProfit);
      algo.tpOrdPx = "-1";
    }
    try {
      await okxPrivate("POST", "/api/v5/trade/order-algo", algo);
    } catch (error) {
      protectionError = error instanceof Error ? error.message : "OKX rejected the stop or target.";
    }
  }
  return { order, protectionError };
}

async function okxPrivate(method: string, path: string, body: unknown): Promise<unknown> {
  const cfg = readConfig();
  if (!okxKeysPresent(cfg)) throw new Error("OKX API key, secret, and passphrase are required.");
  const payload = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": cfg.okx.apiKey,
    "OK-ACCESS-SIGN": okxSign(cfg.okx.secret, timestamp, method, path, payload),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": cfg.okx.passphrase,
    "Content-Type": "application/json",
  };
  if (cfg.okxSimulated) headers["x-simulated-trading"] = "1";
  const res = await fetch(`${cfg.okx.baseUrl}${path}`, { method, headers, body: payload, cache: "no-store" });
  const json = (await res.json()) as OkxEnvelope<unknown>;
  if (json.code !== "0") throw new Error(json.msg || `OKX ${json.code}`);
  return json.data;
}
