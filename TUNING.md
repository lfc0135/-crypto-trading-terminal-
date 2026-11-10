# Walk-forward tuning

Generated 2026-11-10T20:08:56.534Z.

No config cleared the out-of-sample gates. BTC-USDT, ETH-USDT, and SOL-USDT, plus the trend, breakout, and intraday grids, did not produce eight training trades, so they were not promoted. The four rows below were the only train survivors. None has a positive return and a positive Sharpe after costs, and none put a day inside the 2–3% band. Nothing is armed.

Parameters were chosen on the first 70% of each series. The numbers below are the later 30%, which the search did not see. Fees are 10 bps a side and slippage is 2 bps. Sizing uses 2× isolated margin and the same risk limits as the paper book.

| Symbol | Strategy | Bar | Filters | Train trades | OOS trades | OOS expectancy | OOS return | OOS max DD | OOS Sharpe | OOS hit rate | Armed | Why |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ZEC-USDT | mean-reversion | 1H | none | 10 | 4 | 0.03 | 0.00% | 0.46% | -0.18 | 0.00% | no | out-of-sample result is flat or negative after costs |
| ZEC-USDT | mean-reversion | 15m | trend | 8 | 7 | -29.31 | -0.41% | 0.56% | -5.35 | 0.00% | no | out-of-sample expectancy is not positive |
| XRP-USDT | mean-reversion | 1H | none | 14 | 8 | -70.37 | -1.13% | 1.44% | -7.32 | 0.00% | no | out-of-sample expectancy is not positive |
| XRP-USDT | mean-reversion | 15m | none | 9 | 6 | -88.79 | -1.07% | 1.30% | -10.92 | 0.00% | no | out-of-sample expectancy is not positive |

A day hits the target only when mark-to-market P&L divided by starting principal lands inside 2–3%. Flat days count as misses. Nothing here is a promise of that band.