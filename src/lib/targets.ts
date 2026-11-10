import { dubaiDayKey, dubaiMonthKey } from "./time";

export type BandOutcome = "below" | "inside" | "above";

export function bandOutcome(value: number, low: number, high: number): BandOutcome {
  if (value < low) return "below";
  if (value > high) return "above";
  return "inside";
}

export interface DailyRow {
  day: string;
  pnl: number;
  returnOnPrincipal: number;
  equity: number;
  outcome: BandOutcome;
}

export interface DailyTargetReport {
  days: number;
  insideBand: number;
  aboveBand: number;
  belowBand: number;
  /** Share of days whose P&L / principal landed inside the band. Days above the band are not hits. */
  hitRate: number;
  /** Share of days at or above the lower edge, including days that overshot the band. */
  floorRate: number;
  averageReturn: number;
  medianReturn: number;
  bestDay: number;
  worstDay: number;
  rows: DailyRow[];
}

export function classifyDailyTarget(
  points: { time: number; equity: number }[],
  initialEquity: number,
  principal: number,
  band: { low: number; high: number },
): DailyTargetReport {
  const byDay = new Map<string, number>();
  const ordered = [...points].sort((a, b) => a.time - b.time);
  for (const point of ordered) {
    byDay.set(dubaiDayKey(new Date(point.time)), point.equity);
  }
  const rows: DailyRow[] = [];
  let prev = initialEquity;
  for (const [day, equity] of byDay) {
    const pnl = equity - prev;
    const returnOnPrincipal = principal > 0 ? pnl / principal : 0;
    rows.push({
      day,
      pnl,
      returnOnPrincipal,
      equity,
      outcome: bandOutcome(returnOnPrincipal, band.low, band.high),
    });
    prev = equity;
  }
  const returns = rows.map((row) => row.returnOnPrincipal);
  const sorted = [...returns].sort((a, b) => a - b);
  const mid = sorted.length === 0 ? 0 : sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const insideBand = rows.filter((row) => row.outcome === "inside").length;
  const aboveBand = rows.filter((row) => row.outcome === "above").length;
  const belowBand = rows.filter((row) => row.outcome === "below").length;
  const days = rows.length;
  return {
    days,
    insideBand,
    aboveBand,
    belowBand,
    hitRate: days ? insideBand / days : 0,
    floorRate: days ? (insideBand + aboveBand) / days : 0,
    averageReturn: days ? returns.reduce((s, n) => s + n, 0) / days : 0,
    medianReturn: mid,
    bestDay: days ? Math.max(...returns) : 0,
    worstDay: days ? Math.min(...returns) : 0,
    rows,
  };
}

export interface MonthRow {
  month: string;
  pnl: number;
  returnPct: number;
  onPrincipal: number;
}

export function monthlyReturns(
  points: { time: number; equity: number }[],
  initialEquity: number,
  principal: number,
): MonthRow[] {
  const byMonth = new Map<string, number>();
  const ordered = [...points].sort((a, b) => a.time - b.time);
  for (const point of ordered) {
    byMonth.set(dubaiMonthKey(new Date(point.time)), point.equity);
  }
  const rows: MonthRow[] = [];
  let prev = initialEquity;
  for (const [month, equity] of byMonth) {
    const pnl = equity - prev;
    rows.push({
      month,
      pnl,
      returnPct: prev > 0 ? pnl / prev : 0,
      onPrincipal: principal > 0 ? pnl / principal : 0,
    });
    prev = equity;
  }
  return rows;
}

export function maxDrawdown(equities: number[]): number {
  let peak = equities[0] ?? 0;
  let max = 0;
  for (const equity of equities) {
    if (equity > peak) peak = equity;
    if (peak > 0) max = Math.max(max, (peak - equity) / peak);
  }
  return max;
}

export function sharpeRatio(equities: number[], barsPerYear: number): number {
  if (equities.length < 3 || !(barsPerYear > 0)) return 0;
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i += 1) {
    const prev = equities[i - 1];
    if (prev > 0) returns.push(equities[i] / prev - 1);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, n) => s + n, 0) / returns.length;
  const variance = returns.reduce((s, n) => s + (n - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(barsPerYear);
}
