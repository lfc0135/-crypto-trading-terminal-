# Kraken paper, next to OKX

Paper only. `PAPER_EXCHANGE` is `okx` (default), `kraken`, or `both`. Kraken orders use public futures marks and the local paper book. No Kraken key is read, and there is no live Kraken order route. The 2× isolated cap, 0.4% per-trade risk, and the daily-loss switch are the same ones the OKX book uses. Kraken's own margin schedule allows much more than 2×. This desk does not.

## Fees

| | Maker | Taker |
| --- | --- | --- |
| OKX spot, the rate this paper book already uses | 8 bps | 10 bps |
| Kraken futures, published base schedule | 2 bps | 5 bps |

OKX paper longs also accrue the public USDT borrow rate. Kraken paper longs accrue the perp's hourly funding, scaled to a daily rate. Those are not the same cost. A round trip that pays taker on both sides is 20 bps on OKX and 10 bps on Kraken before slippage and funding or borrow.

## Prices at 22:13 UTC on 10 Nov 2026

Kraken column is the perpetual mark (`PF_XBTUSD`, `PF_ETHUSD`, `PF_SOLUSD`). OKX column is the USDT spot last. A negative gap means the Kraken mark is below OKX.

| Pair | OKX spot | Kraken mark | Gap |
| --- | --- | --- | --- |
| BTC-USDT | 73,903.9 | 73,827.5 | −10.3 bps |
| ETH-USDT | 2,058.21 | 2,055.85 | −11.5 bps |
| SOL-USDT | 83.39 | 83.30 | −11.0 bps |

About a tenth of a percent, the same size as one OKX taker fee. It is a spot-versus-perp basis, not a trade. The desk does not arb it. Funding that hour, scaled to a day, was about 6.6 bps on BTC, 0.6 bps on ETH, and 5.0 bps on SOL.

`GET /api/summary` includes `kraken.realizedPnl`, `kraken.mtmPnl`, `kraken.trades`, and `kraken.quotes`. The dashboard shows the same block. With no Kraken paper fills yet, realized and open P&L are zero.
