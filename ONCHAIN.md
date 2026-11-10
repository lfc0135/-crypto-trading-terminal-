# On-chain paper sleeve

Forward test only. No historical GMGN wallet tape was available in this run (`GMGN_API_KEY` is not set), so nothing was backtested and nothing is claimed as an edge.

The sleeve is $2,500 reserved from the $50,000 paper book. It is Solana only: pump.fun, PumpSwap, and Raydium. GMGN is a filter for wallets and safety. It is not a second price. Pump.fun and GMGN read the same on-chain pools. This process does not sign transactions and does not hold a wallet private key.

## Rules

| Rule | Value |
| --- | --- |
| Sleeve | $2,500 |
| Per token | $100 |
| Open positions | 5 |
| Hard stop | −35% |
| Take half | +50% |
| Trail on the rest | 20% from the peak |
| Max hold | 24h |
| Daily loss pause | $250 realized |
| Entry | 3 scored wallets buying within 30 minutes, then the safety gate |
| Fill | 8 seconds after the signal, pool-impact slippage, priority fee of 105,000 lamports |

A wallet is scored on realized P&L, win rate, trade count, and median hold over the last 90 days. Bots (sub-second holds, huge trade counts, sniper, bundler, dex-bot tags) and insiders (`rat_trader`, `dev`) are excluded. A GMGN 30-day card is used only when the payload actually includes those four fields. Missing safety fields fail closed.

## What the first ticks did

Two ticks ran with DexScreener plus a public Solana RPC. Mint and freeze authorities were read from mint accounts. GMGN holders, burn status, dev share, bundler share, and the smart-money tape were not available.

| Result | Count |
| --- | --- |
| Paper buys | 0 |
| Paper sells | 0 |
| Scored wallets | 0 |
| Signals that passed the gate | 0 |

Names that were checked and skipped included Leonida, Noiz, T2, GTA6KODAK, and Looby. The first failed checks were: still on the bonding curve, or LP burn/lock unverified, top-10 holders excluding the pool unverified, and dev share unverified. The log says the GMGN feed is off and that entries wait for a scored cluster.

Set `GMGN_API_KEY` to turn on the read-only smart-money, KOL, holder, and security calls. That still does not enable live trading. `GMGN_TRADING` and `TRADING_MODE` are unchanged, and this module never calls the swap route.
