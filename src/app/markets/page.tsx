"use client";

import { useEffect, useState } from "react";
import { CandleChart } from "@/components/charts";
import { Badge } from "@/components/ui";
import { compactUsd, pct, price } from "@/lib/format";

interface SpotRow {
  instId: string;
  role: "core" | "trend";
  last: number | null;
  change24h: number | null;
  quoteVolume24h: number | null;
  missing: boolean;
}

interface TokenRow {
  chain: string;
  address: string;
  symbol: string;
  price: number | null;
  liquidity: number | null;
  priceChangePercent: number | null;
  top10HolderRate: number | null;
  rugRatio: number | null;
  notes: string[];
}

interface Watch {
  refreshedAt: string;
  refreshSeconds: number;
  spot: SpotRow[];
  onchain: { status: string; message: string; tokens: TokenRow[]; scanned: number; rejected: number };
}

interface Book {
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
}

export default function MarketsPage() {
  const [watch, setWatch] = useState<Watch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("BTC-USDT");
  const [bar, setBar] = useState("15m");
  const [candles, setCandles] = useState<{ time: number; open: number; high: number; low: number; close: number }[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/watchlist", { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Watchlist failed");
        if (!stop) {
          setWatch(body);
          setError(null);
        }
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Watchlist failed");
      }
    };
    void load();
    const id = setInterval(load, (watch?.refreshSeconds ?? 60) * 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [watch?.refreshSeconds]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const [candleRes, bookRes] = await Promise.all([
          fetch(`/api/candles?instId=${selected}&bar=${bar}&limit=240`, { cache: "no-store" }),
          fetch(`/api/book?instId=${selected}`, { cache: "no-store" }),
        ]);
        const candleBody = await candleRes.json();
        const bookBody = await bookRes.json();
        if (!candleRes.ok) throw new Error(candleBody.error || "Chart failed");
        if (!stop) {
          setCandles(candleBody);
          setBook(bookRes.ok ? bookBody : null);
          setChartError(null);
        }
      } catch (err) {
        if (!stop) setChartError(err instanceof Error ? err.message : "Chart failed");
      }
    };
    void load();
    const id = setInterval(load, 15000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [selected, bar]);

  const maxSize = Math.max(1, ...(book?.bids ?? []).map((l) => l.size), ...(book?.asks ?? []).map((l) => l.size));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Markets</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          BTC, ETH, and SOL stay pinned. The rest of the OKX list is USDT spot ranked by log 24h quote volume, with a capped momentum boost, above a liquidity floor. On-chain names come from GMGN only after liquidity, holder concentration, rug, wash, alert, mint, tax, and honeypot checks. Rules live on the Risk page. Refresh {watch?.refreshSeconds ?? 60}s.
        </p>
      </div>
      {error && <div className="panel p-4 text-sm text-[var(--down)]">{error}</div>}
      <div className="grid gap-4 xl:grid-cols-[280px_1fr_280px]">
        <div className="panel max-h-[640px] overflow-auto p-2">
          {(watch?.spot ?? []).map((row) => (
            <button key={row.instId} type="button" onClick={() => setSelected(row.instId)} className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm ${selected === row.instId ? "bg-white/8" : "hover:bg-white/5"}`}>
              <span>
                <span className="block">{row.instId.replace("-USDT", "")}</span>
                <span className="text-[11px] uppercase text-[var(--muted)]">{row.role}</span>
              </span>
              <span className="text-right">
                <span className="num block">{row.last == null ? "—" : price(row.last)}</span>
                <span className={`num text-[11px] ${(row.change24h ?? 0) >= 0 ? "up" : "down"}`}>{row.change24h == null ? "" : pct(row.change24h)}</span>
              </span>
            </button>
          ))}
          {!watch && !error && <div className="h-40 animate-pulse" />}
        </div>
        <div className="panel p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{selected}</h2>
            <div className="flex gap-1">
              {["1m", "5m", "15m", "1H", "4H"].map((item) => (
                <button key={item} type="button" onClick={() => setBar(item)} className={`rounded px-2 py-1 text-xs ${bar === item ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--muted)]"}`}>{item}</button>
              ))}
            </div>
          </div>
          {chartError && <p className="mb-2 text-sm text-[var(--down)]">{chartError}</p>}
          {candles.length > 0 ? <CandleChart candles={candles} /> : <div className="h-[380px] animate-pulse rounded-md bg-black/20" />}
        </div>
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Order book</h2>
          {!book && <p className="text-sm text-[var(--muted)]">Waiting for the public book.</p>}
          <div className="space-y-1">
            {(book?.asks ?? []).slice(0, 10).reverse().map((level) => (
              <Level key={`a${level.price}`} price={level.price} size={level.size} max={maxSize} side="ask" />
            ))}
            <div className="py-1 text-center text-[11px] uppercase tracking-wide text-[var(--muted)]">spread</div>
            {(book?.bids ?? []).slice(0, 10).map((level) => (
              <Level key={`b${level.price}`} price={level.price} size={level.size} max={maxSize} side="bid" />
            ))}
          </div>
        </div>
      </div>
      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">On-chain, after the safety screen</h2>
          <Badge tone={watch?.onchain.status === "live" ? "up" : watch?.onchain.status === "unconfigured" ? "neutral" : "warn"}>{watch?.onchain.status ?? "loading"}</Badge>
        </div>
        <p className="mb-3 text-sm text-[var(--muted)]">{watch?.onchain.message ?? "Loading GMGN status."}</p>
        {watch && watch.onchain.tokens.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Token</th>
                  <th className="font-medium">Chain</th>
                  <th className="font-medium">Price</th>
                  <th className="font-medium">Liquidity</th>
                  <th className="font-medium">Interval move</th>
                  <th className="font-medium">Top 10</th>
                  <th className="font-medium">Checks</th>
                </tr>
              </thead>
              <tbody>
                {watch.onchain.tokens.map((token) => (
                  <tr key={`${token.chain}:${token.address}`} className="border-t border-[var(--line)]">
                    <td className="py-2">
                      <div>{token.symbol}</div>
                      <div className="num text-[11px] text-[var(--muted)]">{token.address.slice(0, 6)}…{token.address.slice(-4)}</div>
                    </td>
                    <td className="uppercase">{token.chain}</td>
                    <td className="num">{token.price == null ? "—" : price(token.price)}</td>
                    <td className="num">{token.liquidity == null ? "—" : compactUsd(token.liquidity)}</td>
                    <td className="num">{token.priceChangePercent == null ? "—" : `${token.priceChangePercent.toFixed(1)}%`}</td>
                    <td className="num">{token.top10HolderRate == null ? "—" : `${(token.top10HolderRate * 100).toFixed(1)}%`}</td>
                    <td className="text-xs text-[var(--muted)]">{token.notes.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Level({ price: px, size, max, side }: { price: number; size: number; max: number; side: "bid" | "ask" }) {
  return (
    <div className="relative overflow-hidden rounded-sm">
      <div className={`absolute inset-y-0 ${side === "bid" ? "right-0 bg-[var(--up)]/15" : "right-0 bg-[var(--down)]/15"}`} style={{ width: `${(size / max) * 100}%` }} />
      <div className="relative flex justify-between px-1 py-0.5 text-xs">
        <span className={`num ${side === "bid" ? "up" : "down"}`}>{price(px)}</span>
        <span className="num text-[var(--muted)]">{size.toFixed(4)}</span>
      </div>
    </div>
  );
}
