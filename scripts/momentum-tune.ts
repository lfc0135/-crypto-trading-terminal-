import fs from "node:fs";
import path from "node:path";
import {
  CLASSIC_MOMENTUM,
  TUNE_GRID,
  defaultMomentumConfig,
  halfDays,
  pickOosWinner,
  replayPortfolio,
  type MomentumBar,
  type MomentumConfig,
  type ReplaySeries,
} from "../src/lib/onchain/momentum";
import { parseMintAuthorities } from "../src/lib/onchain/sources";

interface Pool {
  symbol: string;
  address: string;
  pool: string;
  dex: string;
  reserve: number;
  createdMs: number;
}

const cacheDir = path.join(process.cwd(), "data", "momentum-tune");

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

async function trending(): Promise<Pool[]> {
  const out: Pool[] = [];
  const seen = new Set<string>();
  for (const page of [1, 2]) {
    const json = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=${page}`) as {
      data?: {
        attributes?: { address?: string; name?: string; reserve_in_usd?: string; pool_created_at?: string };
        relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
      }[];
    };
    for (const row of json.data ?? []) {
      const dex = row.relationships?.dex?.data?.id ?? "";
      if (!/raydium|pumpswap/i.test(dex)) continue;
      const tokenId = row.relationships?.base_token?.data?.id ?? "";
      const address = tokenId.startsWith("solana_") ? tokenId.slice("solana_".length) : "";
      const pool = row.attributes?.address ?? "";
      const reserve = Number(row.attributes?.reserve_in_usd ?? 0);
      if (!address || !pool || seen.has(pool) || !(reserve >= 50_000)) continue;
      seen.add(pool);
      out.push({
        symbol: (row.attributes?.name ?? address).split("/")[0].trim(),
        address,
        pool,
        dex,
        reserve,
        createdMs: Date.parse(row.attributes?.pool_created_at ?? ""),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return out.slice(0, 12);
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

async function mints(addresses: string[]): Promise<Map<string, boolean | null>> {
  const rpc = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  const out = new Map<string, boolean | null>();
  for (let i = 0; i < addresses.length; i += 8) {
    const chunk = addresses.slice(i, i + 8);
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [chunk, { encoding: "base64" }] }),
      signal: AbortSignal.timeout(12_000),
    });
    const json = await res.json() as { result?: { value?: Array<{ data?: [string, string] } | null> } };
    chunk.forEach((address, index) => {
      const data = json.result?.value?.[index]?.data?.[0];
      out.set(address, data ? parseMintAuthorities(data)?.mintRevoked ?? null : null);
    });
  }
  return out;
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function rowStats(label: string, config: MomentumConfig, series: ReplaySeries[], window: { from: number; until: number }) {
  const report = replayPortfolio(series, config, 0.02, window);
  const takes = report.trades.filter((trade) => trade.reason === "take-profit").length;
  return {
    label,
    trades: report.trades.length,
    hitRate: report.hitRate,
    avgWinPct: report.avgWinPct,
    avgLossPct: report.avgLossPct,
    expectancyPct: report.expectancyPct,
    sleeveDailyPct: report.sleeveDailyPct,
    takeProfits: takes,
    spanDays: report.spanDays,
  };
}

async function main() {
  const pools = await trending();
  console.log(`candidates ${pools.length}`);
  const used = new Set<string>();
  const loaded: { pool: Pool; bars: MomentumBar[]; symbol: string }[] = [];
  for (const pool of pools) {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    try {
      const bars = await barsFor(pool.pool);
      let symbol = pool.symbol.replace(/\s+/g, "") || pool.address.slice(0, 4);
      if (used.has(symbol)) symbol = `${symbol}-${pool.address.slice(0, 4)}`;
      used.add(symbol);
      loaded.push({ pool, bars, symbol });
      const days = new Set(bars.map((bar) => new Date(bar.time).toISOString().slice(0, 10)));
      console.log(`${symbol} bars=${bars.length} days=${days.size} liq=${pool.reserve.toFixed(0)}`);
    } catch (error) {
      console.log(`${pool.symbol} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  const revoked = await mints(loaded.map((row) => row.pool.address));
  const series: ReplaySeries[] = loaded.map((row) => {
    const ageMs = Number.isFinite(row.pool.createdMs) ? Date.now() - row.pool.createdMs : null;
    const mint = revoked.get(row.pool.address) ?? null;
    const safetyPass = mint === true && row.pool.reserve >= 50_000 && ageMs != null && ageMs >= 5 * 60 * 1000 && row.bars.length > 30;
    return {
      symbol: row.symbol,
      address: row.pool.address,
      bars: row.bars,
      quoteReserveUsd: row.pool.reserve / 2,
      feeRate: 0.0025,
      safetyPass,
    };
  });
  const times = series.filter((row) => row.safetyPass).flatMap((row) => row.bars.map((bar) => bar.time));
  const split = halfDays(times);
  if (!split) throw new Error("Not enough distinct days to split.");
  const base = defaultMomentumConfig();
  const combos = [
    { id: "classic-tp20", ...CLASSIC_MOMENTUM, inGrid: false },
    ...TUNE_GRID.map((combo) => ({ ...combo, inGrid: true })),
  ];
  const scored = combos.map((combo) => {
    const config: MomentumConfig = { ...base, ...combo, walletGate: false };
    const train = rowStats(combo.id, config, series, { from: split.trainFrom, until: split.trainUntil });
    const test = rowStats(combo.id, config, series, { from: split.testFrom, until: split.testUntil });
    return { id: combo.id, inGrid: combo.inGrid, config, train, test, oosDaily: test.sleeveDailyPct, oosTrades: test.trades };
  });
  const winner = pickOosWinner(scored.filter((row) => row.inGrid));
  const summary = {
    generatedAt: new Date().toISOString(),
    pools: series.map((row) => ({ symbol: row.symbol, bars: row.bars.length, safetyPass: row.safetyPass })),
    trainDays: split.trainDays,
    testDays: split.testDays,
    gridSize: TUNE_GRID.length,
    winner: winner?.id ?? null,
    rows: scored.map((row) => ({
      id: row.id,
      inGrid: row.inGrid,
      takeProfit: row.config.takeProfit,
      hardStop: row.config.hardStop,
      progressPct: row.config.progressPct,
      progressMin: row.config.progressWindowMs / 60_000,
      holdMin: row.config.maxHoldMs / 60_000,
      train: row.train,
      test: row.test,
    })),
  };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ trainDays: split.trainDays, testDays: split.testDays, winner: summary.winner, grid: TUNE_GRID.length }, null, 2));
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
