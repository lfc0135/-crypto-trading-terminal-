"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LineChart } from "@/components/charts";
import { Badge } from "@/components/ui";
import { pct, price, usd } from "@/lib/format";

interface Dash {
  principal: number;
  cash: number;
  equity: number;
  unrealized: number;
  realizedToday: number;
  realizedMonth: number;
  realizedDayReturn: number;
  realizedMonthReturn: number;
  mtmDayPnl: number;
  mtmDayReturn: number;
  drawdownPct: number;
  dailyLossPct: number;
  dayOutcome: "below" | "inside" | "above";
  monthOutcome: "below" | "inside" | "above";
  targets: { dailyLow: number; dailyHigh: number; monthlyLow: number; monthlyHigh: number; monthlyFollowsDaily: boolean };
  limits: { maxLeverage: number; maxPositionPct: number; maxDailyLossPct: number };
  kills: { daily: boolean; drawdown: boolean };
  review: { eligible: boolean; streak: number; requiredMonths: number; reasons: string[] };
  illustration: { dollarsToDailyLow: number; dollarsToDailyHigh: number; maxPositionUsd: number; moveOnFullPosition: number | null; dailyLossUsd: number; perTradeUsd: number };
  positions: { id: string; symbol: string; qty: number; avgPrice: number; mark: number; unrealized: number; positionPct: number; stopLoss: number | null; takeProfit: number | null; stale: boolean }[];
  recentFills: { id: string; symbol: string; side: string; qty: number; price: number; realizedPnl: number; note: string }[];
  equityCurve: { ts: number; equity: number }[];
}

const outcomeCopy = {
  below: "Below the band",
  inside: "Inside the band",
  above: "Above the band",
};

