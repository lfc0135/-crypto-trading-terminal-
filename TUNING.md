# Walk-forward tuning

Generated 2026-11-10T21:45:21.200Z.

Nothing is armed. BTC closed above its 200-day average on 0 days in 2022, so the regime filter kept every long flat. A 0% holdout with no trades is not a bear-market test and is not a pass. From the first 2023 daily close, buy-and-hold BTC returned 337%. The weekly momentum book returned 46.2% over that window (50.1% full sample, not used for selection) and did not beat holding BTC. Single-name trend results are in the table; none is an edge, and none hit the 2–3% day. The paper auto-trader will log signals and will not send orders. GMGN stays watch-only.

Train is 2021 through 2022. Out of sample is 2023 through the latest bar. A separate 2022 holdout trains on 2021 only. Entries are maker limits at 8 bps. Stops pay the 10 bp taker fee plus 2 bps. A trade is skipped unless the planned move is at least 3× that round trip. Longs are off unless BTC is above its 200-day average and 14-day ATR is at most 6% of price. Time-series tests use 4H and 1D on BTC, ETH, and SOL, and 1D on the rest. The momentum book is the strongest 3 of a fixed 10-name list, rebalanced every 7 daily bars. BNB-USDT on OKX starts 2022-12-20; the other nine start 2021-01-01. That list is not today's volume ranking. GMGN was not tested and stays watch-only. Cross-section Sharpe and daily hit rate are not computed and are left blank.

| Symbol | Strategy | Bar | OOS trades | OOS return | OOS max DD | OOS Sharpe | OOS hit rate | 2022 holdout | Armed | Why |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| top-10 | cross-section | 1D | 72 | 46.23% | 21.51% | — | — | no trades | no | 2022 had 0 trades (0 regime-on days). 2023+ book 46.2% versus BTC buy-and-hold 337%. Not an edge, and the paper loop cannot rebalance a basket. |
| BTC-USDT | ts-trend | 4H | 31 | 3.48% | 3.04% | 0.53 | 0.00% | no trades | no | 2022 holdout did not trade; BTC was under its 200-day average, so the bear year was not a test |
| ETH-USDT | ts-trend | 4H | 40 | 3.67% | 2.16% | 0.55 | 0.00% | no trades | no | training expectancy was not positive |
| SOL-USDT | ts-trend | 4H | 46 | 0.46% | 3.94% | 0.06 | 0.00% | no trades | no | 2022 holdout did not trade; BTC was under its 200-day average, so the bear year was not a test |
| BTC-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 3 training trades |
| ETH-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 3 training trades |
| SOL-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 5 training trades |
| XRP-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 4 training trades |
| DOGE-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 1 training trades |
| ADA-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 2 training trades |
| AVAX-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 4 training trades |
| LINK-USDT | ts-trend | 1D | — | — | — | — | — | — | no | only 0 training trades |
| DOT-USDT | ts-trend | 1D | — | — | — | — | — | no trades | no | only 3 training trades |
| BNB-USDT | ts-trend | 1D | — | — | — | — | — | — | no | only 2 training trades |

A day hits the target only when mark-to-market P&L divided by starting principal lands inside 2–3%. Flat days count as misses. Nothing here is a promise of that band.