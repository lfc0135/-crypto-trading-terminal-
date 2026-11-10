/**
 * Walk-forward strategy search over the wider meme universe. Paper research only.
 * Parameters are picked on train windows only; test windows are reported as-is.
 */
import fs from "node:fs";
import path from "node:path";
import { classifyRug } from "../src/lib/onchain/pullback";
import {
  admit,
  candidates,
  simulate,
  stats,
  type EntryRule,
  type ExitRule,
  type SimTrade,
  type Stats,
  type Tape,
} from "../src/lib/onchain/strategy-search";

const H = 3_600_000;
const DAY = 24 * H;
const barDir = path.join(process.cwd(), "data", "pullback-tune");
const outDir = path.join(process.cwd(), "data", "strategy-search");

interface Meta { pool: string; address: string; dex: string; symbol: string; reserve: number; createdMs: number; change24h: number | null; source: string }
interface Combo { id: string; family: string; entry: EntryRule; exit: ExitRule }

function loadTapes(): Tape[] {
  const metaFile = path.join(outDir, "pools.json");
  const metas = JSON.parse(fs.readFileSync(metaFile, "utf8")) as Meta[];
  const gradFile = path.join(outDir, "graduation.json");
  const grad = (fs.existsSync(gradFile) ? JSON.parse(fs.readFileSync(gradFile, "utf8")) : {}) as Record<string, { completedAt: number | null; destPool: string | null }>;
  const tapes: Tape[] = [];
  for (const m of metas) {
    const file = path.join(barDir, `${m.pool}.json`);
    if (!fs.existsSync(file)) continue;
    const bars = (JSON.parse(fs.readFileSync(file, "utf8")) as Tape["bars"]).filter((b) => b.close > 0 && b.high > 0 && b.low > 0).sort((a, b) => a.time - b.time);
    if (bars.length < 16) continue;
    if (m.reserve > 5_000_000) continue; // not a meme-size pool
    const rug = classifyRug(bars, m.reserve);
    // Graduation time: launchpad completed_at when this pool is the migration destination;
    // fallback to pool_created_at for pump/bonk-suffixed tokens on PumpSwap/Raydium.
    const g = grad[m.address];
    let graduatedMs: number | null = null;
    if (g?.completedAt && (g.destPool === m.pool || Math.abs(m.createdMs - g.completedAt) < 15 * 60_000)) graduatedMs = g.completedAt;
    else if (!g?.completedAt && /(pump|bonk)$/i.test(m.address) && /pumpswap|raydium/i.test(m.dex) && Number.isFinite(m.createdMs)) graduatedMs = m.createdMs;
    tapes.push({ symbol: m.symbol, pool: m.pool, bars, quoteReserveUsd: m.reserve > 0 ? m.reserve / 2 : 0, createdMs: m.createdMs, rugged: rug.rugged, graduatedMs });
  }
  return tapes;
}

const STRUCT_TP20: ExitRule = { useStructureStop: true, stopPct: 0.09, takeProfit: 0.2, maxHoldMs: 3 * H };
const BREAKOUT: EntryRule = { family: "breakout", lookbackBars: 6, volumeMultiple: 3 };
const PULLBACK50: EntryRule = { family: "pullback", retrace: 0.5, confirm: "higher-low" };

