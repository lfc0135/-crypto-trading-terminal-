import { readConfig } from "../config";
import { gmgnKol, gmgnPool, gmgnSecurity, gmgnSmartMoney, gmgnTopHolders } from "../brokers/gmgn";
import { flag, num } from "../watchlist/gmgn-filter";
import type { MomentumBar } from "./momentum";
import {
  priorityFeeUsd,
  simulateSell,
  type HolderShare,
  type ObservedTrade,
  type TickInput,
  type TokenCheck,
  type WalletStats,
} from "./model";

const memory = new Map<string, { at: number; value: unknown }>();
const lastCall = new Map<string, number>();

async function gap(host: string, ms: number): Promise<void> {
  const wait = ms - (Date.now() - (lastCall.get(host) ?? 0));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall.set(host, Date.now());
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  memory.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(url: string, host: string, pauseMs: number): Promise<unknown> {
  await gap(host, pauseMs);
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
  if (res.status === 429) throw new Error(`${host} rate limited.`);
  if (!res.ok) throw new Error(`${host} returned ${res.status}.`);
  return res.json();
}

export function parseMintAuthorities(base64: string): { mintRevoked: boolean; freezeRevoked: boolean } | null {
  const buf = Buffer.from(base64, "base64");
  if (buf.length < 82) return null;
  return {
    mintRevoked: buf.readUInt32LE(0) === 0,
    freezeRevoked: buf.readUInt32LE(46) === 0,
  };
}

function feeFor(dex: string): number {
  const id = dex.toLowerCase();
  if (id.includes("pumpfun") || id === "pump") return 0.01;
  return 0.0025;
}

function graduatedVenue(dex: string): boolean | null {
  const id = dex.toLowerCase();
  if (id.includes("pumpfun") || id === "pump") return false;
  if (id.includes("raydium") || id.includes("pumpswap") || id.includes("pump-amm") || id.includes("pump_amm")) return true;
  return null;
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  pairCreatedAt?: number;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  baseToken?: { address?: string; symbol?: string };
}

function bestPair(payload: unknown, address: string): DexPair | null {
  const pairs = payload && typeof payload === "object" && Array.isArray((payload as { pairs?: unknown }).pairs)
    ? (payload as { pairs: DexPair[] }).pairs
    : [];
  const rows = pairs.filter((pair) => pair.baseToken?.address === address && pair.chainId === "solana" && graduatedVenue(pair.dexId ?? "") != null);
  rows.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return rows[0] ?? null;
}

async function solPrice(): Promise<{ price: number | null; note: string | null }> {
  try {
    const json = await cached("sol-price", 5 * 60_000, () => getJson("https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT", "okx", 200)) as { data?: { last?: string }[] };
    const price = Number(json.data?.[0]?.last);
    if (price > 0) return { price, note: null };
  } catch {
    /* fall through */
  }
  return { price: null, note: "SOL price was unavailable. Priority fee assumed $0.02." };
}

function blankToken(address: string, symbol: string): TokenCheck {
  return {
    address,
    symbol,
    price: null,
    quoteReserveUsd: null,
    feeRate: 0.0025,
    ageMs: null,
    graduated: null,
    mintRevoked: null,
    freezeRevoked: null,
    lpBurnedOrLocked: null,
    holders: null,
    devShare: null,
    devSelling: null,
    honeypot: null,
    sellProceedsUsd: null,
    bundlerRate: null,
    sniperRate: null,
    liquidityUsd: null,
    volumeUsd: null,
    wash: null,
    venue: null,
  };
}

function applyPair(token: TokenCheck, pair: DexPair, now: number): void {
  const price = Number(pair.priceUsd);
  const liquidity = pair.liquidity?.usd ?? null;
  token.price = price > 0 ? price : null;
  token.liquidityUsd = liquidity;
  token.volumeUsd = pair.volume?.h24 ?? null;
  token.quoteReserveUsd = liquidity != null && liquidity > 0 ? liquidity / 2 : null;
  token.feeRate = feeFor(pair.dexId ?? "");
  token.graduated = graduatedVenue(pair.dexId ?? "");
  token.venue = pair.dexId ?? null;
  token.ageMs = pair.pairCreatedAt ? Math.max(0, now - pair.pairCreatedAt) : null;
  token.symbol = pair.baseToken?.symbol || token.symbol;
  if (token.price != null && token.quoteReserveUsd != null) {
    token.sellProceedsUsd = simulateSell(token.price, token.quoteReserveUsd, 100, token.feeRate);
  }
}

export async function discoverSolanaTokens(): Promise<string[]> {
  const out: string[] = [];
  for (const url of ["https://api.dexscreener.com/token-boosts/latest/v1", "https://api.dexscreener.com/token-profiles/latest/v1"]) {
    try {
      const json = await cached(url, 60_000, () => getJson(url, "dexscreener", 300));
      const rows = Array.isArray(json) ? json : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const item = row as { chainId?: string; tokenAddress?: string };
        if (item.chainId === "solana" && item.tokenAddress) out.push(item.tokenAddress);
      }
    } catch {
      /* one feed can fail */
    }
  }
  return [...new Set(out)].slice(0, 8);
}

