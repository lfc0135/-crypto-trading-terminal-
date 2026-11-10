"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";

interface Row {
  symbol: string;
  strategyId: string;
  bar: string;
  filters: { trend: boolean; volatility: boolean; trail: boolean };
  train: { trades: number; expectancy: number };
  test: { trades: number; expectancy: number; totalReturnPct: number; maxDrawdownPct: number; sharpe: number; hitRate: number } | null;
  armed: boolean;
  rejectReason: string | null;
  selected: boolean;
}

export default function TuningPage() {
  const [note, setNote] = useState<string>("No sweep yet.");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/tuning", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Could not load tuning results");
    setRunning(Boolean(body.running));
    setNote(body.result?.note ?? "No sweep yet. Run one to fill this table. It uses closed OKX candles and does not place orders.");
    setRows(body.result?.rows ?? []);
  }

  useEffect(() => {
    let stop = false;
    void fetch("/api/tuning", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (stop) return;
        setRunning(Boolean(body.running));
        setNote(body.result?.note ?? "No sweep yet. Run one to fill this table. It uses closed OKX candles and does not place orders.");
        setRows(body.result?.rows ?? []);
      })
      .catch((err) => {
        if (!stop) setError(err instanceof Error ? err.message : "Load failed");
      });
    return () => {
      stop = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tuning</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Train is 2021–2022. The table is 2023 through the latest bar, plus a 2022 holdout. Maker entries, taker stops, and a 3× cost gate. Longs only when BTC is above its 200-day average. A thin sample, a negative training result, a 2022 window that never traded, or a drawdown over 25% stays unarmed. The 2–3% day is a scoreboard, not a fit target.
          </p>
        </div>
        <Button type="button" disabled={running} onClick={async () => {
          setRunning(true);
          setError(null);
          const res = await fetch("/api/tuning", { method: "POST" });
          const body = await res.json();
          if (!res.ok) setError(body.error || "Sweep failed to start");
          window.setTimeout(() => { void load().catch(() => undefined); }, 4000);
        }}>{running ? "Sweep running" : "Run walk-forward sweep"}</Button>
      </div>
      {error && <div className="panel p-3 text-sm text-[var(--down)]">{error}</div>}
      <p className="text-sm text-[var(--muted)]">{note}</p>
      <div className="panel overflow-x-auto p-4">
        {rows.length === 0 ? <p className="text-sm text-[var(--muted)]">The results table is empty.</p> : (
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="py-2">Symbol</th>
                <th>Strategy</th>
                <th>Bar</th>
                <th>Filters</th>
                <th>OOS trades</th>
                <th>OOS return</th>
                <th>OOS max DD</th>
                <th>Sharpe</th>
                <th>Hit rate</th>
                <th>Armed</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.symbol}-${row.strategyId}-${row.bar}`} className="border-t border-[var(--line)]">
                  <td className="py-2">{row.symbol}</td>
                  <td>{row.strategyId}</td>
                  <td>{row.bar}</td>
                  <td className="text-xs text-[var(--muted)]">{[row.filters.trend && "trend", row.filters.volatility && "vol", row.filters.trail && "trail"].filter(Boolean).join(", ") || "none"}</td>
                  <td className="num">{row.test?.trades ?? "—"}</td>
                  <td className="num">{row.test ? `${(row.test.totalReturnPct * 100).toFixed(2)}%` : "—"}</td>
                  <td className="num">{row.test ? `${(row.test.maxDrawdownPct * 100).toFixed(2)}%` : "—"}</td>
                  <td className="num">{row.test && row.strategyId !== "cross-section" ? row.test.sharpe.toFixed(2) : "—"}</td>
                  <td className="num">{row.test && row.strategyId !== "cross-section" ? `${(row.test.hitRate * 100).toFixed(1)}%` : "—"}</td>
                  <td>{row.armed ? <Badge tone="up">yes</Badge> : <Badge tone="neutral">no</Badge>}</td>
                  <td className="max-w-sm text-xs text-[var(--muted)]">{row.rejectReason ?? "passed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