export default function DashboardPage() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Dashboard failed");
        if (!stop) {
          setData(body);
          setError(null);
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Dashboard failed");
      }
    };
    void load();
    const id = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (!data && !error) return <div className="panel h-40 animate-pulse" />;
  if (!data) return <div className="panel p-5 text-sm text-[var(--down)]">{error}</div>;

  const low = data.targets.dailyLow;
  const high = data.targets.dailyHigh;
  const scale = Math.max(high * 2, 0.06, data.realizedDayReturn);
  const marker = (value: number) => `${Math.max(0, Math.min(1, value / scale)) * 100}%`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paper book</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Local spot simulation marked to public OKX prices. The 2–3% daily band is the scoreboard you set. It is not a forecast, and the risk limits are deliberately tighter than that band.
          </p>
        </div>
        <Link href="/trade" className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)]">New paper order</Link>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <Stat label="Equity" value={usd(data.equity)} detail={`${usd(data.cash)} cash`} />
        <Stat label="Realized today" value={pct(data.realizedDayReturn)} detail={`${usd(data.realizedToday)} on ${usd(data.principal, 0)} principal`} tone={data.realizedToday} />
        <Stat label="Mark-to-market today" value={pct(data.mtmDayReturn)} detail={usd(data.mtmDayPnl)} tone={data.mtmDayPnl} />
        <Stat label="Drawdown" value={pct(-data.drawdownPct)} detail={data.kills.drawdown ? "Switch on" : "Inside limit"} tone={data.kills.drawdown ? -1 : 0} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Equity</h2>
            <span className="text-xs text-[var(--muted)]">Principal {usd(data.principal, 0)}</span>
          </div>
          {data.equityCurve.length > 1 ? (
            <LineChart points={data.equityCurve.map((point) => ({ time: point.ts, value: point.equity }))} />
          ) : (
            <div className="flex h-[260px] items-center justify-center text-sm text-[var(--muted)]">The curve starts flat at {usd(data.principal, 0)}. It moves when the book does.</div>
          )}
        </div>
        <div className="panel p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Realized daily return vs target</h2>
            <Badge tone={data.dayOutcome === "below" ? "down" : data.dayOutcome === "inside" ? "accent" : "up"}>{outcomeCopy[data.dayOutcome]}</Badge>
          </div>
          <div className="num mt-3 text-3xl">{pct(data.realizedDayReturn)}</div>
          <p className="mt-1 text-xs text-[var(--muted)]">Closed-trade P&amp;L today ÷ {usd(data.principal, 0)} principal. Open P&amp;L is the separate mark-to-market figure.</p>
          <div className="relative mt-5 h-2 rounded-full bg-black/40">
            <div className="absolute inset-y-0 rounded-full bg-[var(--accent)]/30" style={{ left: marker(low), width: `calc(${marker(high)} - ${marker(low)})` }} />
            <div className="absolute -top-1 h-4 w-0.5 bg-[var(--text)]" style={{ left: marker(Math.max(0, data.realizedDayReturn)) }} />
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-[var(--muted)]">
            <span>0</span>
            <span>{pct(low)} – {pct(high)}</span>
            <span>{pct(scale)}</span>
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            A {pct(low)} day on principal is {usd(data.illustration.dollarsToDailyLow)} to {usd(data.illustration.dollarsToDailyHigh)}. The notional cap at {data.limits.maxLeverage}× is {usd(data.illustration.maxPositionUsd)}, so a full position has to move about {data.illustration.moveOnFullPosition == null ? "—" : pct(data.illustration.moveOnFullPosition)} to produce the low end of the band, before fees and borrow. The daily loss stop is {usd(data.illustration.dailyLossUsd)} ({pct(data.limits.maxDailyLossPct)}). Per-trade risk is {usd(data.illustration.perTradeUsd)}.
          </p>
          <p className="mt-3 text-sm leading-6">
            Month realized {pct(data.realizedMonthReturn)} ({usd(data.realizedMonth)}). {data.targets.monthlyFollowsDaily ? "The monthly band follows the daily one, compounded for 30 days" : "Custom monthly band"}: {pct(data.targets.monthlyLow)} to {pct(data.targets.monthlyHigh)}. That month figure is the arithmetic consequence of repeating the daily band. It is not an operating plan. Status: {outcomeCopy[data.monthOutcome].toLowerCase()}.
          </p>
        </div>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Isolated margin, cap {data.limits.maxLeverage}×</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              OKX paper buys use isolated margin at the cap, and 2× is the hard ceiling. You post notional divided by leverage and borrow the rest. USDT borrow accrues at the OKX public daily rate. A 2× long liquidates just under a 50% drop, and a stop at or below that price is refused. On-chain orders stay at 1×. Daily-loss and drawdown switches are unchanged. The old review bar is {data.review.streak}/{data.review.requiredMonths}. It does not raise the ceiling.
            </p>
          </div>
          <Badge tone={data.review.eligible ? "accent" : "neutral"}>{data.review.eligible ? "Review open" : "Review closed"}</Badge>
        </div>
      </section>

      <section className="panel overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-medium">Positions</h2>
        {data.positions.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No open positions. The {usd(data.principal, 0)} principal is in cash.</p>
        ) : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="py-2 font-medium">Symbol</th>
                <th className="font-medium">Qty</th>
                <th className="font-medium">Avg</th>
                <th className="font-medium">Mark</th>
                <th className="font-medium">Unrealized</th>
                <th className="font-medium">% equity</th>
                <th className="font-medium">Stop / target</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map((position) => (
                <tr key={position.id} className="border-t border-[var(--line)]">
                  <td className="py-2">{position.symbol}{position.stale ? " · stale" : ""}</td>
                  <td className="num">{position.qty}</td>
                  <td className="num">{price(position.avgPrice)}</td>
                  <td className="num">{price(position.mark)}</td>
                  <td className={`num ${position.unrealized >= 0 ? "up" : "down"}`}>{usd(position.unrealized)}</td>
                  <td className="num">{(position.positionPct * 100).toFixed(2)}%</td>
                  <td className="num text-[var(--muted)]">{position.stopLoss ? price(position.stopLoss) : "—"} / {position.takeProfit ? price(position.takeProfit) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, detail, tone = 0 }: { label: string; value: string; detail: string; tone?: number }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`num mt-2 text-2xl ${tone > 0 ? "up" : tone < 0 ? "down" : ""}`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">{detail}</div>
    </div>
  );
}
