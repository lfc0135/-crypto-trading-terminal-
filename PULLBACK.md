# First pullback after a hype spike

Paper only. The live default is unchanged: breakout entries, take profit **+20%** full close, hard stop **−9%**, time stop if price never reaches **+5% within 45 minutes**, max hold **3 hours**. Pullback is an opt-in paper preset on the On-chain page. Switching it does not place a live order. Nothing is signed.

## 15-day net on $10,000

These are backtest estimates, compounded from the out-of-sample daily sleeve return. They are not a 15-day result from the live paper server.

| Rule | 15-day net on $10,000 | Daily sleeve | OOS trades | Hit rate | Avg win | Avg loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Best pullback combo: 50% retrace, higher-low, +20% TP, 3-hour hold | **−$19** | −0.013% | 24 | 29.2% | +15.0% | −6.4% |
| Pullback with the +20% take-profit (40% retrace, higher-low, 3-hour hold) | **−$538** | −0.37% | 28 | 17.9% | +14.1% | −7.3% |
| Breakout +20% on this same tape | **−$4,597** | −4.02% | 1,069 | 26.9% | +2.9% | −2.4% |
| Prior breakout +20% test (12 survivor pools, 5–10 Nov) | **−$3,851** | −3.19% | 351 | 30.2% | +10.9% | −6.0% |

None of the 24 pullback combos made money out of sample, so none replaces the default. The least-bad grid result is almost flat, but it had no in-sample trades and only 24 later-half trades, so it is not an edge. The sleeve is not ready for a $10,000 live test.

## Rule

A hype spike is a **+30%** run in **60 minutes** (12 five-minute bars) with **3×** the pre-spike volume. The strategy does not buy that spike. It waits for the first retrace of **25%, 40%, or 50%** of the spike leg, then enters when the pullback stops: a **higher low** with an up close, or a **VWAP reclaim** measured from the spike low. The stop sits **under the pullback low** (0.5% buffer). Take-profit options are **+12%** and **+20%** of principal, full close. Max hold is **60 minutes** or **3 hours**. There is no progress time-stop on pullback entries. Fills wait for the next 5-minute open and pay the same pool-impact model plus a $0.02 priority fee. A stop wider than 30% below the fill, or a gap through the stop, is skipped. Same-bar, the stop is taken before the target.

## Tape

GeckoTerminal 5-minute bars, paged backward (up to 3,000 bars), plus DexScreener profiles and boosts to widen the name list. PumpSwap and Raydium only. **Rugged and dead coins were not filtered out.** Of **213** unique candidates, **40** were selected as a mix of dumped or thin names and longer-lived memes under $2M of liquidity. **35** had at least 16 bars and went into the book. **17** of the 40 were rugged (peak-to-last drawdown of at least 80%, or a thin remnant after a 70%+ collapse). **12** of those 17 had enough tape to include: USDF, FOTF, GPU, BORLY, LMAO!, GTA6, GTA6Coin, Trump, ClaudeAI, Tesla, Rockstar, and GTA6-7J3t. The other five (OGG, fomo, Speed, X, Apple) had only 6–15 bars, which is too short to form a 60-minute spike and a first pullback. The seven shorter included rugs added no confirmed pullback entries: they flushed through the spike low before a bounce could print. Today's remaining liquidity was not used for fills on collapsed names; depth there is implied from trailing USD volume, which raises slippage on thin bars and rejects a $150 clip when the tape is dead.

Train days (first half, not used to pick): **10–25 Oct 2026**. Test days (second half, the half that decides): **26 Oct–10 Nov 2026**. This window is longer than the earlier 30 Oct–4 Nov / 5–10 Nov split because the tape now includes names with a multi-week history. Same-day rugs show up only at the end of the test half.

## Out of sample (the half that decides)

