"use client";

import { useEffect, useState } from "react";
import { LineChart } from "@/components/charts";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { pct, pctPlain, usd } from "@/lib/format";

interface Spec { key: string; label: string; min: number; max: number; step: number; default: number }
interface Strategy { id: string; name: string; description: string; timeframes: string[]; params: Spec[] }
interface DailyRow { day: string; returnOnPrincipal: number; pnl: number; outcome: string }
interface Result {
  strategy: { name: string; description: string };
  instId: string;
  bar: string;
  result: {
    candles: number;
    endingEquity: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    sharpeNote: string;
    winRate: number;
    closedTrades: number;
    profitFactor: number | null;
    feesPaid: number;
    rejectedEntries: number;
    assumptions: string[];
    daily: { days: number; insideBand: number; aboveBand: number; belowBand: number; hitRate: number; floorRate: number; averageReturn: number; medianReturn: number; rows: DailyRow[] };
    monthlyReturns: { month: string; returnPct: number; pnl: number; onPrincipal: number }[];
    equityCurve: { time: number; equity: number }[];
    trades: { entryTime: number; exitTime: number; pnl: number; reason: string; qty: number }[];
  };
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [id, setId] = useState("session-breakout");
  const [instId, setInstId] = useState("BTC-USDT");
  const [bar, setBar] = useState("15m");
  const [limit, setLimit] = useState("400");
  const [params, setParams] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Result | null>(null);

  useEffect(() => {
    void fetch("/api/strategies").then((res) => res.json()).then((body) => {
      setStrategies(body.strategies ?? []);
    });
  }, []);

  const strategy = strategies.find((item) => item.id === id) ?? strategies[0];

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategyId: id, instId, bar, limit: Number(limit), params }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Backtest failed");
      setReport(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setBusy(false);
    }
  }

  const daily = report?.result.daily;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Strategies</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Four spot strategies, two of them intraday and flat by the Dubai close. Fills are the next bar’s open. Fees and slippage are on. The same risk engine sizes and can reject entries. The number that matters here is how often a day actually landed inside the 2–3% band. These rules are not fitted to that band.
        </p>
      </div>
      <div className="panel grid gap-3 p-4 md:grid-cols-4">
        <Field label="Strategy">
          <Select value={id} onChange={(event) => { setId(event.target.value); setParams({}); }}>
            {strategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>
        <Field label="Pair">
          <Input value={instId} onChange={(event) => setInstId(event.target.value.toUpperCase())} />
        </Field>
        <Field label="Bar">
          <Select value={bar} onChange={(event) => setBar(event.target.value)}>
            {(strategy?.timeframes ?? ["15m"]).map((item) => <option key={item}>{item}</option>)}
            {!strategy?.timeframes.includes(bar) && <option>{bar}</option>}
          </Select>
        </Field>
        <Field label="Closed candles">
          <Input value={limit} onChange={(event) => setLimit(event.target.value)} />
        </Field>
        {strategy?.params.map((spec) => (
          <Field key={spec.key} label={spec.label}>
            <Input
              type="number"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={params[spec.key] ?? spec.default}
              onChange={(event) => setParams({ ...params, [spec.key]: Number(event.target.value) })}
            />
          </Field>
        ))}
        <div className="md:col-span-4">
          <p className="mb-3 text-sm text-[var(--muted)]">{strategy?.description}</p>
          <Button type="button" disabled={busy} onClick={run}>{busy ? "Running on OKX candles" : "Run backtest"}</Button>
        </div>
      </div>
      {error && <div className="panel p-4 text-sm text-[var(--down)]">{error}</div>}
      {report && daily && (
        <div className="space-y-4">
          <section className="panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-medium">{report.strategy.name} · {report.instId} · {report.bar}</h2>
              <Badge tone={daily.insideBand > 0 ? "accent" : "neutral"}>{daily.insideBand} of {daily.days} days inside the band</Badge>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Hit rate {pctPlain(daily.hitRate)} means the day’s mark-to-market P&amp;L divided by starting principal sat inside the band. Days above the band ({daily.aboveBand}) are not counted as hits. Days below ({daily.belowBand}), including flat days, are misses. Average day {pct(daily.averageReturn)}. Median {pct(daily.medianReturn)}. Reaching the 2% floor at least once happened on {pctPlain(daily.floorRate)} of days.
            </p>
          </section>
          <section className="grid gap-3 md:grid-cols-5">
            <Mini label="Return" value={pct(report.result.totalReturnPct)} />
            <Mini label="Max drawdown" value={pct(-report.result.maxDrawdownPct)} />
            <Mini label="Sharpe" value={report.result.sharpe.toFixed(2)} />
            <Mini label="Win rate" value={pctPlain(report.result.winRate)} />
            <Mini label="Trades" value={String(report.result.closedTrades)} />
          </section>
          <div className="panel p-4">
            <LineChart points={report.result.equityCurve.map((point) => ({ time: point.time, value: point.equity }))} />
            <p className="mt-2 text-xs text-[var(--muted)]">{report.result.sharpeNote} Fees paid {usd(report.result.feesPaid)}. Entries rejected by risk {report.result.rejectedEntries}. Profit factor {report.result.profitFactor == null ? "—" : report.result.profitFactor.toFixed(2)}. Ending equity {usd(report.result.endingEquity)}.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel overflow-x-auto p-4">
              <h3 className="mb-2 text-sm font-medium">Daily result on principal</h3>
              <table className="w-full text-left text-sm">
                <tbody>
                  {daily.rows.slice(-16).map((row) => (
                    <tr key={row.day} className="border-t border-[var(--line)]">
                      <td className="py-1.5">{row.day}</td>
                      <td className={`num ${row.pnl >= 0 ? "up" : "down"}`}>{pct(row.returnOnPrincipal)}</td>
                      <td className="text-xs uppercase text-[var(--muted)]">{row.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel p-4">
              <h3 className="mb-2 text-sm font-medium">Monthly returns</h3>
              <table className="w-full text-left text-sm">
                <tbody>
                  {report.result.monthlyReturns.map((row) => (
                    <tr key={row.month} className="border-t border-[var(--line)]">
                      <td className="py-1.5">{row.month}</td>
                      <td className="num">{pct(row.returnPct)}</td>
                      <td className="num text-[var(--muted)]">{usd(row.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--muted)]">
                {report.result.assumptions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <div className="text-xs uppercase text-[var(--muted)]">{label}</div>
      <div className="num mt-1 text-xl">{value}</div>
    </div>
  );
}