function grid(): Combo[] {
  const out: Combo[] = [];
  // (a) 50% pullback with spike-volume, liquidity, and age filters; exit is +20% full close or half at +20% and trail 12%. 16.
  for (const vol of [10_000, 30_000]) for (const liq of [25_000, 75_000]) for (const age of [72, null]) for (const ex of ["tp20", "half20-trail12"] as const) {
    out.push({
      id: `a-pb-r50-vol${vol / 1000}k-liq${liq / 1000}k-age${age ?? "any"}-${ex}`,
      family: "a",
      entry: { family: "pullback", retrace: 0.5, confirm: "higher-low", minSpikeVolUsd: vol, minLiquidityUsd: liq, ...(age ? { maxAgeHours: age } : {}) },
      exit: ex === "tp20" ? STRUCT_TP20 : { useStructureStop: true, stopPct: 0.09, takeProfit: 0.2, scaleFraction: 0.5, trailActivate: 0.2, trailPct: 0.12, maxHoldMs: 3 * H },
    });
  }
  // (b) trailing stop instead of a fixed take-profit. 16.
  for (const [name, entry] of [["bo", BREAKOUT], ["pb", PULLBACK50]] as const) for (const act of [0.1, 0.2]) for (const trail of [0.1, 0.2]) for (const hold of [3, 12]) {
    out.push({
      id: `b-${name}-trail${trail * 100}-act${act * 100}-hold${hold}h`,
      family: "b",
      entry,
      exit: { useStructureStop: name === "pb", stopPct: 0.09, takeProfit: null, trailActivate: act, trailPct: trail, maxHoldMs: hold * H },
    });
  }
  // (b+) pullback entry: half at +20%, trail the rest 8/12/15% under the peak, 3-hour hold. 3.
  for (const trail of [0.08, 0.12, 0.15]) {
    out.push({
      id: `b-pb-half20-trail${trail * 100}-hold3h`,
      family: "b",
      entry: PULLBACK50,
      exit: { useStructureStop: true, stopPct: 0.09, takeProfit: 0.2, scaleFraction: 0.5, trailActivate: 0.2, trailPct: trail, maxHoldMs: 3 * H },
    });
  }
  // (c) scale out half at +15/20%, trail the rest. 16.
  for (const [name, entry] of [["bo", BREAKOUT], ["pb", PULLBACK50]] as const) for (const tp of [0.15, 0.2]) for (const trail of [0.15, 0.25]) for (const be of [true, false]) {
    out.push({
      id: `c-${name}-half${tp * 100}-trail${trail * 100}${be ? "-be" : ""}`,
      family: "c",
      entry,
      exit: { useStructureStop: name === "pb", stopPct: 0.09, takeProfit: tp, scaleFraction: 0.5, breakevenAfterScale: be, trailActivate: null, trailPct: trail, maxHoldMs: 12 * H },
    });
  }
  // (d) volume acceleration in the first hours of a new pool. 8.
  for (const early of [6, 24]) for (const vm of [3, 6]) for (const ex of ["tp20", "trail"] as const) {
    out.push({
      id: `d-early${early}h-vol${vm}x-${ex}`,
      family: "d",
      entry: { family: "early-accel", earlyHours: early, volumeMultiple: vm, accelBars: 3, accelMinMovePct: 0.1 },
      exit: ex === "tp20"
        ? { stopPct: 0.1, takeProfit: 0.2, maxHoldMs: 2 * H }
        : { stopPct: 0.1, takeProfit: null, trailActivate: 0.1, trailPct: 0.15, maxHoldMs: 6 * H },
    });
  }
  // (e) mean-reversion bounce after a sharp flush on pools that still trade. 16.
  for (const fp of [0.3, 0.5]) for (const vol of [20_000, 60_000]) for (const tgt of ["tp15", "half"] as const) for (const hold of [1, 3]) {
    out.push({
      id: `e-flush${fp * 100}-vol${vol / 1000}k-${tgt}-hold${hold}h`,
      family: "e",
      entry: { family: "flush", flushPct: fp, flushBars: 6, minFlushVolUsd: vol, minLiquidityUsd: 20_000 },
      exit: { useStructureStop: true, stopPct: 0.12, takeProfit: 0.15, targetHalfRetrace: tgt === "half", maxHoldMs: hold * H },
    });
  }
  // (g) graduation window: enter 5-30 minutes after migration, stop 0.5% under the post-graduation low,
  // half at +20% and trail the rest, 3-hour hold. 6.
  // Stop as specified (0.5% under the post-graduation low, however wide) or capped at 20% below the fill. 12.
  for (const floor of [10_000, 25_000]) for (const trail of [0.08, 0.12, 0.15]) for (const cap of [null, 0.2]) {
    out.push({
      id: `g-grad-vol${floor / 1000}k-half20-trail${trail * 100}${cap ? "-cap20" : ""}`,
      family: "g",
      entry: { family: "graduation", minGradVolUsd: floor, gradMinMs: 5 * 60_000, gradMaxMs: 30 * 60_000 },
      exit: { useStructureStop: true, stopPct: 0.09, takeProfit: 0.2, scaleFraction: 0.5, trailActivate: 0.2, trailPct: trail, maxHoldMs: 3 * H, maxStructureStop: 0.99, ...(cap ? { capStructureStop: cap } : {}) },
    });
  }
  return out;
}

const BUCKET_SETS = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];

