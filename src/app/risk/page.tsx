"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Field, Input, Toggle } from "@/components/ui";
import { LIVE_PHRASE } from "@/lib/defaults";
import { pctPlain, usd } from "@/lib/format";

interface Settings {
  limits: { maxPositionPct: number; maxDailyLossPct: number; maxDrawdownPct: number; perTradeRiskPct: number; maxLeverage: number };
  targets: { dailyLow: number; dailyHigh: number; monthlyFollowsDaily: boolean; monthlyLow: number; monthlyHigh: number };
  watch: {
    coreInstIds: string[];
    topN: number;
    minQuoteVolumeUsd: number;
    momentumWeight: number;
    momentumCap: number;
    refreshSeconds: number;
    gmgn: {
      chains: string[];
      interval: string;
      minLiquidityUsd: number;
      maxTop10HolderRate: number;
      maxRugRatio: number;
      maxBuyTax: number;
      maxSellTax: number;
      requireRenouncedMint: boolean;
      blockWashTrading: boolean;
      blockAlert: boolean;
      requireHoneypotClearance: boolean;
      minHolders: number;
      fetchLimit: number;
      maxResults: number;
    };
  };
  leverageReviewMonths: number;
}

export default function RiskPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [principal, setPrincipal] = useState(50000);
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Could not load risk settings");
    setSettings(body.settings);
    setPrincipal(body.principal);
  }

  useEffect(() => {
    let stop = false;
    void fetch("/api/dashboard", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Could not load risk settings");
        if (stop) return;
        setSettings(body.settings);
        setPrincipal(body.principal);
      })
      .catch((err) => {
        if (!stop) setError(err instanceof Error ? err.message : "Load failed");
      });
    return () => {
      stop = true;
    };
  }, []);

  async function save() {
    setError(null);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
    const body = await res.json();
    if (!res.ok) setError(body.error || "Save failed");
    else setMessage("Saved. New orders and the next backtest use these limits.");
  }

  if (!settings) return <div className="panel h-40 animate-pulse" />;
  const dollars = {
    position: principal * settings.limits.maxPositionPct,
    loss: principal * settings.limits.maxDailyLossPct,
    dd: principal * settings.limits.maxDrawdownPct,
    trade: principal * settings.limits.perTradeRiskPct,
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Risk</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          These checks run on the server for every paper order and inside the backtest. At the {usd(principal, 0)} principal the margin budget is {usd(dollars.position)}. At {settings.limits.maxLeverage}× that is {usd(dollars.position * settings.limits.maxLeverage)} of notional. Per trade {usd(dollars.trade)}, daily loss stop {usd(dollars.loss)}, drawdown stop {usd(dollars.dd)}. The hard ceiling is 2×.
        </p>
      </div>
      {error && <div className="panel p-3 text-sm text-[var(--down)]">{error}</div>}
      {message && <div className="panel p-3 text-sm text-[var(--accent)]">{message}</div>}
      <section className="panel grid gap-3 p-4 md:grid-cols-3">
        <Pct label="Max position" value={settings.limits.maxPositionPct} onChange={(value) => setSettings({ ...settings, limits: { ...settings.limits, maxPositionPct: value } })} />
        <Pct label="Per-trade risk" value={settings.limits.perTradeRiskPct} onChange={(value) => setSettings({ ...settings, limits: { ...settings.limits, perTradeRiskPct: value } })} />
        <Pct label="Daily loss stop" value={settings.limits.maxDailyLossPct} onChange={(value) => setSettings({ ...settings, limits: { ...settings.limits, maxDailyLossPct: value } })} />
        <Pct label="Max drawdown" value={settings.limits.maxDrawdownPct} onChange={(value) => setSettings({ ...settings, limits: { ...settings.limits, maxDrawdownPct: value } })} />
        <Field label="Leverage cap">
          <Input type="number" min={1} max={2} step={1} value={settings.limits.maxLeverage} onChange={(event) => setSettings({ ...settings, limits: { ...settings.limits, maxLeverage: Number(event.target.value) } })} />
        </Field>
        <Field label="Review months">
          <Input type="number" min={1} max={12} value={settings.leverageReviewMonths} onChange={(event) => setSettings({ ...settings, leverageReviewMonths: Number(event.target.value) })} />
        </Field>
        <Pct label="Daily target low" value={settings.targets.dailyLow} onChange={(value) => setSettings({ ...settings, targets: { ...settings.targets, dailyLow: value } })} />
        <Pct label="Daily target high" value={settings.targets.dailyHigh} onChange={(value) => setSettings({ ...settings, targets: { ...settings.targets, dailyHigh: value } })} />
        <div className="md:col-span-3">
          <Toggle checked={settings.targets.monthlyFollowsDaily} onCheckedChange={(value) => setSettings({ ...settings, targets: { ...settings.targets, monthlyFollowsDaily: value } })} label="Monthly band follows the daily band, compounded for 30 days" />
        </div>
      </section>
      <section className="panel grid gap-3 p-4 md:grid-cols-3">
        <Field label="Core OKX pairs">
          <Input value={settings.watch.coreInstIds.join(", ")} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, coreInstIds: event.target.value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) } })} />
        </Field>
        <Field label="Trend slots">
          <Input type="number" value={settings.watch.topN} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, topN: Number(event.target.value) } })} />
        </Field>
        <Field label="Min 24h quote volume (USD)">
          <Input type="number" value={settings.watch.minQuoteVolumeUsd} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, minQuoteVolumeUsd: Number(event.target.value) } })} />
        </Field>
        <Field label="Momentum weight">
          <Input type="number" step="0.05" value={settings.watch.momentumWeight} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, momentumWeight: Number(event.target.value) } })} />
        </Field>
        <Field label="Momentum cap">
          <Input type="number" step="0.05" value={settings.watch.momentumCap} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, momentumCap: Number(event.target.value) } })} />
        </Field>
        <Field label="Refresh seconds">
          <Input type="number" value={settings.watch.refreshSeconds} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, refreshSeconds: Number(event.target.value) } })} />
        </Field>
        <Field label="GMGN min liquidity">
          <Input type="number" value={settings.watch.gmgn.minLiquidityUsd} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, gmgn: { ...settings.watch.gmgn, minLiquidityUsd: Number(event.target.value) } } })} />
        </Field>
        <Field label="Max top-10 holder share">
          <Input type="number" step="0.01" value={settings.watch.gmgn.maxTop10HolderRate} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, gmgn: { ...settings.watch.gmgn, maxTop10HolderRate: Number(event.target.value) } } })} />
        </Field>
        <Field label="Max rug ratio">
          <Input type="number" step="0.01" value={settings.watch.gmgn.maxRugRatio} onChange={(event) => setSettings({ ...settings, watch: { ...settings.watch, gmgn: { ...settings.watch.gmgn, maxRugRatio: Number(event.target.value) } } })} />
        </Field>
        <div className="md:col-span-3 grid gap-2">
          <Toggle checked={settings.watch.gmgn.requireHoneypotClearance} onCheckedChange={(value) => setSettings({ ...settings, watch: { ...settings.watch, gmgn: { ...settings.watch.gmgn, requireHoneypotClearance: value } } })} label="Require a clear honeypot and tax check" />
          <Toggle checked={settings.watch.gmgn.requireRenouncedMint} onCheckedChange={(value) => setSettings({ ...settings, watch: { ...settings.watch, gmgn: { ...settings.watch.gmgn, requireRenouncedMint: value } } })} label="Require renounced mint" />
          <Toggle checked={settings.watch.gmgn.blockWashTrading} onCheckedChange={(value) => setSettings({ ...settings, watch: { ...settings.watch, gmgn: { ...settings.watch.gmgn, blockWashTrading: value } } })} label="Block wash-trading flags" />
          <Toggle checked={settings.watch.gmgn.blockAlert} onCheckedChange={(value) => setSettings({ ...settings, watch: { ...settings.watch, gmgn: { ...settings.watch.gmgn, blockAlert: value } } })} label="Block GMGN risk alerts" />
        </div>
        <div className="md:col-span-3">
          <Button type="button" onClick={save}>Save rules</Button>
          <p className="mt-2 text-xs text-[var(--muted)]">Current daily band {pctPlain(settings.targets.dailyLow)}–{pctPlain(settings.targets.dailyHigh)}. Position cap on principal is about {usd(dollars.position)}.</p>
        </div>
      </section>
      <section className="panel p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Live trading</h2>
          <Badge tone="neutral">Off unless the server env says otherwise</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Paper mode ignores this form. To arm live later: create an OKX key with Read and Trade only, no withdrawal, IP-allowlisted; set TRADING_MODE=live and OKX_SIMULATED=false; restart; then type {LIVE_PHRASE}. Each live ticket has to repeat that phrase. Demo orders use ROUTE TO OKX DEMO and never touch this paper book.
        </p>
        <div className="mt-3 flex max-w-md gap-2">
          <Input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder={LIVE_PHRASE} />
          <Button type="button" variant="danger" onClick={async () => {
            const res = await fetch("/api/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phrase }) });
            const body = await res.json();
            if (!res.ok) setError(body.error || "Not armed");
            else setMessage("Live confirmation stored. Orders still need the phrase.");
          }}>Confirm</Button>
        </div>
      </section>
      <section className="panel p-4">
        <h2 className="text-sm font-medium">Reset the paper book</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Clears positions, fills, and the equity curve. Settings stay. Cash returns to the configured principal.</p>
        <Button className="mt-3" type="button" variant="outline" onClick={async () => {
          const res = await fetch("/api/account/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
          const body = await res.json();
          if (!res.ok) setError(body.error || "Reset failed");
          else {
            setMessage(`Book reset to ${usd(body.principal, 0)}.`);
            await reload();
          }
        }}>Reset to principal</Button>
      </section>
    </div>
  );
}

function Pct({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Field label={`${label} (${(value * 100).toFixed(2)}%)`}>
      <Input type="number" step="0.001" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  );
}