| Combo | Trades | Hit rate | Avg win | Avg loss | Expectancy | Sleeve / day | Take profits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Breakout +20% (same tape, not in the grid) | 1,069 | 26.9% | +2.9% | −2.4% | −1.00% | **−4.02%** | 19 |
| Pullback +20%, 40% retrace, higher-low, hold 3h | 28 | 17.9% | +14.1% | −7.3% | −3.51% | −0.37% | 3 |
| 25% retrace, higher-low, +12%, 60m | 39 | 28.2% | +7.7% | −7.3% | −3.07% | −0.45% | 6 |
| 25% retrace, higher-low, +12%, 3h | 39 | 28.2% | +10.8% | −7.4% | −2.25% | −0.33% | 10 |
| 25% retrace, higher-low, +20%, 60m | 39 | 28.2% | +12.0% | −7.3% | −1.85% | −0.27% | 6 |
| 25% retrace, higher-low, +20%, 3h | 39 | 28.2% | +15.8% | −7.4% | −0.85% | −0.12% | 8 |
| 25% retrace, reclaim, +12%, 60m | 32 | 31.3% | +7.3% | −7.3% | −2.73% | −0.33% | 5 |
| 25% retrace, reclaim, +12%, 3h | 32 | 31.3% | +9.6% | −7.3% | −2.00% | −0.24% | 8 |
| 25% retrace, reclaim, +20%, 60m | 32 | 31.3% | +11.3% | −7.3% | −1.46% | −0.18% | 5 |
| 25% retrace, reclaim, +20%, 3h | 32 | 28.1% | +15.7% | −7.3% | −0.85% | −0.10% | 7 |
| 40% retrace, higher-low, +12%, 60m | 28 | 17.9% | +7.9% | −7.2% | −4.53% | −0.48% | 3 |
| 40% retrace, higher-low, +12%, 3h | 28 | 17.9% | +9.8% | −7.3% | −4.27% | −0.45% | 4 |
| 40% retrace, higher-low, +20%, 60m | 28 | 17.9% | +12.7% | −7.2% | −3.68% | −0.39% | 3 |
| 50% retrace, higher-low, +12%, 60m | 24 | 33.3% | +8.1% | −6.6% | −1.72% | −0.15% | 4 |
| 50% retrace, higher-low, +12%, 3h | 24 | 29.2% | +11.5% | −6.4% | −1.17% | −0.11% | 7 |
| 50% retrace, higher-low, +20%, 60m | 24 | 33.3% | +10.7% | −6.6% | −0.85% | −0.08% | 3 |
| **50% retrace, higher-low, +20%, 3h (least bad)** | **24** | **29.2%** | **+15.0%** | **−6.4%** | **−0.14%** | **−0.013%** | **4** |
| 50% retrace, reclaim, +12%, 60m | 14 | 35.7% | +7.0% | −8.3% | −2.84% | −0.15% | 2 |
| 50% retrace, reclaim, +12%, 3h | 14 | 28.6% | +11.4% | −7.4% | −2.00% | −0.11% | 4 |
| 50% retrace, reclaim, +20%, 60m | 14 | 35.7% | +8.0% | −8.3% | −2.49% | −0.13% | 1 |
| 50% retrace, reclaim, +20%, 3h | 14 | 21.4% | +15.7% | −7.4% | −2.45% | −0.13% | 2 |

The winner rule is the same as the earlier tune: a positive later half and at least 15 out-of-sample trades. Every combo failed the sign test. Pullback lost less than breakout on this tape because it traded far less often, not because the average trade was reliably profitable. The headline +20% pullback preset took 3 take-profits and 22 hard stops in 28 trades.

## In sample (not used to pick)

Pullback barely traded in the first half: 0 trades on the 40% and 50% retrace rules, and 1 losing trade on the 25% retrace rules. The breakout baseline had 70 in-sample trades at −0.25% a day. A least-bad out-of-sample result with no in-sample trades is not a validated setup. It means the first pullback almost never printed on this tape until late October.

## Caveats

- This is a historical replay, not 15 days of forward paper trading on the live feed. Real 15-day live numbers still need that forward run.
- Pools that died and left no GeckoTerminal candles are still missing. The 17 rugged names here are the ones the public APIs still list.
- Implied depth on collapsed pools is a model. Actual launch-tape impact, especially into a rug, can be worse.
- Candles have no buy counts. The live breakout loop still uses rising buys; pullback does not require them.
- The out-of-sample window and the name list differ from the earlier −3.19% a day breakout test. The fair comparison on this tape is **−4.02% a day** for the same breakout rule.
- 24 out-of-sample trades is a thin sample. Fees, a few different fills, or one more stop would move the −$19 figure around.

## Default

Unchanged. The paper sleeve stays on the classic breakout +20% rule. The pullback +20% preset is available for a forward paper test if you want one. Safety checks for live ticks are unchanged. Nothing is signed.
