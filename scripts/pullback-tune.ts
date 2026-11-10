import fs from "node:fs";
import path from "node:path";
import {
  CLASSIC_MOMENTUM,
  CLASSIC_PULLBACK,
  PULLBACK_GRID,
  classifyRug,
  defaultMomentumConfig,
  halfDays,
  pickOosWinner,
  replayPortfolio,
  type MomentumBar,
  type MomentumConfig,
  type ReplaySeries,
} from "../src/lib/onchain/momentum";

interface Pool {
  symbol: string;
  address: string;
  pool: string;
  dex: string;
  reserve: number;
  createdMs: number;
  change24h: number | null;
  source: string;
}

const cacheDir = path.join(process.cwd(), "data", "pullback-tune");
const MAJORS = new Set(["BTC", "ETH", "SOL", "USDC", "USDT", "WBTC", "WETH", "WSOL", "USD1", "WBT", "RAY", "WNEAR", "WRAY"]);

async function getJson(url: string): Promise<unknown> {
  let last = "request failed";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) {
      last = "429";
      await new Promise((resolve) => setTimeout(resolve, 2500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`${last} ${url}`);
}

function pushPool(out: Pool[], seen: Set<string>, row: Pool): void {
  const symbol = row.symbol.replace(/\s+/g, "") || row.address.slice(0, 4);
  if (!row.address || !row.pool || seen.has(row.pool)) return;
  if (MAJORS.has(symbol.toUpperCase())) return;
  if (!/raydium|pumpswap|pump-amm|pump_amm/i.test(row.dex) || /pumpfun|pump-fun|^pump$/i.test(row.dex)) return;
  seen.add(row.pool);
  out.push({ ...row, symbol });
}

async function geckoPages(pathName: string, pages: number, source: string, seen: Set<string>, out: Pool[]): Promise<void> {
  for (const page of Array.from({ length: pages }, (_, i) => i + 1)) {
    try {
      const json = await getJson(`https://api.geckoterminal.com/api/v2/${pathName}${pathName.includes("?") ? "&" : "?"}page=${page}`) as {
        data?: {
          attributes?: { address?: string; name?: string; reserve_in_usd?: string; pool_created_at?: string; price_change_percentage?: { h24?: string } };
          relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
        }[];
      };
      for (const row of json.data ?? []) {
        const tokenId = row.relationships?.base_token?.data?.id ?? "";
        const address = tokenId.startsWith("solana_") ? tokenId.slice("solana_".length) : "";
        const change = Number(row.attributes?.price_change_percentage?.h24);
        pushPool(out, seen, {
          symbol: (row.attributes?.name ?? address).split("/")[0].trim(),
          address,
          pool: row.attributes?.address ?? "",
          dex: row.relationships?.dex?.data?.id ?? "",
          reserve: Number(row.attributes?.reserve_in_usd ?? 0),
          createdMs: Date.parse(row.attributes?.pool_created_at ?? ""),
          change24h: Number.isFinite(change) ? change : null,
          source,
        });
      }
    } catch (error) {
      console.log(`${source} page ${page} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

async function dexTokens(seen: Set<string>, out: Pool[]): Promise<void> {
  const addresses = new Set<string>();
  for (const url of ["https://api.dexscreener.com/token-boosts/latest/v1", "https://api.dexscreener.com/token-profiles/latest/v1"]) {
    try {
      const json = await getJson(url);
      const rows = Array.isArray(json) ? json : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const item = row as { chainId?: string; tokenAddress?: string };
        if (item.chainId === "solana" && item.tokenAddress) addresses.add(item.tokenAddress);
      }
    } catch (error) {
      console.log(`dexscreener list failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  let n = 0;
  for (const address of addresses) {
    if (n >= 24) break;
    try {
      const json = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`) as {
        pairs?: { chainId?: string; dexId?: string; pairAddress?: string; pairCreatedAt?: number; priceChange?: { h24?: number }; liquidity?: { usd?: number }; baseToken?: { address?: string; symbol?: string } }[];
      };
      const pairs = (json.pairs ?? []).filter((pair) => pair.chainId === "solana" && pair.baseToken?.address === address && /raydium|pumpswap|pump/i.test(pair.dexId ?? "") && !/pumpfun/i.test(pair.dexId ?? ""));
      pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const pair = pairs[0];
      if (!pair?.pairAddress) continue;
      pushPool(out, seen, {
        symbol: pair.baseToken?.symbol ?? address.slice(0, 4),
        address,
        pool: pair.pairAddress,
        dex: pair.dexId ?? "",
        reserve: pair.liquidity?.usd ?? 0,
        createdMs: pair.pairCreatedAt ?? NaN,
        change24h: pair.priceChange?.h24 ?? null,
        source: "dexscreener",
      });
      n += 1;
    } catch {
      /* skip one token */
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

function isDumped(pool: Pool): boolean {
  return (pool.change24h != null && pool.change24h <= -40) || (pool.reserve > 0 && pool.reserve < 50_000);
}

function isLongerLived(pool: Pool): boolean {
  if (pool.reserve > 2_000_000) return false;
  const ageMs = Number.isFinite(pool.createdMs) ? Date.now() - pool.createdMs : 0;
  return ageMs >= 4 * 24 * 60 * 60 * 1000 || pool.source === "trending" || (pool.reserve >= 50_000 && pool.reserve <= 2_000_000);
}

function pickUniverse(all: Pool[], limit: number): Pool[] {
  const dumped = all.filter(isDumped).sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0) || a.reserve - b.reserve);
  const longer = all.filter((pool) => isLongerLived(pool) && !isDumped(pool)).sort((a, b) => {
    const ageA = Number.isFinite(a.createdMs) ? a.createdMs : Date.now();
    const ageB = Number.isFinite(b.createdMs) ? b.createdMs : Date.now();
    return ageA - ageB;
  });
  const rest = all.filter((pool) => !dumped.includes(pool) && !longer.includes(pool));
  const out: Pool[] = [];
  const used = new Set<string>();
  const take = (rows: Pool[], n: number) => {
    for (const pool of rows) {
      if (out.length >= limit) break;
      if (used.has(pool.pool)) continue;
      // Leave room so the longer-lived tape is not crowded out by same-day rugs.
      used.add(pool.pool);
      out.push(pool);
      if (out.filter((row) => rows.includes(row)).length >= n) break;
    }
  };
  take(dumped, Math.min(16, Math.floor(limit / 2)));
  take(longer, limit - out.length);
  take(rest, limit - out.length);
  take(dumped, limit - out.length);
  return out;
}

async function barsFor(pool: string): Promise<MomentumBar[]> {
  const file = path.join(cacheDir, `${pool}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as MomentumBar[];
    if (cached.length > 50) return cached;
  }
  const byTime = new Map<number, MomentumBar>();
  let before: number | undefined;
  for (let page = 0; page < 3; page += 1) {
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=1000&currency=usd${before ? `&before_timestamp=${before}` : ""}`;
    const json = await getJson(url) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const rows = json.data?.attributes?.ohlcv_list ?? [];
    if (rows.length === 0) break;
    let oldest = Infinity;
    for (const row of rows) {
      const time = row[0] * 1000;
      if (!(row[4] > 0)) continue;
      byTime.set(time, { time, open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] });
      if (row[0] < oldest) oldest = row[0];
    }
    if (rows.length < 1000) break;
    before = oldest;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bars));
  return bars;
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function rowStats(label: string, config: MomentumConfig, series: ReplaySeries[], window: { from: number; until: number }) {
  const report = replayPortfolio(series, config, 0.02, window);
  const takes = report.trades.filter((trade) => trade.reason === "take-profit").length;
  const stops = report.trades.filter((trade) => trade.reason === "hard-stop").length;
  return {
    label,
    trades: report.trades.length,
    hitRate: report.hitRate,
    avgWinPct: report.avgWinPct,
    avgLossPct: report.avgLossPct,
    expectancyPct: report.expectancyPct,
    sleeveDailyPct: report.sleeveDailyPct,
    takeProfits: takes,
    hardStops: stops,
    spanDays: report.spanDays,
    totalPnlUsd: report.totalPnlUsd,
  };
}

async function main() {
  const seen = new Set<string>();
  const all: Pool[] = [];
  console.log("discovering pools");
  await geckoPages("networks/solana/trending_pools", 4, "trending", seen, all);
  await geckoPages("networks/solana/dexes/pumpswap/pools", 5, "pumpswap", seen, all);
  await geckoPages("networks/solana/dexes/raydium/pools", 3, "raydium", seen, all);
  await dexTokens(seen, all);
  const pools = pickUniverse(all, 40);
  console.log(`candidates ${all.length}, selected ${pools.length} (mix of dumped/thin and longer-lived names)`);
  const used = new Set<string>();
  const loaded: { pool: Pool; bars: MomentumBar[]; symbol: string }[] = [];

  async function loadOne(pool: Pool): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    try {
      const bars = await barsFor(pool.pool);
      let symbol = pool.symbol.replace(/\s+/g, "") || pool.address.slice(0, 4);
      if (used.has(symbol)) symbol = `${symbol}-${pool.address.slice(0, 4)}`;
      used.add(symbol);
      loaded.push({ pool, bars, symbol });
      const days = new Set(bars.map((bar) => new Date(bar.time).toISOString().slice(0, 10)));
      const rug = classifyRug(bars, pool.reserve);
      console.log(`${symbol} bars=${bars.length} days=${days.size} liq=${pool.reserve.toFixed(0)} ch24=${pool.change24h ?? "?"} rugged=${rug.rugged} dd=${(rug.drawdown * 100).toFixed(0)}% src=${pool.source}`);
    } catch (error) {
      console.log(`${pool.symbol} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  for (const pool of pools) await loadOne(pool);

  const dayCount = () => new Set(loaded.filter((row) => row.bars.length > 30).flatMap((row) => row.bars.map((bar) => new Date(bar.time).toISOString().slice(0, 10)))).size;
  if (dayCount() < 4) {
    const have = new Set(loaded.map((row) => row.pool.pool));
    const extras = all
      .filter((pool) => !have.has(pool.pool) && isLongerLived(pool))
      .sort((a, b) => (Number.isFinite(a.createdMs) ? a.createdMs : Date.now()) - (Number.isFinite(b.createdMs) ? b.createdMs : Date.now()))
      .slice(0, 24);
    console.log(`only ${dayCount()} distinct days so far; fetching ${extras.length} older pools`);
    for (const pool of extras) {
      if (dayCount() >= 8) break;
      await loadOne(pool);
    }
  }
  const series: ReplaySeries[] = loaded.map((row) => ({
    symbol: row.symbol,
    address: row.pool.address,
    bars: row.bars,
    quoteReserveUsd: row.pool.reserve > 0 ? row.pool.reserve / 2 : 0,
    feeRate: 0.0025,
    safetyPass: row.bars.length >= 16,
  }));
  const rugs = loaded.map((row) => ({
    symbol: row.symbol,
    source: row.pool.source,
    reserve: row.pool.reserve,
    change24h: row.pool.change24h,
    bars: row.bars.length,
    ...classifyRug(row.bars, row.pool.reserve),
    included: row.bars.length >= 16,
  }));
  const times = series.filter((row) => row.safetyPass).flatMap((row) => row.bars.map((bar) => bar.time));
  const split = halfDays(times);
  if (!split) throw new Error("Not enough distinct days to split.");
  const base = defaultMomentumConfig();
  const combos: { id: string; inGrid: boolean; config: MomentumConfig }[] = [
    { id: "breakout-classic-tp20", inGrid: false, config: { ...base, ...CLASSIC_MOMENTUM, walletGate: false, entryMode: "breakout" } },
    { id: "pullback-tp20", inGrid: false, config: { ...base, ...CLASSIC_PULLBACK, walletGate: false } },
    ...PULLBACK_GRID.map((combo) => ({
      id: combo.id,
      inGrid: true,
      config: { ...base, ...CLASSIC_PULLBACK, retrace: combo.retrace, confirm: combo.confirm, takeProfit: combo.takeProfit, maxHoldMs: combo.maxHoldMs, walletGate: false },
    })),
  ];
  const scored = combos.map((combo) => {
    const train = rowStats(combo.id, combo.config, series, { from: split.trainFrom, until: split.trainUntil });
    const test = rowStats(combo.id, combo.config, series, { from: split.testFrom, until: split.testUntil });
    return { id: combo.id, inGrid: combo.inGrid, config: combo.config, train, test, oosDaily: test.sleeveDailyPct, oosTrades: test.trades };
  });
  const winner = pickOosWinner(scored.filter((row) => row.inGrid));
  const leastBad = [...scored.filter((row) => row.inGrid)].sort((a, b) => b.oosDaily - a.oosDaily || b.oosTrades - a.oosTrades)[0] ?? null;
  const summary = {
    generatedAt: new Date().toISOString(),
    discovered: all.length,
    selected: pools.length,
    included: series.filter((row) => row.safetyPass).length,
    ruggedIncluded: rugs.filter((row) => row.included && row.rugged).length,
    rugs,
    trainDays: split.trainDays,
    testDays: split.testDays,
    gridSize: PULLBACK_GRID.length,
    winner: winner?.id ?? null,
    leastBad: leastBad?.id ?? null,
    rows: scored.map((row) => ({
      id: row.id,
      inGrid: row.inGrid,
      entryMode: row.config.entryMode,
      retrace: row.config.retrace,
      confirm: row.config.confirm,
      takeProfit: row.config.takeProfit,
      holdMin: row.config.maxHoldMs / 60_000,
      train: row.train,
      test: row.test,
    })),
  };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({
    trainDays: split.trainDays,
    testDays: split.testDays,
    included: summary.included,
    ruggedIncluded: summary.ruggedIncluded,
    winner: summary.winner,
    leastBad: summary.leastBad,
    grid: PULLBACK_GRID.length,
  }, null, 2));
  for (const row of summary.rows) {
    console.log([
      row.id,
      "train",
      row.train.trades,
      pct(row.train.hitRate),
      pct(row.train.avgWinPct),
      pct(row.train.avgLossPct),
      pct(row.train.expectancyPct),
      pct(row.train.sleeveDailyPct),
      "oos",
      row.test.trades,
      pct(row.test.hitRate),
      pct(row.test.avgWinPct),
      pct(row.test.avgLossPct),
      pct(row.test.expectancyPct),
      pct(row.test.sleeveDailyPct),
      `tp ${row.test.takeProfits}`,
    ].join(" | "));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
