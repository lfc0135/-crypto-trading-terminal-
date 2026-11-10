# Momentum sleeve tuning

Six combos, plus the current +20% rule reported beside them. The winner is chosen only from the later half of the days. None of the six was positive out of sample, so the live default stays the classic preset: take profit **+20%** full close, hard stop **−9%**, time stop if price never reaches **+5% within 45 minutes**, max hold **3 hours**.

The +20% rule remains a selectable paper preset on the On-chain page, along with two of the tighter combos if you want to forward-test them. Switching a preset does not place a live order.

## Tape

GeckoTerminal 5-minute bars, paged backward, for 12 Solana pools that were trending and had at least $50,000 of liquidity on 10 Nov 2026. Pumpswap and Raydium only. Every name had mint authority revoked. Candle history runs about 6 to 12 calendar days, longer than the earlier 3.7-day pass. Pools that died before this snapshot are absent, and today's liquidity is used for every past fill. Buy counts are not in the candles, so this replay does not apply the live rising-buy rule. Those biases make the results look kinder than a real launch tape, and they are still losses.

Train days (first half): 30 Oct–4 Nov. Test days (second half): 5–10 Nov. Names that barely existed before 5 Nov, such as X, only show up out of sample.

## Out of sample (the half that decides)

| Combo | Trades | Hit rate | Avg win | Avg loss | Expectancy | Sleeve / day | Take profits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Classic +20%, −9%, +5% in 45m, hold 3h | 351 | 30.2% | +10.9% | −6.0% | −0.91% | **−3.19%** | 55 |
| +10%, −6%, +3% in 20m, hold 60m | 415 | 33.0% | +5.8% | −4.0% | −0.76% | −3.15% | 75 |
| +10%, −8%, +5% in 30m, hold 90m | 409 | 34.0% | +6.6% | −4.7% | −0.89% | −3.66% | 90 |
| +10%, −9%, +3% in 30m, hold 60m | 406 | 36.2% | +6.5% | −5.1% | −0.90% | −3.66% | 90 |
| +12%, −6%, +5% in 20m, hold 90m | 411 | 31.6% | +6.3% | −4.0% | −0.72% | −2.97% | 65 |
| +12%, −8%, +3% in 30m, hold 60m | 402 | 34.6% | +7.4% | −5.0% | −0.69% | **−2.76%** | 77 |
| +12%, −9%, +5% in 20m, hold 90m | 409 | 35.5% | +6.7% | −4.7% | −0.68% | −2.80% | 77 |

The least-bad out-of-sample combo was +12% / −8% / +3% within 30 minutes / 60-minute hold, at −2.76% of the sleeve per day. That is still a loss, so it does not replace the default. A positive in-sample result would not have been enough either. The rule requires a positive later half and at least 15 out-of-sample trades. Every combo failed the sign test.

## In sample (not used to pick)

| Combo | Trades | Hit rate | Avg win | Avg loss | Expectancy | Sleeve / day |
| --- | --- | --- | --- | --- | --- | --- |
| Classic +20% | 247 | 34.4% | +9.4% | −5.5% | −0.39% | −0.97% |
| +10%, −6%, 20m, 60m | 298 | 32.9% | +5.9% | −3.8% | −0.62% | −1.84% |
| +10%, −8%, 30m, 90m | 292 | 37.3% | +6.0% | −4.7% | −0.66% | −1.93% |
| +10%, −9%, 30m, 60m | 293 | 35.2% | +6.5% | −4.9% | −0.91% | −2.65% |
| +12%, −6%, 20m, 90m | 294 | 34.0% | +5.9% | −3.9% | −0.54% | −1.60% |
| +12%, −8%, 30m, 60m | 291 | 33.7% | +7.0% | −4.7% | −0.72% | −2.10% |
| +12%, −9%, 20m, 90m | 286 | 35.7% | +6.1% | −4.6% | −0.80% | −2.28% |

The earlier 114-trade pass (31.6% hit, average win +12%, average loss −6.9%, −1.71% a day, 21 take-profits) was the classic rule on a shorter survivor list with no day split. This pass is the same rule on a longer tape and more names, and the later half is worse, not better.

## Default

Unchanged. Paper sleeve stays at +20% full close, −9% hard stop, +5% within 45 minutes, 3-hour max hold, $150 a trade, 5 positions, $250 daily pause. Safety checks are unchanged. Nothing is signed.
