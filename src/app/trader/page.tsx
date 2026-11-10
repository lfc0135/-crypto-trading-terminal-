"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { pct, usd } from "@/lib/format";

interface Assignment {
  symbol: string;
  strategyId: string;
  bar: string;
  armed: boolean;
  note: string;
  filters: { trend: boolean; volatility: boolean; trail: boolean };
}

interface Summary {
  day: string;
  realizedPnl: number;
  realizedReturn: number;
  mtmPnl: number;
  trades: number;
  drawdown: number;
  insideBand: boolean;
  targetLow: number;
  targetHigh: number;
  traderEnabled: boolean;
  assignments: Assignment[];
  lastError: string | null;
}

export default function TraderPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/summary", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Summary failed");
    setData(body);
  }

  useEffect(() => {
    let stop = false;
    void fetch("/api/summary", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (stop || body.error) return;
        setData(body);
      })
      .catch((err) => {
        if (!stop) setError(err instanceof Error ? err.message : "Summary failed");
      });
    const id = setInterval(() => { void load().catch(() => undefined); }, 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  async function setEnabled(enabled: boolean) {
    const res = await fetch("/api/trader", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const body = await res.json();
    if (!res.ok) setError(body.error || "Could not update the auto-trader");
    else await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Auto-trader</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Paper book only. Each new closed candle is evaluated with the train-selected config. Orders go through the same risk engine, including stops, the Dubai flatten on intraday strategies, and the kill switches. Live routing is not used.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={() => setEnabled(true)} disabled={data?.traderEnabled}>Start paper</Button>
          <Button type="button" variant="outline" onClick={() => setEnabled(false)} disabled={!data?.traderEnabled}>Stop</Button>
        </div>
      </div>
      {error && <div className="panel p-3 text-sm text-[var(--down)]">{error}</div>}
      {data && (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <Card label="Today vs 2–3%" value={pct(data.realizedReturn)} detail={data.insideBand ? "Inside the band" : "Outside the band"} />
            <Card label="Realized today" value={usd(data.realizedPnl)} detail={`${data.trades} fills`} />
            <Card label="Mark-to-market" value={usd(data.mtmPnl)} detail={data.day} />
            <Card label="Drawdown" value={pct(-data.drawdown)} detail={data.traderEnabled ? "Trader on" : "Trader off"} />
          </section>
          {data.lastError && <p className="text-sm text-[var(--down)]">{data.lastError}</p>}
          <div className="panel overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-medium">Active configs</h2>
            {data.assignments.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No configs yet. Run the walk-forward sweep on the Tuning page. Only rows that pass the out-of-sample gates are armed.</p>
            ) : (
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr><th className="py-2">Symbol</th><th>Strategy</th><th>Bar</th><th>Filters</th><th>Armed</th><th>Note</th></tr>
                </thead>
                <tbody>
                  {data.assignments.map((row) => (
                    <tr key={`${row.symbol}-${row.strategyId}-${row.bar}`} className="border-t border-[var(--line)]">
                      <td className="py-2">{row.symbol}</td>
                      <td>{row.strategyId}</td>
                      <td>{row.bar}</td>
                      <td className="text-xs text-[var(--muted)]">{[row.filters.trend && "trend", row.filters.volatility && "vol", row.filters.trail && "trail"].filter(Boolean).join(", ") || "none"}</td>
                      <td>{row.armed ? <Badge tone="up">paper</Badge> : <Badge tone="neutral">off</Badge>}</td>
                      <td className="text-xs text-[var(--muted)]">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase text-[var(--muted)]">{label}</div>
      <div className="num mt-2 text-2xl">{value}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">{detail}</div>
    </div>
  );
}