async function loadPair(address: string, now: number): Promise<TokenCheck | null> {
  try {
    const json = await cached(`dex:${address}`, 45_000, () => getJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`, "dexscreener", 300));
    const pair = bestPair(json, address);
    if (!pair) return null;
    const token = blankToken(address, pair.baseToken?.symbol || address.slice(0, 4));
    applyPair(token, pair, now);
    return token;
  } catch {
    return null;
  }
}

async function loadMints(tokens: TokenCheck[]): Promise<void> {
  if (tokens.length === 0) return;
  const rpc = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  try {
    await gap("solana-rpc", 250);
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [tokens.map((token) => token.address), { encoding: "base64" }],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return;
    const json = await res.json() as { result?: { value?: Array<{ data?: [string, string] | null } | null> } };
    const values = json.result?.value ?? [];
    tokens.forEach((token, index) => {
      const data = values[index]?.data?.[0];
      if (!data) return;
      const parsed = parseMintAuthorities(data);
      if (!parsed) return;
      token.mintRevoked = parsed.mintRevoked;
      token.freezeRevoked = parsed.freezeRevoked;
    });
  } catch {
    /* mint stays unverified and the gate fails closed */
  }
}

function burnFlag(value: unknown): boolean | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const text = value.toLowerCase();
  if (text.includes("burn") || text.includes("lock")) return true;
  if (text === "none" || text === "no" || text === "false") return false;
  return null;
}

function applyGmgn(token: TokenCheck, security: Record<string, unknown> | null, holders: HolderShare[] | null, pool: Record<string, unknown> | null): void {
  if (security) {
    const mint = flag(security.renounced_mint);
    const freeze = flag(security.renounced_freeze_account);
    if (mint != null) token.mintRevoked = mint;
    if (freeze != null) token.freezeRevoked = freeze;
    const burned = burnFlag(security.burn_status);
    if (burned != null) token.lpBurnedOrLocked = burned;
    const honeypot = flag(security.honeypot) ?? flag(security.is_honeypot);
    if (honeypot != null) token.honeypot = honeypot;
    const dev = num(security.dev_team_hold_rate) ?? num(security.creator_balance_rate);
    if (dev != null) token.devShare = dev;
    const status = security.creator_token_status;
    if (status === "creator_close") token.devSelling = false;
    if (status === "creator_hold") token.devSelling = false;
    if (status === "creator_sell" || status === "creator_selling") token.devSelling = true;
    const bundler = num(security.bundler_trader_amount_rate);
    const sniper = num(security.rat_trader_amount_rate);
    const sniperCount = num(security.sniper_count);
    if (bundler != null) token.bundlerRate = bundler;
    if (sniper != null) token.sniperRate = sniper;
    else if (sniperCount === 0) token.sniperRate = 0;
    const wash = flag(security.is_wash_trading);
    if (wash != null) token.wash = wash;
  }
  if (holders && holders.length > 0) token.holders = holders;
  if (pool) {
    const liquidity = num(pool.liquidity);
    if (liquidity != null) {
      token.liquidityUsd = liquidity;
      token.quoteReserveUsd = liquidity / 2;
    }
    const exchange = typeof pool.exchange === "string" ? pool.exchange : "";
    if (exchange) {
      token.venue = exchange;
      token.graduated = graduatedVenue(exchange);
      token.feeRate = feeFor(exchange);
    }
    const created = num(pool.creation_timestamp);
    if (created != null) token.ageMs = Math.max(0, Date.now() - (created < 1e12 ? created * 1000 : created));
  }
}

function holderShares(rows: Record<string, unknown>[]): HolderShare[] {
  return rows.map((row) => ({
    share: num(row.amount_percentage) ?? 0,
    pool: num(row.addr_type) === 2 || typeof row.exchange === "string",
  })).filter((row) => row.share > 0);
}

function gmgnStats(raw: Record<string, unknown>): WalletStats | null {
  const info = raw.maker_info && typeof raw.maker_info === "object" ? raw.maker_info as Record<string, unknown> : raw;
  const pnl = num(info.realized_profit_30d) ?? num(info.pnl_30d);
  const win = num(info.winrate_30d) ?? num(info.win_rate_30d);
  const trades = num(info.txs_30d) ?? num(info.trades_30d);
  const hold = num(info.avg_holding_period) ?? num(info.median_hold_time);
  if (pnl == null || win == null || trades == null || hold == null) return null;
  const winRate = win > 1 ? win / 100 : win;
  const medianHoldMs = hold < 1_000_000 ? hold * 1000 : hold;
  return { realizedPnl: pnl, winRate, trades, medianHoldMs };
}

export function parseGmgnTrade(raw: Record<string, unknown>): ObservedTrade | null {
  const wallet = typeof raw.maker === "string" ? raw.maker : "";
  const token = typeof raw.base_address === "string" ? raw.base_address : "";
  const side = raw.side === "buy" || raw.side === "sell" ? raw.side : null;
  if (!wallet || !token || !side || token.startsWith("0x")) return null;
  const base = raw.base_token && typeof raw.base_token === "object" ? raw.base_token as Record<string, unknown> : {};
  const launch = typeof base.launchpad === "string" ? base.launchpad : "";
  if (launch && !/pump|raydium|bonk/i.test(launch)) return null;
  let ts = num(raw.timestamp) ?? 0;
  if (ts > 0 && ts < 1e12) ts *= 1000;
  if (!(ts > 0)) return null;
  const info = raw.maker_info && typeof raw.maker_info === "object" ? raw.maker_info as Record<string, unknown> : {};
  const tags = Array.isArray(info.tags) ? info.tags.filter((tag): tag is string => typeof tag === "string") : [];
  return {
    wallet,
    token,
    symbol: typeof base.symbol === "string" ? base.symbol : token.slice(0, 4),
    side,
    ts,
    usd: num(raw.amount_usd) ?? 0,
    tags,
    gmgn: gmgnStats(raw),
  };
}

function parseOhlcv(payload: unknown): MomentumBar[] {
  const list = payload && typeof payload === "object"
    ? (payload as { data?: { attributes?: { ohlcv_list?: unknown[] } } }).data?.attributes?.ohlcv_list
    : null;
  if (!Array.isArray(list)) return [];
  const bars: MomentumBar[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const time = Number(row[0]) * 1000;
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (time > 0 && close > 0) bars.push({ time, open, high, low, close, volume });
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

async function loadGeckoTokens(now: number): Promise<TokenCheck[]> {
  const json = await cached("gecko-trend", 45_000, () => getJson("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1", "geckoterminal", 350));
  const rows = json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data) ? (json as { data: Record<string, unknown>[] }).data : [];
  const tokens: TokenCheck[] = [];
  for (const row of rows) {
    if (tokens.length >= 6) break;
    const attributes = row.attributes && typeof row.attributes === "object" ? row.attributes as Record<string, unknown> : {};
    const relationships = row.relationships && typeof row.relationships === "object" ? row.relationships as Record<string, { data?: { id?: string } }> : {};
    const dex = relationships.dex?.data?.id ?? "";
    if (graduatedVenue(dex) !== true) continue;
    const tokenId = relationships.base_token?.data?.id ?? "";
    const address = tokenId.startsWith("solana_") ? tokenId.slice("solana_".length) : "";
    const pool = typeof attributes.address === "string" ? attributes.address : "";
    if (!address || !pool) continue;
    const name = typeof attributes.name === "string" ? attributes.name.split("/")[0].trim() : address.slice(0, 4);
    const reserve = Number(attributes.reserve_in_usd);
    const price = Number(attributes.base_token_price_usd);
    const tx = attributes.transactions && typeof attributes.transactions === "object" ? attributes.transactions as { m5?: { buys?: number }; h1?: { buys?: number } } : {};
    const created = typeof attributes.pool_created_at === "string" ? Date.parse(attributes.pool_created_at) : NaN;
    const token = blankToken(address, name);
    token.price = price > 0 ? price : null;
    token.liquidityUsd = Number.isFinite(reserve) ? reserve : null;
    token.quoteReserveUsd = token.liquidityUsd != null && token.liquidityUsd > 0 ? token.liquidityUsd / 2 : null;
    token.feeRate = feeFor(dex);
    token.graduated = true;
    token.venue = dex;
    token.ageMs = Number.isFinite(created) ? Math.max(0, now - created) : null;
    token.buyTx5m = tx.m5?.buys ?? null;
    token.buyTxAvg = tx.h1?.buys != null ? tx.h1.buys / 12 : null;
    token.volumeUsd = num((attributes.volume_usd as { h24?: unknown } | undefined)?.h24);
    if (token.price != null && token.quoteReserveUsd != null) token.sellProceedsUsd = simulateSell(token.price, token.quoteReserveUsd, 100, token.feeRate);
    try {
      const candles = await cached(`ohlcv:${pool}`, 60_000, async () => {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            return await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=48&currency=usd`, "geckoterminal", 500);
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("ohlcv failed");
            await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
          }
        }
        throw lastError ?? new Error("ohlcv failed");
      });
      token.bars = parseOhlcv(candles);
      const last = token.bars[token.bars.length - 1];
      const prev = token.bars[token.bars.length - 2];
      if (last && token.buyTx5m != null) last.buys = token.buyTx5m;
      if (prev && token.buyTxAvg != null) prev.buys = token.buyTxAvg;
    } catch {
      token.bars = [];
    }
    tokens.push(token);
  }
  return tokens;
}

