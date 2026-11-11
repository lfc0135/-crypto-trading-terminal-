# Graduation window: live paper trading

Paper only. No wallet, no signing, no orders, and no live-trading switch is touched. Started 11 Nov 2026. This is the only active on-chain strategy; breakout, pullback, early-volume and the rest stay in the code but are switched off (`legacyEntries: false` in the sleeve config).

## Rules now trading (`g-grad-vol10k-half20-trail12`, the backtest's train-selected config)

- **Universe:** every pump.fun graduate (Pump.fun and pump_mayhem) that migrates to PumpSwap or Raydium, quoted in SOL, USDC or USDT. **No rug or safety filter.**
- **Detection:** GMGN `/v1/trenches` completed list (read-only key), polled at most every 12 s with 429 back-off. Candles are GeckoTerminal 5-minute USD bars, the backtest's source, fetched about 25 s after each bar closes (max one call per 3 s).
- **Entry:** the first post-graduation 5-minute bar must close up on at least $10k volume. Buy at the open of the bar after the first up-closing bar, with the fill 5–30 minutes after graduation. Only a fill on the bar that is open now counts; a signal missed before watching started is ignored.
- **Stop:** 0.5% under the post-graduation low (the migration bar counts only its close), up to 99% wide.
- **Exit:** sell half at +20%, trail the rest 12% under the peak, max hold 3 hours. Exits are checked on closed 5-minute bars.
- **Costs:** the backtest model: constant-product impact, 0.25% pool fee, $0.02 priority fee per transaction, thin-pool slippage 1.5% / 0.8% / 0.4% / 0.2%, depth cap 20× trailing median 5-minute volume, 25% participation cap, stressed stop fills.
- **Sizing:** dedicated $10,000 paper principal. $600 a trade (the backtest's 6%: $150 on $2,500), max 5 open, one per pool, $1,000 realized daily loss pause (UTC day, the backtest's 10%).

The entry and exit walk is `candidates()` + `simulate()` from `strategy-search.ts`, the same code the backtest ran.

## Running

- Start: `bash scripts/run_local.sh` (or `setsid nohup bash scripts/graduation-loop.sh &`). Supervisor pid: `run/graduation.pid`. Stop: `kill "$(cat run/graduation.pid)"`.
- Log: `run/graduation.log`. Journal (every graduation, skip, signal, entry, scale-out, exit with P&L after costs): `data/graduation/journal.jsonl`. State: `data/graduation/state.json`.
- Today's results: `npx tsx scripts/graduation-report.ts` (optional Dubai date argument).
