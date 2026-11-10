import { writeFileSync } from "node:fs";
import { defaultMomentumConfig, replayPortfolio, type MomentumBar, type ReplaySeries } from "../src/lib/onchain/momentum";
import { parseMintAuthorities } from "../src/lib/onchain/sources";

interface Pool {
  symbol: string;
  address: string;
  pool: string;
  dex: string;
  reserve: number;
  createdMs: number;
}

async function getJson(url: string): Promise<unknown> {
  let last = "request failed";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (res.status === 429) {
      last = "429";
      await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`${last} ${url}`);
}

async function trending(): Promise<Pool[]> {
  const json = await getJson("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1") as {
    data?: {
      attributes?: { address?: string; name?: string; reserve_in_usd?: string; pool_created_at?: string };
      relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
    }[];
  };
  const out: Pool[] = [];
  for (const row of json.data ?? []) {
    const dex = row.relationships?.dex?.data?.id ?? "";
    if (!/raydium|pumpswap|pump/i.test(dex) || dex === "pumpfun") continue;
    const tokenId = row.relationships?.base_token?.data?.id ?? "";
    const address = tokenId.startsWith("solana_") ? tokenId.slice("solana_".length) : "";
    const pool = row.attributes?.address ?? "";
    if (!address || !pool) continue;
    out.push({
      symbol: (row.attributes?.name ?? address).split("/")[0].trim(),
      address,
      pool,
      dex,
      reserve: Number(row.attributes?.reserve_in_usd ?? 0),
      createdMs: Date.parse(row.attributes?.pool_created_at ?? ""),
    });
  }
  return out.slice(0, 8);
}

async function barsFor(pool: string): Promise<MomentumBar[]> {
  const json = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=1000&currency=usd`) as {
    data?: { attributes?: { ohlcv_list?: number[][] } };
  };
  const rows = json.data?.attributes?.ohlcv_list ?? [];
  return rows.map((row) => ({
    time: row[0] * 1000,
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
  })).filter((bar) => bar.close > 0).sort((a, b) => a.time - b.time);
}

async function mintRevoked(address: string): Promise<boolean | null> {
  const rpc = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [address, { encoding: "base64" }] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const json = await res.json() as { result?: { value?: { data?: [string, string] } | null } };
  const data = json.result?.value?.data?.[0];
  if (!data) return null;
  return parseMintAuthorities(data)?.mintRevoked ?? null;
}

async function main() {
  const pools = await trending();
  const series: ReplaySeries[] = [];
  for (const pool of pools) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    let bars: MomentumBar[] = [];
    try {
      bars = await barsFor(pool.pool);
    } catch (error) {
      console.log(`${pool.symbol} candles failed: ${error instanceof Error ? error.message : "unknown"}`);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    const mint = await mintRevoked(pool.address);
    const ageMs = Number.isFinite(pool.createdMs) ? Date.now() - pool.createdMs : null;
    const safetyPass = mint === true && pool.reserve >= 50_000 && ageMs != null && ageMs >= 5 * 60 * 1000 && bars.length > 20;
    series.push({
      symbol: pool.symbol,
      address: pool.address,
      bars,
      quoteReserveUsd: pool.reserve > 0 ? pool.reserve / 2 : 0,
      feeRate: 0.0025,
      safetyPass,
    });
    console.log(`${pool.symbol} bars=${bars.length} liq=${pool.reserve.toFixed(0)} mintRevoked=${mint} safety=${safetyPass}`);
  }
  const report = replayPortfolio(series, defaultMomentumConfig(), 0.02);
  const summary = {
    generatedAt: new Date().toISOString(),
    scanned: report.scanned,
    tradedNames: report.tradedNames,
    excludedSafety: report.excludedSafety,
    trades: report.trades.length,
    hitRate: report.hitRate,
    avgWinPct: report.avgWinPct,
    avgLossPct: report.avgLossPct,
    expectancyPct: report.expectancyPct,
    spanDays: report.spanDays,
    totalPnlUsd: report.totalPnlUsd,
    sleeveDailyPct: report.sleeveDailyPct,
    reasons: report.trades.reduce<Record<string, number>>((acc, trade) => {
      acc[trade.reason] = (acc[trade.reason] ?? 0) + 1;
      return acc;
    }, {}),
    names: series.map((row) => ({ symbol: row.symbol, bars: row.bars.length, safetyPass: row.safetyPass })),
    note: report.note,
  };
  writeFileSync("data/momentum-replay.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
