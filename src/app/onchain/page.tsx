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
  paused: boolean;
  pauseReason: string | null;
  openPositions: number;
  positions: PositionRow[];
  pending: { symbol: string; readyAt: number }[];
  wallets: WalletRow[];
  eligibleWallets: number;
  logs: LogRow[];
  trades: number;
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
          Solana paper sleeve for pump.fun, PumpSwap, and Raydium. GMGN is a filter for wallets and safety, not a second price. The same pools are on-chain. This page never signs a transaction.
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
            <Card label="Realized today" value={usd(data.dayPnl)} detail={`${data.trades} sleeve fills`} />
            <Card label="Open" value={String(data.openPositions)} detail={data.paused ? "Entries paused" : "Max 5, $100 each"} />
            <Card label="Scored wallets" value={String(data.eligibleWallets)} detail={data.gmgn ? "GMGN feed on" : "GMGN feed off"} />
          </section>
          <div className="panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-medium">Status</h2>
              <Badge tone={data.paused ? "down" : "neutral"}>{data.paused ? "paused" : "watching"}</Badge>
              <Badge tone="accent">{data.mode}</Badge>
            </div>
            <p className="text-sm text-[var(--muted)]">
              {data.pauseReason ?? "Daily loss limit is $250. Hard stop −35%. Half off at +50%, then a 20% trail. Max hold 24h. A fill waits 8 seconds and pays pool impact plus a priority fee."}
            </p>
            {data.lastError && <p className="mt-2 text-sm text-[var(--down)]">{data.lastError}</p>}
          </div>
          <div className="panel overflow-x-auto p-4">
            <h2 className="mb-3 text-sm font-medium">Paper positions</h2>
            {data.positions.length === 0 && data.pending.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No open paper positions. A buy needs three scored wallets in 30 minutes and a safety gate that passes on real fields. Missing data is a skip, not a pass.</p>
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
            <h2 className="mb-3 text-sm font-medium">Tracked wallets</h2>
            {data.wallets.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No wallet tape yet. Without GMGN, this list stays empty and no entry can fire. Scores need realized P&L, win rate, trade count, and median hold over 30–90 days. Bots, sub-second holds, and insider tags are excluded.</p>
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
