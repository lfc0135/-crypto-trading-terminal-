"use client";

import { useState } from "react";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { pct, usd } from "@/lib/format";

interface Outcome {
  ok: boolean;
  message: string;
  reasons?: string[];
  estimatedQty?: number;
  estimatedPrice?: number;
  notional?: number;
  risk?: number | null;
  riskPct?: number | null;
  positionPct?: number | null;
}

export default function TradePage() {
  const [venue, setVenue] = useState<"okx" | "gmgn" | "kraken">("okx");
  const [symbol, setSymbol] = useState("BTC-USDT");
  const [chain, setChain] = useState("sol");
  const [address, setAddress] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [usdSize, setUsdSize] = useState("1000");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [sizeFromRisk, setSizeFromRisk] = useState(true);
  const [acknowledgeUnsafe, setAcknowledgeUnsafe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const payload = {
    venue,
    symbol,
    chain,
    address,
    side,
    type,
    usdSize: usdSize ? Number(usdSize) : undefined,
    limitPrice: limitPrice ? Number(limitPrice) : undefined,
    stopLoss: stopLoss ? Number(stopLoss) : undefined,
    takeProfit: takeProfit ? Number(takeProfit) : undefined,
    sizeFromRisk: side === "buy" && sizeFromRisk,
    route: "paper",
    leverage: venue === "okx" ? 2 : 1,
    acknowledgeUnsafe,
  };

  async function send(commit: boolean) {
    setBusy(true);
    try {
      const res = await fetch(commit ? "/api/orders" : "/api/orders/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      setOutcome(body.error ? { ok: false, message: body.error, reasons: [body.error] } : body);
    } catch (error) {
      setOutcome({ ok: false, message: error instanceof Error ? error.message : "Order failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <div className="panel p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Order</h1>
          <Badge tone="accent">Local paper</Badge>
        </div>
        <div className="grid gap-3">
          <Field label="Venue">
            <Select value={venue} onChange={(event) => setVenue(event.target.value as "okx" | "gmgn" | "kraken")}>
              <option value="okx">OKX spot</option>
              <option value="kraken">Kraken futures (paper)</option>
              <option value="gmgn">GMGN on-chain (paper price)</option>
            </Select>
          </Field>
          {venue !== "gmgn" ? (
            <Field label="Pair">
              <Input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
            </Field>
          ) : (
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <Field label="Chain">
                <Select value={chain} onChange={(event) => setChain(event.target.value)}>
                  <option value="sol">Solana</option>
                  <option value="bsc">BSC</option>
                  <option value="base">Base</option>
                </Select>
              </Field>
              <Field label="Token address">
                <Input value={address} onChange={(event) => setAddress(event.target.value.trim())} placeholder="Mint or 0x contract" />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Side">
              <Select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </Select>
            </Field>
            <Field label="Type">
              <Select value={type} onChange={(event) => setType(event.target.value as "market" | "limit")}>
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </Select>
            </Field>
          </div>
          <Field label={side === "buy" ? "USD size (ignored if sizing from the stop)" : "USD to sell"}>
            <Input value={usdSize} onChange={(event) => setUsdSize(event.target.value)} inputMode="decimal" />
          </Field>
          {type === "limit" && (
            <Field label="Limit price">
              <Input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} inputMode="decimal" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stop">
              <Input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Take profit">
              <Input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} inputMode="decimal" />
            </Field>
          </div>
          {side === "buy" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sizeFromRisk} onChange={(event) => setSizeFromRisk(event.target.checked)} />
              Size from the stop and the per-trade risk budget
            </label>
          )}
          {venue === "gmgn" && (
            <label className="flex items-start gap-2 text-sm text-[var(--muted)]">
              <input type="checkbox" checked={acknowledgeUnsafe} onChange={(event) => setAcknowledgeUnsafe(event.target.checked)} className="mt-1" />
              I still want this paper fill if the token fails the safety screen. Live GMGN is not called.
            </label>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => send(false)}>Preview</Button>
            <Button type="button" disabled={busy} onClick={() => send(true)}>{busy ? "Working" : "Place paper order"}</Button>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
          OKX paper buys are isolated margin at 2×: you post half the notional and borrow the rest at the OKX USDT daily rate. Kraken paper is the same 2× isolated cap on BTC, ETH, and SOL futures marks, with Kraken's 2 bps maker and 5 bps taker schedule instead of OKX's 8 and 10. Live Kraken orders are not sent. On-chain paper stays at 1×.
        </p>
      </div>
      <div className="panel p-4">
        <h2 className="text-sm font-medium">Risk check</h2>
        {!outcome && <p className="mt-3 text-sm text-[var(--muted)]">Preview runs the same server-side checks as a live paper fill, then discards the result.</p>}
        {outcome && (
          <div className="mt-3 space-y-3">
            <Badge tone={outcome.ok ? "up" : "down"}>{outcome.ok ? "Allowed" : "Blocked"}</Badge>
            <p className="text-sm leading-6">{outcome.message}</p>
            {outcome.reasons && outcome.reasons.length > 0 && outcome.reasons[0] !== outcome.message && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
                {outcome.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Qty" value={outcome.estimatedQty?.toString() ?? "—"} />
              <Metric label="Price" value={outcome.estimatedPrice ? outcome.estimatedPrice.toLocaleString("en-US") : "—"} />
              <Metric label="Notional" value={outcome.notional != null ? usd(outcome.notional) : "—"} />
              <Metric label="Trade risk" value={outcome.riskPct != null ? pct(outcome.riskPct) : "—"} />
            </dl>
          </div>
        )}
        <div className="mt-6 border-t border-[var(--line)] pt-4 text-sm leading-6 text-[var(--muted)]">
          Exchange routing stays off without keys. OKX demo needs a key with Read and Trade only, plus the phrase ROUTE TO OKX DEMO. Live OKX also needs TRADING_MODE=live, OKX_SIMULATED=false, the Risk page confirmation, and ENABLE LIVE TRADING on the ticket. None of that changes this paper book.
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-[var(--muted)]">{label}</dt>
      <dd className="num mt-1">{value}</dd>
    </div>
  );
}
