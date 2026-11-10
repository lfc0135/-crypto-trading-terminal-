import { completedDubaiMonths, dubaiMonthKey } from "../time";
import type { Fill } from "../types";

export interface LeverageReview {
  eligible: boolean;
  streak: number;
  requiredMonths: number;
  observedDrawdownPct: number;
  drawdownLimitPct: number;
  reasons: string[];
  completedMonths: string[];
}

export function leverageReview(input: {
  createdAt: number;
  now: number;
  fills: Pick<Fill, "ts" | "realizedPnl">[];
  observedDrawdownPct: number;
  drawdownLimitPct: number;
  drawdownKillEver: boolean;
  requiredMonths: number;
}): LeverageReview {
  const months = completedDubaiMonths(input.createdAt, input.now);
  const pnl = new Map<string, number>();
  for (const month of months) pnl.set(month, 0);
  for (const fill of input.fills) {
    const month = dubaiMonthKey(new Date(fill.ts));
    if (!pnl.has(month)) continue;
    pnl.set(month, (pnl.get(month) ?? 0) + fill.realizedPnl);
  }
  let streak = 0;
  for (let i = months.length - 1; i >= 0; i -= 1) {
    if ((pnl.get(months[i]) ?? 0) > 0) streak += 1;
    else break;
  }
  const reasons: string[] = [];
  if (months.length < input.requiredMonths) {
    reasons.push(
      `Needs ${input.requiredMonths} completed Dubai months on this paper book. ${months.length} finished so far. The month the book was opened, and the current month, do not count.`,
    );
  } else if (streak < input.requiredMonths) {
    reasons.push(
      `The latest streak of profitable completed months is ${streak}. The review asks for ${input.requiredMonths} in a row. A flat month counts as a miss.`,
    );
  }
  if (input.drawdownKillEver) {
    reasons.push("The drawdown kill switch has tripped on this book. That keeps the review closed.");
  }
  if (input.observedDrawdownPct > input.drawdownLimitPct + 1e-12) {
    reasons.push(
      `Observed peak-to-trough drawdown is ${(input.observedDrawdownPct * 100).toFixed(2)}%, past the ${(input.drawdownLimitPct * 100).toFixed(2)}% limit.`,
    );
  }
  return {
    eligible: reasons.length === 0,
    streak,
    requiredMonths: input.requiredMonths,
    observedDrawdownPct: input.observedDrawdownPct,
    drawdownLimitPct: input.drawdownLimitPct,
    reasons,
    completedMonths: months,
  };
}