const tradeCache = new Map<string, SimTrade[]>();
function allTrades(tapes: Tape[], combo: Combo): SimTrade[] {
  const key = combo.id;
  const hit = tradeCache.get(key);
  if (hit) return hit;
  const trades: SimTrade[] = [];
  for (const tape of tapes) {
    for (const c of candidates(tape, combo.entry)) {
      const t = simulate(tape, c, combo.exit);
      if (t) trades.push(t);
      if (t && combo.entry.family === "graduation") break; // one entry per graduation
    }
  }
  tradeCache.set(key, trades);
  return trades;
}

function windowStats(tapes: Tape[], combo: Combo, from: number, until: number): { stats: Stats; trades: SimTrade[] } {
  const taken = admit(allTrades(tapes, combo), from, until);
  return { stats: stats(taken, (until - from) / DAY), trades: taken };
}

function pickOnTrain(rows: { combo: Combo; train: Stats }[], minTrain = 20): { combo: Combo; train: Stats } | null {
  for (const floor of [minTrain, 10]) {
    const ok = rows.filter((r) => r.train.trades >= floor);
    if (ok.length) return ok.reduce((best, r) => (r.train.dailyPct > best.train.dailyPct ? r : best));
  }
  return null;
}

function pct(v: number | null | undefined, d = 2): string {
  return v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`;
}
function usd(v: number): string {
  const s = Math.round(v);
  return `${s < 0 ? "−" : "+"}$${Math.abs(s).toLocaleString("en-US")}`;
}

function line(label: string, s: Stats): void {
  console.log(`${label} | 15d $10k ${usd(s.net15dOn10k)} | daily ${pct(s.dailyPct, 3)} | n ${s.trades} | hit ${pct(s.hitRate, 1)} | win ${pct(s.avgWinPct, 1)} | loss ${pct(s.avgLossPct, 1)} | mdd ${pct(s.maxDrawdownPct, 1)} | top3 ${pct(s.top3Share, 0)} | rugTrades ${s.ruggedTrades}`);
}

function main() {
  const tapes = loadTapes();
  const dayKeys = [...new Set(tapes.flatMap((t) => t.bars.map((b) => new Date(b.time).toISOString().slice(0, 10))))].sort();
  // Require a reasonably populated day: at least 8 pools with bars.
  const perDay = new Map<string, Set<string>>();
  for (const t of tapes) for (const b of t.bars) {
    const k = new Date(b.time).toISOString().slice(0, 10);
    if (!perDay.has(k)) perDay.set(k, new Set());
    perDay.get(k)!.add(t.pool);
  }
  const days = dayKeys.filter((k) => (perDay.get(k)?.size ?? 0) >= 8);
  const start = Date.parse(`${days[0]}T00:00:00Z`);
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`) + DAY;
  const nDays = Math.round((end - start) / DAY);
  const block = Math.floor(nDays / 4);
  const edges = [start, start + block * DAY, start + 2 * block * DAY, start + 3 * block * DAY, end];
  const folds = [1, 2, 3].map((k) => ({ trainFrom: start, trainUntil: edges[k], testFrom: edges[k], testUntil: edges[k + 1] }));
  const halfEdge = start + Math.ceil(nDays / 2) * DAY;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

  const combos = grid();
  const families = ["a", "b", "c", "d", "e"];
  const familyNames: Record<string, string> = {
    a: "(a) Pullback + volume/liquidity/age filters",
    b: "(b) Trailing stop",
    c: "(c) Scale out half, trail the rest",
    d: "(d) Early-pool volume acceleration",
    e: "(e) Flush bounce (mean reversion)",
    f: "(f) Time-of-day filter on the best train config",
    g: "(g) Graduation window (5-30 min after migration)",
  };
  let combosTried = combos.length;

  type FoldPick = { fold: number; id: string; train: Stats; test: Stats; trades: SimTrade[] };
  const results: Record<string, { picks: FoldPick[]; oos: Stats; oosTrades: SimTrade[]; finalId: string | null; half: { id: string; train: Stats; test: Stats; trades: SimTrade[] } | null; hindsight: { id: string; oos: Stats } | null }> = {};

  type Frame = { folds: typeof folds; start: number; end: number; halfEdge: number; oosFrom: number };
  const globalFrame: Frame = { folds, start, end, halfEdge, oosFrom: edges[1] };
  const evaluateFamily = (fam: string, pool: Combo[], F: Frame = globalFrame) => {
    const { folds, start, end, halfEdge } = F;
    const picks: FoldPick[] = [];
    for (const [i, f] of folds.entries()) {
      const rows = pool.map((combo) => ({ combo, train: windowStats(tapes, combo, f.trainFrom, f.trainUntil).stats }));
      const best = pickOnTrain(rows);
      if (!best) continue;
      const test = windowStats(tapes, best.combo, f.testFrom, f.testUntil);
      picks.push({ fold: i + 1, id: best.combo.id, train: best.train, test: test.stats, trades: test.trades });
    }
    const oosTrades = picks.flatMap((p) => p.trades);
    const oosDays = picks.reduce((s, p) => s + p.test.days, 0);
    // Half split (comparable to earlier reports).
    const halfRows = pool.map((combo) => ({ combo, train: windowStats(tapes, combo, start, halfEdge).stats }));
    const hb = pickOnTrain(halfRows);
    const half = hb ? { id: hb.combo.id, train: hb.train, ...(() => { const w = windowStats(tapes, hb.combo, halfEdge, end); return { test: w.stats, trades: w.trades }; })() } : null;
    // Hindsight: best stitched OOS if one combo were fixed for all folds. Flagged as selection bias.
    let hindsight: { id: string; oos: Stats } | null = null;
    for (const combo of pool) {
      const tr = folds.flatMap((f) => windowStats(tapes, combo, f.testFrom, f.testUntil).trades);
      const s = stats(tr, (end - F.oosFrom) / DAY);
      if (s.trades >= 30 && (!hindsight || s.dailyPct > hindsight.oos.dailyPct)) hindsight = { id: combo.id, oos: s };
    }
    results[fam] = { picks, oos: stats(oosTrades, oosDays), oosTrades, finalId: picks[picks.length - 1]?.id ?? null, half, hindsight };
  };

  // (g) runs first on its own frame: graduation-observable tapes, folds cut at graduation-count quartiles (strict time order).
  const gradTimes = tapes
    .filter((t) => t.graduatedMs != null && Math.abs(t.bars[0].time - (t.graduatedMs as number)) <= 10 * 60_000)
    .map((t) => t.graduatedMs as number)
    .sort((a, b) => a - b);
  let gradFrame: Frame | null = null;
  if (gradTimes.length >= 20) {
    const q = (f: number) => Math.round(gradTimes[Math.floor(f * (gradTimes.length - 1))] / H) * H;
    const gStart = Math.floor(gradTimes[0] / H) * H;
    const gEnd = Math.ceil((gradTimes[gradTimes.length - 1] + 4 * H) / H) * H;
    const ge = [gStart, q(0.25), q(0.5), q(0.75), gEnd];
    gradFrame = {
      folds: [1, 2, 3].map((k) => ({ trainFrom: gStart, trainUntil: ge[k], testFrom: ge[k], testUntil: ge[k + 1] })),
      start: gStart,
      end: gEnd,
      halfEdge: q(0.5),
      oosFrom: ge[1],
    };
    evaluateFamily("g", combos.filter((c) => c.family === "g"), gradFrame);
  }
  for (const fam of families) evaluateFamily(fam, combos.filter((c) => c.family === fam));

  // (f) time-of-day: take the combo with the best train result over all families on the last fold's train window, then try 7 bucket sets on train only.
  const lastTrain = folds[2];
  const bestAll = pickOnTrain(combos.filter((c) => c.family !== "g").map((combo) => ({ combo, train: windowStats(tapes, combo, lastTrain.trainFrom, lastTrain.trainUntil).stats })));
  if (bestAll) {
    const fCombos: Combo[] = BUCKET_SETS.map((set) => ({
      id: `f-${bestAll.combo.id}-utc${set.map((b) => `${b * 8}-${b * 8 + 8}`).join("+")}`,
      family: "f",
      entry: { ...bestAll.combo.entry, hourBuckets: set },
      exit: bestAll.combo.exit,
    }));
    combosTried += fCombos.length;
    evaluateFamily("f", fCombos);
  }

  // Baseline (not in grid): classic breakout +20%.
  const classic: Combo = { id: "baseline-breakout-tp20", family: "base", entry: BREAKOUT, exit: { stopPct: 0.09, takeProfit: 0.2, maxHoldMs: 3 * H } };
  const baseTrades = folds.flatMap((f) => windowStats(tapes, classic, f.testFrom, f.testUntil).trades);
  const baseline = stats(baseTrades, (end - edges[1]) / DAY);

  const rugged = tapes.filter((t) => t.rugged);
  const summary = {
    generatedAt: new Date().toISOString(),
    pools: tapes.length,
    ruggedPools: rugged.length,
    ruggedSymbols: rugged.map((t) => t.symbol),
    days: { from: iso(start), until: iso(end - DAY), count: nDays },
    folds: folds.map((f) => ({ train: `${iso(f.trainFrom)}..${iso(f.trainUntil - DAY)}`, test: `${iso(f.testFrom)}..${iso(f.testUntil - DAY)}` })),
    halfSplit: { train: `${iso(start)}..${iso(halfEdge - DAY)}`, test: `${iso(halfEdge)}..${iso(end - DAY)}` },
    combosTried,
    baseline,
    families: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
      name: familyNames[k],
      picks: v.picks.map((p) => ({ fold: p.fold, id: p.id, train: p.train, test: p.test })),
      oos: v.oos,
      finalId: v.finalId,
      half: v.half ? { id: v.half.id, train: v.half.train, test: v.half.test } : null,
      hindsight: v.hindsight,
      topTrades: [...v.oosTrades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(0, 5).map((t) => ({ symbol: t.symbol, rugged: t.rugged, entry: new Date(t.entryTime).toISOString(), pnlUsd: Number(t.pnlUsd.toFixed(2)), pnlPct: Number(t.pnlPct.toFixed(4)), reason: t.reason })),
      exTop3: (() => { const rest = [...v.oosTrades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(3); return stats(rest, v.oos.days); })(),
      medianTradePct: (() => { const xs = v.oosTrades.map((t) => t.pnlPct).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; })(),
      reasons: v.oosTrades.reduce<Record<string, number>>((acc, t) => { acc[t.reason] = (acc[t.reason] ?? 0) + 1; return acc; }, {}),
    }])),
    allCombos: combos.map((c) => c.id),
    graduation: gradFrame ? {
      observable: gradTimes.length,
      from: new Date(gradFrame.start).toISOString(),
      until: new Date(gradFrame.end).toISOString(),
      folds: gradFrame.folds.map((f) => ({ train: `${new Date(f.trainFrom).toISOString()}..${new Date(f.trainUntil).toISOString()}`, test: `${new Date(f.testFrom).toISOString()}..${new Date(f.testUntil).toISOString()}` })),
    } : null,
  };
  // Survivorship check for (g): pool lists were pulled on 10-11 Nov, so graduations from the last 36 hours
  // were found because they are busy now. Older graduations are less tied to that filter.
  if (results.g) {
    const cut = (gradFrame?.end ?? end) - 40 * H;
    const recent = results.g.oosTrades.filter((t) => t.entryTime >= cut);
    const older = results.g.oosTrades.filter((t) => t.entryTime < cut);
    const recentDays = ((gradFrame?.end ?? end) - Math.max(cut, gradFrame?.oosFrom ?? cut)) / DAY;
    const olderDays = (Math.max(cut, gradFrame?.oosFrom ?? cut) - (gradFrame?.oosFrom ?? cut)) / DAY;
    (summary as Record<string, unknown>).graduationSurvivorship = {
      cutoff: new Date(cut).toISOString(),
      recent: stats(recent, recentDays),
      older: stats(older, olderDays),
    };
    line("g OOS, graduations in the last 40h (list-selected)", stats(recent, recentDays));
    line("g OOS, older graduations", stats(older, olderDays));
  }
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(`pools ${tapes.length} rugged ${rugged.length} days ${iso(start)}..${iso(end - DAY)} combos ${combosTried}`);
  console.log(`folds ${JSON.stringify(summary.folds)}`);
  line("baseline breakout tp20 (WF OOS)", baseline);
  for (const [k, v] of Object.entries(results)) {
    line(`${k} WF OOS`, v.oos);
    line(`   ${k} WF OOS without top 3 trades`, stats([...v.oosTrades].sort((a, b) => b.pnlUsd - a.pnlUsd).slice(3), v.oos.days));
    for (const p of v.picks) console.log(`   fold${p.fold} pick ${p.id} train ${pct(p.train.dailyPct, 3)} n${p.train.trades} -> test ${pct(p.test.dailyPct, 3)} n${p.test.trades}`);
    if (v.half) line(`   half-split pick ${v.half.id} test`, v.half.test);
    if (v.hindsight) line(`   HINDSIGHT (selection bias) ${v.hindsight.id}`, v.hindsight.oos);
  }
}

main();
