"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "./ui";

const links = [
  ["/", "Book"],
  ["/markets", "Markets"],
  ["/trade", "Trade"],
  ["/strategies", "Strategies"],
  ["/risk", "Risk"],
  ["/journal", "Journal"],
];

function dubaiClock(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [clock, setClock] = useState("");
  const [equity, setEquity] = useState<number | null>(null);
  const [kill, setKill] = useState(false);

  useEffect(() => {
    const tick = () => setClock(dubaiClock(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (stop) return;
        setEquity(body.equity);
        setKill(Boolean(body.kills?.daily || body.kills?.drawdown));
      } catch {
        /* the page surfaces the error */
      }
    };
    void load();
    const id = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-[var(--line)] md:flex md:flex-col md:px-4 md:py-5">
        <div className="px-2">
          <div className="text-xs uppercase tracking-[0.22em] text-[var(--accent)]">Desk</div>
          <div className="mt-1 text-lg font-semibold">Aayush</div>
          <div className="text-xs text-[var(--muted)]">Engineering · Dubai</div>
        </div>
        <nav className="mt-8 flex flex-col gap-1">
          {links.map(([href, label]) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} className={`rounded-md px-3 py-2 text-sm ${active ? "bg-white/8 text-[var(--accent)]" : "text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]"}`}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-[11px] leading-5 text-[var(--muted)]">
          Spot only. Paper book by default. 2–3% a day is a scoreboard, not a plan.
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-4 py-3 md:px-6">
          <div className="text-sm font-medium md:hidden">Desk · Aayush</div>
          <div className="num text-sm text-[var(--muted)]">{clock} GST</div>
          <Badge tone="accent">Paper</Badge>
          {kill ? <Badge tone="down">Kill switch</Badge> : <Badge tone="up">Switches clear</Badge>}
          <div className="ml-auto text-sm">
            <span className="text-[var(--muted)]">Equity </span>
            <span className="num">{equity == null ? "—" : equity.toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)] px-3 py-2 md:hidden">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="shrink-0 rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)]">
              {label}
            </Link>
          ))}
        </nav>
        <main className="px-4 py-5 md:px-6">{children}</main>
      </div>
    </div>
  );
}
