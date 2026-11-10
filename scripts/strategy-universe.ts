/**
 * Build a wider meme-pool universe for the strategy search. Paper research only.
 * Keeps dumped, thin, and rugged pools. Reuses the pullback-tune candle cache.
 */
import fs from "node:fs";
import path from "node:path";

interface PoolMeta {
  pool: string;
  address: string;
  symbol: string;
  quote: string;
  dex: string;
  reserve: number;
  createdMs: number;
  change24h: number | null;
  source: string;
}

const barDir = path.join(process.cwd(), "data", "pullback-tune");
const outDir = path.join(process.cwd(), "data", "strategy-search");
const MAJORS = new Set(["BTC", "ETH", "SOL", "USDC", "USDT", "WBTC", "WETH", "WSOL", "USD1", "WBT", "RAY", "WNEAR", "WRAY", "JUP", "JTO", "BONK", "WIF", "PYTH", "MSOL", "JITOSOL", "BSOL", "CBBTC", "PUMP", "USDS", "PYUSD", "EURC"]);
const QUOTES = new Set(["SOL", "WSOL", "USDC", "USDT"]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res) { await sleep(2000); continue; }
    if (res.status === 429) { await sleep(4000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }
  throw new Error("retries exhausted");
}

type GeckoPool = {
  attributes?: { address?: string; name?: string; reserve_in_usd?: string; pool_created_at?: string; price_change_percentage?: { h24?: string } };
  relationships?: { base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
};

function toMeta(row: GeckoPool, source: string): PoolMeta | null {
  const a = row.attributes ?? {};
  const name = a.name ?? "";
  const [base, quote] = name.split("/").map((s) => s.trim().split(" ")[0]);
  const tokenId = row.relationships?.base_token?.data?.id ?? "";
  const change = Number(a.price_change_percentage?.h24);
  return {
    pool: a.address ?? "",
    address: tokenId.replace(/^solana_/, ""),
    symbol: (base ?? "").replace(/\s+/g, ""),
    quote: (quote ?? "").toUpperCase(),
    dex: row.relationships?.dex?.data?.id ?? "",
    reserve: Number(a.reserve_in_usd ?? 0),
    createdMs: Date.parse(a.pool_created_at ?? ""),
    change24h: Number.isFinite(change) ? change : null,
    source,
  };
}

function eligible(m: PoolMeta): boolean {
  if (!m.pool || !m.symbol) return false;
  if (MAJORS.has(m.symbol.toUpperCase())) return false;
  if (!QUOTES.has(m.quote)) return false;
  if (!/raydium|pumpswap|pump-amm|pump_amm|meteora/i.test(m.dex) || /pumpfun|pump-fun|^pump$/i.test(m.dex)) return false;
  return true;
}

async function listing(pathName: string, pages: number, source: string, out: Map<string, PoolMeta>): Promise<void> {
  for (let page = 1; page <= pages; page += 1) {
    try {
      const json = await getJson(`https://api.geckoterminal.com/api/v2/${pathName}${pathName.includes("?") ? "&" : "?"}page=${page}`) as { data?: GeckoPool[] };
      const rows = json.data ?? [];
      for (const row of rows) {
        const m = toMeta(row, source);
        if (m && eligible(m) && !out.has(m.pool)) out.set(m.pool, m);
      }
      if (rows.length === 0) break;
    } catch (error) {
      console.log(`${source} p${page} failed ${error instanceof Error ? error.message : ""}`);
    }
    await sleep(2200);
  }
}

async function metaFor(pools: string[], out: Map<string, PoolMeta>, source: string): Promise<void> {
  for (let i = 0; i < pools.length; i += 30) {
    const chunk = pools.slice(i, i + 30);
    try {
      const json = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/${chunk.join(",")}`) as { data?: GeckoPool[] };
      for (const row of json.data ?? []) {
        const m = toMeta(row, source);
        if (m && eligible(m) && !out.has(m.pool)) out.set(m.pool, m);
      }
    } catch (error) {
      console.log(`multi failed ${error instanceof Error ? error.message : ""}`);
    }
    await sleep(2200);
  }
}

async function bars(pool: string): Promise<number> {
  const file = path.join(barDir, `${pool}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
    if (cached.length > 0) return cached.length;
  }
  const byTime = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();
  let before: number | undefined;
  for (let page = 0; page < 3; page += 1) {
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=5&limit=1000&currency=usd${before ? `&before_timestamp=${before}` : ""}`;
    let rows: number[][] = [];
    try {
      const json = await getJson(url) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
      rows = json.data?.attributes?.ohlcv_list ?? [];
    } catch {
      break;
    }
    if (rows.length === 0) break;
    let oldest = Infinity;
    for (const row of rows) {
      if (!(row[4] > 0)) continue;
      byTime.set(row[0] * 1000, { time: row[0] * 1000, open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] });
      if (row[0] < oldest) oldest = row[0];
    }
    if (rows.length < 1000) break;
    before = oldest;
    await sleep(2200);
  }
  const out = [...byTime.values()].sort((a, b) => a.time - b.time);
  fs.writeFileSync(file, JSON.stringify(out));
  await sleep(2200);
  return out.length;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const metaFile = path.join(outDir, "pools.json");
  const found = new Map<string, PoolMeta>();
  if (fs.existsSync(metaFile)) for (const m of JSON.parse(fs.readFileSync(metaFile, "utf8")) as PoolMeta[]) found.set(m.pool, m);
  const cached = fs.readdirSync(barDir).filter((f) => f.endsWith(".json") && f !== "result.json").map((f) => f.replace(/\.json$/, ""));
  await metaFor(cached.filter((p) => !found.has(p)), found, "pullback-tune");
  console.log(`cached pools with meta ${found.size}`);
  if (process.env.SKIP_DISCOVERY !== "1") {
    await listing("networks/solana/trending_pools?duration=24h", 8, "trending24h", found);
    await listing("networks/solana/trending_pools?duration=6h", 5, "trending6h", found);
    await listing("networks/solana/dexes/pumpswap/pools?sort=h24_tx_count_desc", 10, "pumpswap-tx", found);
    await listing("networks/solana/dexes/pumpswap/pools?sort=h24_volume_usd_desc", 10, "pumpswap-vol", found);
    await listing("networks/solana/dexes/raydium/pools", 5, "raydium", found);
    await listing("networks/solana/new_pools", 10, "new", found);
  }
  const all = [...found.values()];
  fs.writeFileSync(metaFile, JSON.stringify(all, null, 1));
  console.log(`eligible candidates ${all.length}`);
  const limit = Number(process.env.POOL_LIMIT ?? 220);
  // Keep every dumped/thin pool (rugs stay in) and fill the rest by age so the tape spans weeks.
  const dumped = all.filter((m) => (m.change24h != null && m.change24h <= -40) || m.reserve < 50_000);
  const rest = all.filter((m) => !dumped.includes(m)).sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0));
  const pick = [...dumped.slice(0, Math.floor(limit * 0.45)), ...rest].slice(0, limit);
  let n = 0;
  for (const m of pick) {
    const count = await bars(m.pool);
    n += 1;
    if (n % 10 === 0) console.log(`bars ${n}/${pick.length}`);
    (m as PoolMeta & { bars?: number }).bars = count;
  }
  fs.writeFileSync(path.join(outDir, "universe.json"), JSON.stringify(pick, null, 1));
  console.log(`universe ${pick.length}, with >=50 bars ${pick.filter((m) => ((m as PoolMeta & { bars?: number }).bars ?? 0) >= 50).length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
