import { updateLedger } from "@/lib/store";
import { markBook, marksEquity } from "@/lib/trading/book";
import { summaryFrom } from "@/lib/trader/step";
import { getSpotTickers } from "@/lib/brokers/okx";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handle(async () => updateLedger(async (ledger) => {
    const tickers = await getSpotTickers().catch(() => []);
    const marks: Record<string, number> = {};
    for (const position of ledger.account.positions) {
      const row = tickers.find((ticker) => ticker.instId === position.symbol);
      if (row) marks[position.symbol] = row.last;
    }
    markBook(ledger, marks);
    return summaryFrom(ledger, marksEquity(ledger, marks));
  }), 500);
}
