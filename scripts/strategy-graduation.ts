/** Fetch graduation timing (GeckoTerminal launchpad_details) for the strategy-search universe. Paper research only. */
import fs from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "data", "strategy-search");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const metas = JSON.parse(fs.readFileSync(path.join(outDir, "pools.json"), "utf8")) as { pool: string; address: string; createdMs: number }[];
  const file = path.join(outDir, "graduation.json");
  const grad: Record<string, { completedAt: number | null; destPool: string | null; launchpad: boolean }> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const todo = [...new Set(metas.map((m) => m.address).filter((a) => a && !(a in grad)))];
  for (let i = 0; i < todo.length; i += 30) {
    const chunk = todo.slice(i, i + 30);
    try {
      const json = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/${chunk.join(",")}`) as {
        data?: { attributes?: { address?: string; launchpad_details?: { completed?: boolean; completed_at?: string | null; migrated_destination_pool_address?: string | null } | null } }[];
      };
      for (const row of json.data ?? []) {
        const a = row.attributes;
        if (!a?.address) continue;
        const lp = a.launchpad_details;
        grad[a.address] = {
          completedAt: lp?.completed_at ? Date.parse(lp.completed_at) : null,
          destPool: lp?.migrated_destination_pool_address ?? null,
          launchpad: !!lp,
        };
      }
      for (const addr of chunk) if (!(addr in grad)) grad[addr] = { completedAt: null, destPool: null, launchpad: false };
    } catch (error) {
      console.log(`tokens multi failed ${error instanceof Error ? error.message : ""}`);
    }
    await sleep(2500);
  }
  fs.writeFileSync(file, JSON.stringify(grad, null, 1));
  if (process.env.FETCH_BARS === "1") {
    const barDir = path.join(process.cwd(), "data", "pullback-tune");
    const recent = metas.filter((m) => {
      const g = grad[m.address];
      return g?.completedAt && g.destPool === m.pool && Date.now() - g.completedAt < 40 * 86_400_000 && !fs.existsSync(path.join(barDir, `${m.pool}.json`));
    });
    console.log(`fetching bars for ${recent.length} graduated pools`);
    let n = 0;
    for (const m of recent) {
      const byTime = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>();
      let before: number | undefined;
      for (let page = 0; page < 3; page += 1) {
        let rows: number[][] = [];
        try {
          const json = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${m.pool}/ohlcv/minute?aggregate=5&limit=1000&currency=usd${before ? `&before_timestamp=${before}` : ""}`) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
          rows = json.data?.attributes?.ohlcv_list ?? [];
        } catch { break; }
        if (rows.length === 0) break;
        let oldest = Infinity;
        for (const row of rows) {
          if (!(row[4] > 0)) continue;
          byTime.set(row[0] * 1000, { time: row[0] * 1000, open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] });
          if (row[0] < oldest) oldest = row[0];
        }
        await sleep(2200);
        if (rows.length < 1000) break;
        before = oldest;
      }
      fs.writeFileSync(path.join(barDir, `${m.pool}.json`), JSON.stringify([...byTime.values()].sort((a, b) => a.time - b.time)));
      n += 1;
      if (n % 10 === 0) console.log(`grad bars ${n}/${recent.length}`);
    }
  }
  if (process.env.LAUNCH_WINDOW === "1") {
    // Active graduates whose cached tape (3,000 bars) no longer reaches the migration: fetch the first 6 hours.
    const barDir = path.join(process.cwd(), "data", "pullback-tune");
    let n = 0;
    for (const m of metas) {
      const g = grad[m.address];
      const f = path.join(barDir, `${m.pool}.json`);
      if (!g?.completedAt || g.destPool !== m.pool || Date.now() - g.completedAt > 45 * 86_400_000 || !fs.existsSync(f)) continue;
      const cached = JSON.parse(fs.readFileSync(f, "utf8")) as { time: number }[];
      if (cached.length === 0 || cached[0].time - g.completedAt <= 10 * 60_000) continue;
      try {
        const before = Math.floor((g.completedAt + 6 * 3_600_000) / 1000);
        const json = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${m.pool}/ohlcv/minute?aggregate=5&limit=80&currency=usd&before_timestamp=${before}`) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
        const byTime = new Map(cached.map((b) => [b.time, b]));
        for (const row of json.data?.attributes?.ohlcv_list ?? []) {
          if (!(row[4] > 0)) continue;
          byTime.set(row[0] * 1000, { time: row[0] * 1000, open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] } as never);
        }
        fs.writeFileSync(f, JSON.stringify([...byTime.values()].sort((a, b) => a.time - b.time)));
        n += 1;
      } catch { /* skip */ }
      await sleep(2500);
    }
    console.log(`launch windows added ${n}`);
  }
  const vals = Object.values(grad);
  console.log(`tokens ${vals.length}, launchpad ${vals.filter((v) => v.launchpad).length}, completedAt ${vals.filter((v) => v.completedAt).length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
