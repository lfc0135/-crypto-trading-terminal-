/** Read-only results for the graduation-window paper account. Usage: npx tsx scripts/graduation-report.ts [YYYY-MM-DD Dubai day] */
import fs from "node:fs";
import { JOURNAL, PRINCIPAL_USD, loadState } from "../src/lib/onchain/graduation-live";

const dubaiDay = (ms: number) => new Date(ms + 4 * 3_600_000).toISOString().slice(0, 10);
const dubaiTime = (ms: number) => new Date(ms + 4 * 3_600_000).toISOString().slice(11, 16);
const usd = (v: number) => `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(2)}`;
const day = process.argv[2] ?? dubaiDay(Date.now());
const s = loadState();
const events = fs.existsSync(JOURNAL) ? fs.readFileSync(JOURNAL, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
const todays = events.filter((e) => dubaiDay(Date.parse(String(e.ts))) === day);
const count = (ev: string) => todays.filter((e) => e.event === ev).length;
const closedToday = s.closed.filter((t) => dubaiDay(t.exitTime) === day);
const realizedToday = closedToday.reduce((a, t) => a + t.pnlUsd, 0);
const realizedAll = s.closed.reduce((a, t) => a + t.pnlUsd, 0);
const openMark = s.positions.reduce((a, p) => a + (p.lastMarkUsd ?? 0), 0);
const scale = 10_000 / PRINCIPAL_USD;
const days = Math.max(1 / 24, (Date.now() - s.startedAt) / 86_400_000);
console.log(`Graduation window paper account (${s.rule}), Dubai day ${day}`);
console.log(`Net after costs today, on $10,000: ${usd((realizedToday + openMark) * scale)} (realized ${usd(realizedToday)}, open positions marked ${usd(openMark)})`);
console.log(`Since start ${new Date(s.startedAt + 4 * 3_600_000).toISOString().slice(0, 16).replace("T", " ")} Dubai: realized ${usd(realizedAll)}, equity $${(PRINCIPAL_USD + realizedAll + openMark).toFixed(2)}, ${s.closed.length} closed trades over ${days.toFixed(2)} days`);
console.log(`Today: graduations seen ${count("graduation")}, entries ${count("entry")}, scale-outs ${count("scale-out")}, exits ${count("exit")}, skips ${count("skip")}, voided ${count("void")}, errors ${count("error")}`);
console.log(`Detection health: cycles ${s.stats.cycles}, GMGN ok ${s.stats.gmgnOk} / 429 ${s.stats.gmgn429}, GeckoTerminal ok ${s.stats.geckoOk} / 429 ${s.stats.gecko429}, last cycle ${s.stats.lastCycleAt ? dubaiTime(s.stats.lastCycleAt) + " Dubai" : "never"}`);
if (closedToday.length) {
  const wins = closedToday.filter((t) => t.pnlUsd > 0).length;
  console.log(`Closed today: ${closedToday.length}, hit rate ${((wins / closedToday.length) * 100).toFixed(0)}%`);
  for (const t of closedToday) console.log(`  ${t.symbol.padEnd(12)} in ${dubaiTime(t.fillTime)} out ${dubaiTime(t.exitTime)} ${t.reason.padEnd(12)} ${usd(t.pnlUsd)} (${(t.pnlPct * 100).toFixed(1)}%)`);
}
for (const p of s.positions) console.log(`  OPEN ${p.symbol} since ${dubaiTime(p.fillTime)} Dubai, mark ${p.lastMarkUsd != null ? usd(p.lastMarkUsd) : "n/a"}`);
