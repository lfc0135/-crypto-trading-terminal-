"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { pct, usd } from "@/lib/format";

interface WalletRow {
  address: string;
  realizedPnl: number;
  winRate: number;
  trades: number;
  medianHoldMs: number;
  eligible: boolean;
  reason: string;
}

interface LogRow {
  id: string;
  ts: number;
  kind: string;
  symbol?: string;
  message: string;
}

interface PositionRow {
  id: string;
  symbol: string;
  address: string;
  qty: number;
  avgCost: number;
  lastPrice: number;
  halfTaken: boolean;
  ageMs: number;
}

interface Sleeve {
  mode: string;
  principal: number;
  cash: number;
  equity: number;
  dayPnl: number;
  dayPct?: number;
  paused: boolean;
  pauseReason: string | null;
  openPositions: number;
  positions: PositionRow[];
  pending: { symbol: string; readyAt: number }[];
  wallets: WalletRow[];
  eligibleWallets: number;
  logs: LogRow[];
  trades: number;
  signals?: number;
  takeProfits?: number;
  hardStops?: number;
  timeStops?: number;
  config?: { tradeUsd: number; hardStop: number; takeProfit: number; walletGate: boolean };
  gmgn: boolean;
  lastError: string | null;
  note: string;
  solPriceNote: string | null;
}

export default function OnchainPage() {
  const [data, setData] = useState<Sleeve | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/onchain", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "On-chain sleeve failed to load");
        if (!stop) setData(body);
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "On-chain sleeve failed to load");
      }
    };
    void load();
    const id = setInterval(() => { void load(); }, 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">On-chain</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Solana meme momentum on pump.fun graduates, PumpSwap, and Raydium. A buy is a breakout with a volume surge, not a wallet score. This page never signs a transaction.
        </p>
      </div>
      {error && <div className="panel p-3 text-sm text-[var(--down)]">{error}</div>}
      {!data && !error && <div className="panel p-4 text-sm text-[var(--muted)]">Loading the sleeve…</div>}
      {data && (
        <>
          <p className="text-sm leading-6 text-[var(--muted)]">{data.note}</p>
          {data.solPriceNote && <p className="text-sm text-[var(--down)]">{data.solPriceNote}</p>}
          <section className="grid gap-3 md:grid-cols-4">
            <Card label="Sleeve equity" value={usd(data.equity)} detail={`${usd(data.cash)} cash of ${usd(data.principal)}`} />
            <Card label="Realized today" value={usd(data.dayPnl)} detail={`${((data.dayPct ?? 0) * 100).toFixed(2)}% of the sleeve · ${data.trades} fills`} />
            <Card label="Open" value={String(data.openPositions)} detail={data.paused ? "Entries paused" : `Max 5, $${data.config?.tradeUsd ?? 150} each`} />
            <Card label="Exits" value={`${data.takeProfits ?? 0} TP`} detail={`${data.hardStops ?? 0} stops · ${data.timeStops ?? 0} time`} />
          </section>
          <div className="panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-medium">Status</h2>
              <Badge tone={data.paused ? "down" : "neutral"}>{data.paused ? "paused" : "watching"}</Badge>
              <Badge tone="accent">{data.mode}</Badge>
            </div>
            <p className="text-sm text-[var(--muted)]">
              {data.pauseReason ?? `Daily loss pause is $250. Take profit closes the full position at +20% of principal. Hard stop −${Math.round((data.config?.hardStop ?? 0.09) * 100)}%. Time stop if price never reaches +5% within 45 minutes. Max hold 3h. Size $${data.config?.tradeUsd ?? 150}. Wallet scoring is ${data.config?.walletGate ? "on" : "off"}. A fill waits 8 seconds and pays pool impact plus a priority fee.`}
            </p>
            {data.lastError && <p className="mt-2 text-sm text-[var(--down)]">{data.lastError}</p>}
          </div>
          <div className="panel overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-medium">Paper positions</h2>
            {data.positions.length === 0 && data.pending.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No open paper positions. A buy needs a 30-minute breakout, 5-minute volume at least 3× its recent average, rising buy counts, and accelerating price. Mint and freeze must be revoked, a sell must return funds, liquidity must be at least $50,000, and the pool must be at least 5 minutes old.</p>
            ) : (
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr><th className="py-2">Token</th><th>Avg cost</th><th>Last</th><th>Mark</th><th>Half</th><th>Age</th></tr>
                </thead>
                <tbody>
                  {data.positions.map((row) => {
                    const mark = row.qty * row.lastPrice;
                    const move = row.avgCost > 0 ? row.lastPrice / row.avgCost - 1 : 0;
                    return (
                      <tr key={row.id} className="border-t border-[var(--line)]">
                        <td className="py-2">{row.symbol}</td>
                        <td className="num">{usd(row.avgCost, 4)}</td>
                        <td className="num">{usd(row.lastPrice, 4)}</td>
                        <td className={`num ${move >= 0 ? "up" : "down"}`}>{usd(mark)} ({pct(move)})</td>
                        <td>{row.halfTaken ? "taken" : "open"}</td>
                        <td className="num">{Math.round(row.ageMs / 60_000)}m</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {data.pending.length > 0 && <p className="mt-3 text-sm text-[var(--muted)]">{data.pending.length} fill{data.pending.length === 1 ? "" : "s"} waiting out the delay.</p>}
          </div>
          <div className="panel overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-medium">Wallet scores</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">Kept in the code and turned off. Momentum does not wait for a smart-money cluster.</p>
            {data.wallets.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No wallet tape is being collected while the gate is off.</p>
            ) : (
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--muted)]">
                  <tr><th className="py-2">Wallet</th><th>Realized</th><th>Win rate</th><th>Trades</th><th>Median hold</th><th>Eligible</th><th>Why</th></tr>
                </thead>
                <tbody>
                  {data.wallets.map((row) => (
                    <tr key={row.address} className="border-t border-[var(--line)]">
                      <td className="py-2 font-mono text-xs">{row.address.slice(0, 4)}…{row.address.slice(-4)}</td>
                      <td className="num">{usd(row.realizedPnl)}</td>
                      <td className="num">{pct(row.winRate)}</td>
                      <td className="num">{row.trades}</td>
                      <td className="num">{Math.round(row.medianHoldMs / 1000)}s</td>
                      <td>{row.eligible ? <Badge tone="up">yes</Badge> : <Badge tone="neutral">no</Badge>}</td>
                      <td className="text-xs text-[var(--muted)]">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="panel overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-medium">Signals, skips, and fills</h2>
            {data.logs.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">The forward log is empty until the sleeve ticks.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.logs.map((row) => (
                  <li key={row.id} className="border-t border-[var(--line)] pt-2">
                    <span className="text-xs uppercase text-[var(--muted)]">{row.kind}{row.symbol ? ` · ${row.symbol}` : ""}</span>
                    <div>{row.message}</div>
                  </li>
                ))}
              </ul>
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
