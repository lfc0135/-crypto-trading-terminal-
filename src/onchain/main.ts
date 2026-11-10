import { onchainTick, startOnchainLoop } from "../lib/onchain/loop";

void onchainTick();
startOnchainLoop();
console.log("On-chain paper sleeve started. No transaction is signed. Live trading stays off.");
