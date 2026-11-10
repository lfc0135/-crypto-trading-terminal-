import { updateLedger } from "@/lib/store";
import { markBook, marksEquity } from "@/lib/trading/book";
import { summaryFrom } from "@/lib/trader/step";
import { onchainPublic } from "@/lib/onchain/model";
import { readOnchain } from "@/lib/onchain/store";
import { compareMajors, krakenPaperScore, paperExchange } from "@/lib/brokers/kraken";
import { getSpotTickers } from "@/lib/brokers/okx";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handle(async () => updateLedger(async (ledger) => {
    const tickers = await getSpotTickers().catch(() => []);
    const marks: Record<string, number> = {};
    const okxLast: Record<string, number> = {};
    for (const ticker of tickers) okxLast[ticker.instId] = ticker.last;
    for (const position of ledger.account.positions) {
      if (position.venue === "okx" && okxLast[position.symbol] > 0) marks[position.symbol] = okxLast[position.symbol];
    }
    const quotes = await compareMajors(okxLast).catch(() => []);
    for (const quote of quotes) {
      if (quote.kraken == null) continue;
      for (const position of ledger.account.positions) {
        if (position.venue === "kraken" && position.symbol === quote.symbol) marks[position.symbol] = quote.kraken;
      }
    }
    markBook(ledger, marks);
    const book = summaryFrom(ledger, marksEquity(ledger, marks));
    const sleeve = readOnchain();
    return {
      ...book,
      kraken: { exchange: paperExchange(), ...krakenPaperScore(ledger, marks), quotes },
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
