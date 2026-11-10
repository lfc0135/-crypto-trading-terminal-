/** Widen the strategy-search universe with GeckoTerminal pool search (meme keywords). Paper research only. */
import fs from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "data", "strategy-search");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAJORS = new Set(["BTC", "ETH", "SOL", "USDC", "USDT", "WBTC", "WETH", "WSOL", "USD1", "RAY", "JUP", "JTO", "BONK", "WIF", "PYTH", "PUMP", "USDS", "PYUSD"]);
const QUOTES = new Set(["SOL", "WSOL", "USDC", "USDT"]);
const TERMS = ["cat", "dog", "trump", "ai", "elon", "pepe", "inu", "frog", "gta", "claude", "moon", "baby", "chad", "meme", "grok"];

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res) { await sleep(2000); continue; }
    if (res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }
  throw new Error("retries exhausted");
}

async function main() {
  const file = path.join(outDir, "pools.json");
  const metas = JSON.parse(fs.readFileSync(file, "utf8")) as { pool: string }[];
  const seen = new Set(metas.map((m) => m.pool));
  let added = 0;
  for (const term of TERMS) {
    for (let page = 1; page <= 3; page += 1) {
      try {
        const json = await getJson(`https://api.geckoterminal.com/api/v2/search/pools?query=${term}&network=solana&page=${page}`) as { data?: { attributes?: Record<string, unknown> & { price_change_percentage?: { h24?: string } }; relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } } }[] };
        for (const row of json.data ?? []) {
          const a = row.attributes ?? {};
          const name = String(a.name ?? "");
          const [base, quote] = name.split("/").map((s) => s.trim().split(" ")[0]);
          const dex = row.relationships?.dex?.data?.id ?? "";
          const createdMs = Date.parse(String(a.pool_created_at ?? ""));
          const pool = String(a.address ?? "");
          if (!pool || seen.has(pool) || !base || MAJORS.has(base.toUpperCase()) || !QUOTES.has((quote ?? "").toUpperCase())) continue;
          if (!/^(pumpswap|raydium)$/.test(dex)) continue;
          if (!(Date.now() - createdMs < 60 * 86_400_000)) continue;
          const change = Number(a.price_change_percentage?.h24);
          seen.add(pool);
          metas.push({ pool, address: (row.relationships?.base_token?.data?.id ?? "").replace(/^solana_/, ""), symbol: base, quote: quote.toUpperCase(), dex, reserve: Number(a.reserve_in_usd ?? 0), createdMs, change24h: Number.isFinite(change) ? change : null, source: `search-${term}` } as never);
          added += 1;
        }
      } catch (error) {
        console.log(`search ${term} p${page} failed ${error instanceof Error ? error.message : ""}`);
      }
      await sleep(2500);
    }
  }
  fs.writeFileSync(file, JSON.stringify(metas, null, 1));
  console.log(`search added ${added}, total ${metas.length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
