import { updateLedger } from "@/lib/store";
import { ensureTrader } from "@/lib/trader/step";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handle(() => updateLedger(async (ledger) => ensureTrader(ledger)));
}

export function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as { enabled?: boolean };
    return updateLedger(async (ledger) => {
      const trader = ensureTrader(ledger);
      trader.enabled = Boolean(body.enabled);
      ledger.account.audits.unshift({
        id: crypto.randomUUID(),
        ts: Date.now(),
        level: "info",
        kind: "trader",
        message: trader.enabled
          ? "Paper auto-trader started. Live routes stay off."
          : "Paper auto-trader stopped.",
      });
      return trader;
    });
  });
}
