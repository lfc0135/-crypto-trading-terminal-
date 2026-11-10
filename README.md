# Desk

Paper-first crypto desk for Aayush (Dubai, Asia/Dubai). It marks a local spot book to public OKX prices, screens on-chain tokens when a GMGN key is present, and tracks a **2–3% daily** return band against a **$50,000** principal.

That band is a scoreboard. It is not a forecast, and the risk engine is sized so the book cannot casually chase it. A 2% day on $50,000 is $1,000. The default position cap is 10% ($5,000), so one full spot position has to move about 20% to produce that, before fees. The daily loss stop is 1.5% ($750).

## Run

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). No API keys are required. The book starts flat at $50,000 USDT. Orders stay on this machine.

`npm test` covers the risk engine, position sizing, the backtester (including how often the daily band is hit), the OKX watchlist ranker, and the GMGN safety screen.

## What you can do

- **Book** — equity, cash, realized daily and monthly return versus the target band, mark-to-market P&L, drawdown, positions.
- **Markets** — BTC, ETH, and SOL pinned, plus liquid OKX USDT pairs ranked by 24h quote volume and capped momentum. Public candles and the order book. On-chain rows appear only when `GMGN_API_KEY` is set and the token passes the safety rules.
- **Trade** — market and limit spot orders with a stop and a target. Size can come from the stop and the per-trade risk budget. Preview uses the same server checks as a fill.
- **Strategies** — EMA momentum, mean reversion, a Dubai-session opening-range breakout, and an intraday momentum breakout (1m–15m, flat by the Dubai close). Backtests use closed OKX candles.
- **Risk** — edit the caps, the target band, and the watchlist rules. Leverage defaults to 1×.
- **Journal** — fills and an audit trail of rejects and kill-switch trips.

## Risk defaults ($50,000)

| Control | Default | Dollars |
| --- | --- | --- |
| Position cap | 10% of equity | $5,000 |
| Per-trade risk | 0.4% of equity, including round-trip fees | $200 |
| Daily loss kill switch | 1.5% of the Dubai-day starting equity | $750 |
| Drawdown kill switch | 8% from peak equity | $4,000 |
| Leverage cap | 1× | spot only |

OKX spot minimums are far below those sizes on the majors (BTC-USDT `minSz` 0.00001, ETH-USDT 0.0001, SOL-USDT 0.01). If a risk-based size is still under an instrument minimum, the order is rejected. It is not rounded up.

Paper OKX fills assume a 10 bp taker fee and 2 bp of slippage, in the neighborhood of OKX spot VIP0. On-chain paper fills use the GMGN price plus 30 bp fee and 50 bp slippage. That is a model, not a GMGN quote.

When the daily loss or drawdown switch is on, new risk is blocked. Reducing a long is still allowed. The daily switch clears on the next Dubai day. The drawdown switch can be cleared by hand only after equity is back inside the limit. A historical trip stays on the record.

## Leverage

The cap is a setting and can be raised on the Risk page (1–5). This build still routes **spot only**. Raising the number does not enable margin or perps.

The book suggests looking at the cap only after 3 completed Dubai months in a row show positive realized paper P&L, and only if the drawdown switch has never tripped. The month the book was opened, and the current month, do not count. Meeting the bar is a review prompt, not a reason to borrow and not a path to the daily target.

## Targets

The default daily band is 2–3% of **principal** (not of a compounding equity). A day counts as a hit in the backtest only when that day’s mark-to-market P&L / starting principal lands inside the band. Days above 3% are exceeded, not hits. Flat days are misses.

The monthly view shows realized P&L for the Dubai month. By default its band is the 30-day compound of the daily band, roughly +81% to +143%. That is the math of repeating 2–3% every day. It is shown so the ambition is visible. It is not a plan. You can unpin it and set a monthly band yourself.

## OKX keys, later

Leave the keys empty until you want orders to leave the machine. Public tickers, candles, and books already work.

1. Sign in at [okx.com](https://www.okx.com) and open the API section of your account.
2. Create a key with **Read** and **Trade** only. Do **not** enable **Withdraw**.
3. Turn on IP allowlisting and add the public IP of the machine that runs this desk. Do not leave the key open to every address.
4. For exchange-side paper first, create the key in OKX’s demo (simulated) trading environment. Keep `OKX_SIMULATED=true`.
5. Put the key, secret, and passphrase in `.env`. Never commit that file.
6. Restart the app. A demo order also requires the ticket phrase `ROUTE TO OKX DEMO`. The local paper book is not updated by exchange orders.
7. Real funds need all of: `TRADING_MODE=live`, `OKX_SIMULATED=false`, a restart, the phrase `ENABLE LIVE TRADING` on the Risk page, and the same phrase on the order. Until those are set, nothing is sent to the live exchange.

## GMGN

On-chain trends and paper prices need `GMGN_API_KEY` from [gmgn.ai/ai](https://gmgn.ai/ai). Without it, the on-chain list says so and does not invent tokens.

The adapter calls `https://openapi.gmgn.ai`:

- `GET /v1/market/rank` for trending tokens (the live payload is wrapped twice: `data.data.rank`)
- `GET /v1/token/info` and `GET /v1/token/security` for price and honeypot / tax / mint flags
- `POST /v1/trade/swap` only for an explicitly armed live swap

Exist-auth requests send `X-APIKEY` plus a fresh `timestamp` and `client_id`. Signed swaps also send `X-Signature` over `{path}:{sorted query}:{body}:{timestamp}` using `GMGN_PRIVATE_KEY` (Ed25519 or RSA). That key signs requests. It is not a wallet key. Live swaps also need `GMGN_WALLET_ADDRESS`, `GMGN_TRADING=live`, and `TRADING_MODE=live`.

A token is listed only if it clears the configurable rules: minimum liquidity (default $50,000), holder count, top-10 holder share, rug ratio, wash-trading and alert flags, renounced mint, and a honeypot/tax clearance from the security endpoint. Unverified tokens are left off when honeypot clearance is required. GMGN’s free tier rate-limits quickly; the desk caches security checks and stops if it is limited.

Chains in this desk: Solana, BSC, Base.

## Layout

`src/lib/risk` is the risk engine. `src/lib/backtest` is the backtester. `src/lib/strategies` holds the four strategies. `src/lib/brokers` talks to OKX and GMGN. `src/lib/trading/book.ts` is the paper book. State is a JSON file in `data/` (gitignored), one process.

## Limitations

- No equities and no FX. Spot only. Perps are not routed.
- Live OKX and live GMGN paths are implemented and gated, and were not executed here (no keys, and live is off).
- GMGN rank `price_change_percent` came back as a percent (for example `1927` for a large move) on a live read. K-line docs disagree about whether `volume` is tokens or dollars; charts use OHLC only.
- Security `buy_tax` / `sell_tax` were `0` on a BONK read. Values above 1 are treated as percent, values from 0 to 1 as a fraction. That unit is inferred.
- `honeypot` (0/1) is the field that was populated. `is_honeypot` was null on that read.
- GMGN documents IPv4 only. A 401/403 with a valid key can be an IPv6 path.
- Paper stops fill from the last polled mark. A gap between polls is only as good as the next price.
- Backtest Sharpe uses bar-close returns and a 0% risk-free rate. Under 30 Dubai days it is labeled unstable.
- The JSON ledger is single-process. Do not run two servers against the same `data/ledger.json`.
- Funding, borrow, and withdrawal are out of scope. The OKX key instructions omit withdrawal on purpose.