export async function loadMarket(now: number): Promise<TickInput> {
  const cfg = readConfig();
  let gmgn = Boolean(cfg.gmgn.apiKey);
  let gmgnNote: string | null = null;
  const trades: ObservedTrade[] = [];
  if (gmgn) {
    try {
      const [smart, kol] = await Promise.all([
        cached("gmgn-smart", 20_000, () => gmgnSmartMoney("sol", 30)),
        cached("gmgn-kol", 20_000, () => gmgnKol("sol", 30)),
      ]);
      for (const row of [...smart, ...kol]) {
        const trade = parseGmgnTrade(row);
        if (trade) trades.push(trade);
      }
    } catch (error) {
      gmgn = false;
      gmgnNote = error instanceof Error ? error.message : "GMGN feed failed";
    }
  }
  let tokens: TokenCheck[] = [];
  try {
    tokens = await loadGeckoTokens(now);
  } catch {
    tokens = [];
  }
  if (tokens.length === 0) {
    const wanted = new Set<string>();
    for (const trade of trades) {
      if (trade.side === "buy" && wanted.size < 4) wanted.add(trade.token);
    }
    for (const address of await discoverSolanaTokens()) {
      if (wanted.size >= 6) break;
      wanted.add(address);
    }
    for (const address of wanted) {
      const token = await loadPair(address, now);
      if (token) tokens.push(token);
    }
  }
  await loadMints(tokens);
  if (gmgn) {
    const detailed = tokens.slice(0, 1);
    for (const token of detailed) {
      try {
        const [security, holderRows, pool] = await Promise.all([
          cached(`sec:${token.address}`, 5 * 60_000, () => gmgnSecurity("sol", token.address)),
          cached(`holders:${token.address}`, 5 * 60_000, () => gmgnTopHolders("sol", token.address)),
          cached(`pool:${token.address}`, 5 * 60_000, () => gmgnPool("sol", token.address)),
        ]);
        applyGmgn(token, security, holderShares(holderRows), pool);
        if (token.price != null && token.quoteReserveUsd != null) {
          token.sellProceedsUsd = simulateSell(token.price, token.quoteReserveUsd, 100, token.feeRate);
        }
      } catch {
        /* missing GMGN detail stays unverified */
      }
    }
  }
  const sol = await solPrice();
  return {
    now,
    trades,
    tokens,
    priorityUsd: priorityFeeUsd(sol.price ?? 0),
    gmgn,
    solPriceNote: [gmgnNote, sol.note].filter(Boolean).join(" ") || null,
  };
}
