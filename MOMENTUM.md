# Meme momentum sleeve

Paper only. No wallet key, no signing, live switches unchanged. Wallet scoring is still in the code and **off**. Entries are price and volume.

## Rules

Breakout of the prior 30 minutes (six 5-minute highs), 5-minute volume at least 3× the average of those prior bars, price accelerating up, and 5-minute buy count above the hourly buy rate. Safety is only: mint authority revoked, freeze authority revoked, a simulated sell returns funds, liquidity at least $50,000, pool age at least 5 minutes, and the pool is a PumpSwap or Raydium market rather than an open bonding curve.

Size is $150 inside the $2,500 sleeve (configurable from $100 to $250). Max 5 open. Take profit closes the **whole** position when price is +20% above cost. Hard stop is −9% (configurable from −8% to −10%). If price never reaches +5% within 45 minutes, the position is closed. Max hold is 3 hours. Fills wait 8 seconds and pay pool-impact slippage plus a 105,000 lamport priority fee. A $250 realized loss in the Dubai day pauses new entries.

## Replay

GeckoTerminal 5-minute candles for the 8 Solana pools that were trending at 22:07 UTC on 10 Nov 2026. About 1,000 bars each, **3.69 days**. FAIR and AICoin were dropped for liquidity under $50,000. The other six (CLAUDIA, WEALTH, STANK, DacityCoin, FLOAT, CATE) were replayed on one shared sleeve.

Candles do not include buy counts, so this replay did **not** apply the rising-buy rule. The live loop does. These coins still have a pool, so dead rugs are missing. Current liquidity was used for every historical fill. Both of those biases make the result look better than a real launch tape.

| | |
| --- | --- |
| Closed trades | 114 |
| Hit rate | 31.6% |
| Average win | +12.0% |
| Average loss | −6.9% |
| Expectancy per trade | −0.92% |
| Take profits / hard stops / time stops / max holds | 21 / 46 / 40 / 7 |
| Total P&L | −$158 |
| Sleeve return per day | **−1.71%** |

## Is 1–3% a day plausible?

Not on this sample. The sleeve lost about 1.7% a day even with survivorship in its favor and without the live buy-count filter. One to three percent a day would be a different result from the one these candles produced. The forward book starts flat and will log each signal, skip, and fill. It is not evidence of an edge until that log says otherwise.

## Live paper

First momentum ticks after the switch: 0 signals, 0 fills, 0 open positions, day P&L $0 (0% of the sleeve). FAIR and AICoin were skipped for liquidity under $50,000. CLAUDIA, WEALTH, STANK, and DacityCoin cleared the safety checks and were skipped because price was not above the 30-minute high. Wallet scoring stayed off.

## Pullback entry

An optional paper preset waits for the first pullback after a hype spike instead of buying the breakout. The default is still the breakout +20% rule above. See `PULLBACK.md`.
