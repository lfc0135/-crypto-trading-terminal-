"use client";

import { useEffect, useState } from "react";
import { usd } from "@/lib/format";

interface Fill { id: string; ts: number; symbol: string; side: string; qty: number; price: number; fee: number; realizedPnl: number; orderType: string; note: string }
interface Audit { id: string; ts: number; level: string; kind: string; message: string }

function when(ts: number) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts));
}

export default function JournalPage() {
  const [fills, setFills] = useState<Fill[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/journal", { cache: "no-store" }).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Journal failed");
      setFills(body.fills ?? []);
      setAudits(body.audits ?? []);
    }).catch((err) => setError(err instanceof Error ? err.message : "Journal failed"));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Journal</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Paper fills and the audit trail, including risk rejections and kill-switch trips. Times are Asia/Dubai.</p>
      </div>
      {error && <div className="panel p-3 text-sm text-[var(--down)]">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel overflow-x-auto p-4">
          <h2 className="mb-2 text-sm font-medium">Fills</h2>
          {fills.length === 0 ? <p className="text-sm text-[var(--muted)]">No fills yet.</p> : (
            <table className="w-full min-w-[520px] text-left text-sm">
              <tbody>
                {fills.map((fill) => (
                  <tr key={fill.id} className="border-t border-[var(--line)]">
                    <td className="py-2 text-xs text-[var(--muted)]">{when(fill.ts)}</td>
                    <td>{fill.side} {fill.symbol}</td>
                    <td className="num">{fill.qty} @ {fill.price}</td>
                    <td className={`num ${fill.realizedPnl >= 0 ? "up" : "down"}`}>{usd(fill.realizedPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel p-4">
          <h2 className="mb-2 text-sm font-medium">Audit</h2>
          <ul className="space-y-3">
            {audits.map((item) => (
              <li key={item.id} className="border-t border-[var(--line)] pt-3 text-sm">
                <div className="text-xs uppercase text-[var(--muted)]">{when(item.ts)} · {item.kind} · {item.level}</div>
                <p className="mt-1 leading-5">{item.message}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
