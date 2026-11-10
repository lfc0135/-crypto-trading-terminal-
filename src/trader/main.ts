import { startEmbeddedTrader, traderTick } from "../lib/trader/runtime";

void traderTick();
startEmbeddedTrader();
console.log("Paper auto-trader loop started. Orders are placed only when the book is enabled, and only on the paper book.");
