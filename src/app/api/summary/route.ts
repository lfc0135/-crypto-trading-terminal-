import { updateLedger } from "@/lib/store";
import { markBook, marksEquity } from "@/lib/trading/book";
import { summaryFrom } from "@/lib/trader/step";
import { onchainPublic } from "@/lib/onchain/model";
import { readOnchain } from "@/lib/onchain/store";
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
    const book = summaryFrom(ledger, marksEquity(ledger, marks));
    const sleeve = readOnchain();
    return {
      ...book,
      onchain: sleeve.principal > 0 ? onchainPublic(sleeve) : {
        mode: "forward" as const,
        started: false,
        principal: 0,
        dayPnl: 0,
        trades: 0,
        openPositions: 0,
        paused: false,
        breaches: [] as string[],
        note: "The on-chain sleeve has not reserved cash yet.",
      },
    };
  }), 500);
}
