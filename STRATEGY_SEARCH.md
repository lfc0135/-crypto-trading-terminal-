# Strategy search: meme sleeve, walk-forward, rugs included

Paper research only. Nothing in this search changes the live default (breakout entry, +20% full close, −9% stop, +5% within 45 minutes, 3-hour max hold). No preset was added, because no family passed the out-of-sample test below. Nothing is signed.

## Headline: 15-day net on $10,000

All figures are **backtest estimates**, compounded from the out-of-sample daily sleeve return (`10,000 × ((1 + daily)^15 − 1)`), for each family's **train-selected** config. They are not a 15-day result from the live paper server.

| Family | 15-day net on $10k | Daily | OOS trades | Hit | Avg win | Avg loss | Max DD (sleeve) | Top-3 share of profit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| (g) Graduation window, half at +20%, trail 12–15% | **+$2,462,557** (not real, see below) | +44.39% | 54 | 74.1% | +99.5% | −35.4% | 6.0% | **90%** |
| (g) same trades, top 3 removed | +$9,705 | +4.63% | 51 | 72.5% | +23.2% | −35.4% | 6.0% | 58% |
| (g) fold 1 only (the one multi-day test, 6–10 Nov) | **−$696** | −0.48% | 18 | — | — | — | — | — |
| (d) Early-pool volume acceleration, trail | +$7,625 | +3.85% | 70 | 34.3% | +48.6% | −14.2% | 10.3% | **151%** |
| (d) same trades, top 3 removed | −$2,577 | −1.97% | 67 | 31.3% | +18.6% | −14.2% | 21.1% | — |
| (f) Time-of-day filter on the best train config | −$2,448 | −1.85% | 65 | 27.7% | +17.2% | −11.9% | 17.9% | — (loss) |
| (a) Pullback + spike-volume / liquidity / age filters | −$3,003 | −2.35% | 89 | 27.0% | +17.4% | −11.2% | 21.0% | — (loss) |
| (e) Flush bounce (mean reversion) | −$4,702 | −4.15% | 77 | 41.6% | +12.6% | −21.2% | 34.0% | — (loss) |
| (b) Trailing stop (incl. pullback half-at-+20% + trail) | −$7,637 | −9.17% | 396 | 23.0% | +16.5% | −14.9% | 184% | — (loss) |
| (c) Scale out half, trail the rest | −$7,705 | −9.35% | 362 | 26.0% | +12.0% | −15.8% | 187% | — (loss) |
| Baseline: breakout +20% (not in grid) | −$8,505 | −11.90% | 458 | 15.1% | +8.1% | −11.6% | 238% | — (loss) |

Max drawdown is measured on the $2,500 sleeve, so above 100% means the sleeve would have been wiped out.

## Verdict

**Nothing here is reliably profitable.** Two families showed a positive number out of sample. Both fall apart when you look closely:

- **(g) Graduation window.** The +44%/day comes from two trades. FOTF made +2,366% on $150 and XTO made +647%. Those are 90% of the profit. Removing the top three trades still leaves +4.6%/day, but there are three reasons not to trust that:
  1. **Survivorship.** The graduation list came from GeckoTerminal's *current* trending, top-transaction, and top-volume lists, pulled on 10–11 Nov. A coin that graduated on 10 Nov is in the sample *because* it was busy afterwards, which is look-ahead. Fold 2 (10 Nov, 00:00–12:00 UTC) made **+395%/day** and fold 3 (10 Nov 12:00 to 11 Nov 02:00 UTC) made **+22%/day**. Fold 1 is the only test covering several days (6–10 Nov), where that filter matters less, and it **lost −0.48%/day on 18 trades (−$696 over 15 days)**.
  2. **Annualising half-day windows.** Folds 2 and 3 cover about 12 to 14 hours each, so a few trades turn into a huge daily rate.
  3. **Tape quality.** FOTF's pool climbed 100× on bars trading $57–$170. A depth cap and a participation cap now apply, and the exit still prints because the rally bars themselves traded $8k–$77k. A real exit there is doubtful.
- **(d) Early-pool acceleration.** +3.85%/day, but the top 3 trades are **151%** of the profit (José +580%). Without them it is **−1.97%/day**. Only fold 3 had enough train trades to pick a config. This is luck from one or two runners, not an edge.

Everything else lost money out of sample. That includes the filtered pullback (a), the trailing stops (b), the half-at-+20% scale-out on the pullback entry (b+ and c), the flush bounce (e), and the time-of-day filter (f). The best hindsight rows (flagged below) were still negative for every family except (d) and (g).

The only way to remove the survivorship problem in (g) is to record graduations **as they happen**. That means a forward paper run that polls new migrations and applies this rule without knowing which coins will stay busy. That is the next honest test. It is not a reason to put $10,000 in.

## Universe and dates

- **284 pools** in the book, Solana PumpSwap/Raydium, quoted in SOL, USDC, or USDT. Majors and pools over $5M of liquidity were dropped. There were 609 eligible candidates from GeckoTerminal trending (24h and 6h), PumpSwap by transactions and by volume, Raydium, new pools, keyword pool search, and the earlier pullback list.
- **124 of the 284 are rugged or dead** (peak-to-last ≥ 80% with a flush, an end below 20% of peak, or a thin remnant after a 70% collapse). **They were kept.** Rugged pools appear in every family's trades (for example 31 of 54 graduation trades and 34 of 89 filtered-pullback trades).
- Days with at least 8 pools trading: **16 Oct – 10 Nov 2026** (26 days).
- **Walk-forward, 3 folds, expanding train** (families a–f):
  - Fold 1: train 16–21 Oct, test 22–27 Oct
  - Fold 2: train 16–27 Oct, test 28 Oct – 2 Nov
  - Fold 3: train 16 Oct – 2 Nov, test 3–10 Nov
  - Out-of-sample dates overall: **22 Oct – 10 Nov**. Half split for comparison: train 16–28 Oct, test 29 Oct – 10 Nov.
- **(g) has its own frame**, because graduation timing is per pool. There were 192 pools whose tape starts within 10 minutes of the migration. Fold edges sit at the graduation-count quartiles, in strict time order:
  - Train starts 29 Sep 20:00 UTC
  - Test 1: 6 Nov 09:00 UTC – 10 Nov 00:00 UTC
  - Test 2: 10 Nov 00:00–12:00 UTC
  - Test 3: 10 Nov 12:00 UTC – 11 Nov 02:00 UTC
- Graduation time comes from GeckoTerminal `launchpad_details.completed_at`, used when `migrated_destination_pool_address` is this pool. If a pump/bonk token has no launchpad record, `pool_created_at` is the fallback. For graduates whose 3,000-bar tape no longer reached the migration, the first 6 hours were fetched separately. A position is closed at the last bar before any tape hole longer than 6 hours.

## Selection rules

- Parameters are picked **on train only**: the best train daily % with at least 20 train trades, relaxed to 10 if nothing reaches 20. If no combo has 10 train trades in a fold, that fold is skipped. That happened for folds 1–2 in families a, d, e, and f.
- Test results are reported as they came out. A result needs **at least 30 OOS trades** to count. Every headline row above clears 30.
- **Hindsight rows** (the best single fixed combo across all test folds) are shown only to bound selection bias and are **not** used to pick anything:

| Family | Hindsight combo (selection bias) | 15-day on $10k | Daily | Trades |
| --- | --- | ---: | ---: | ---: |
| g | half at +20%, trail 8%, $10k floor | +$2,809,965 | +45.66% | 54 |
| d | 24h window, 3× volume, trail | +$1,726 | +1.07% | 86 |
| f | filtered pullback, 00–16 UTC | −$221 | −0.15% | 45 |
| e | 50% flush, $60k volume, +15%, 1h | −$425 | −0.29% | 33 |
| a | 50% pullback, $30k spike vol, $75k liq, age ≤ 72h, +20% | −$598 | −0.41% | 33 |
| b | pullback, trail 10% after +20%, 3h | −$6,485 | −6.73% | 361 |
| c | pullback, half at +15%, trail 15% | −$6,736 | −7.19% | 354 |

**Combos tried: 94.** The breakdown:

| Family | Combos | What varied |
| --- | ---: | --- |
| (a) | 16 | spike volume $10k/$30k × liquidity $25k/$75k × age ≤ 72h or any × exit (+20% full close, or half at +20% and trail 12%) |
| (b) | 19 | 16 trailing (breakout or pullback × activation 10/20% × trail 10/20% × hold 3h/12h), plus 3 runs of pullback, half at +20%, trail 8/12/15%, 3h |
| (c) | 16 | breakout or pullback × half at +15/20% × trail 15/25% × breakeven after the scale-out or not |
| (d) | 8 | first 6h or 24h × 3× or 6× volume × +20% fixed or trailing |
| (e) | 16 | flush 30% or 50% × flush volume $20k/$60k × +15% or half-retrace target × hold 1h/3h |
| (f) | 7 | UTC 8-hour bucket subsets on the best train config |
| (g) | 12 | first-bar volume floor $10k/$25k × trail 8/12/15% × stop as specified (0.5% under the post-graduation low) or capped at 20% |

The baseline isn't counted in the 94.

## Cost model

Same pool-impact model as the momentum replay: constant-product `buyExecution`/`sellExecution`, a 0.25% pool fee, and a $0.02 priority fee per transaction. Depth on collapsed pools is implied from trailing volume. Fills happen on the next 5-minute open, and only if that bar exists within 15 minutes. Same-bar, the stop is checked before any target. The sleeve is $2,500 with $150 a trade, max 5 open, one position per pool, and a $250 realized daily loss pause. This search adds stricter thin-pool costs:

- **Extra slippage on every fill:** 1.5% under $25k liquidity, 0.8% under $75k, 0.4% under $250k, and 0.2% otherwise.
- **Depth cap:** quote depth is at most 20× the trailing-hour median 5-minute USD volume. The migration bar is excluded, because its volume includes the migration print.
- **Participation cap:** one sale cannot take more than 25% of the trailing hour's USD volume. Anything above that is treated as unsellable.
- **Stressed stop fills:** if a bar breaks the stop and closes below it, the fill is halfway between the stop and the close. A gap fills at the open.

These costs are why the baseline breakout is worse here (−11.9%/day) than in PULLBACK.md (−4.0%/day). As a sensitivity check, filling stops exactly at the level (`STRATEGY_STOP_FILL=level`) leaves the picture unchanged:

| Family | Daily, stops filled at the level |
| --- | ---: |
| a | −2.14% |
| b | −8.69% |
| c | −9.31% |
| d | +4.76% (top-3 share 124%) |
| e | −4.12% |
| g | +50.1% (top-3 share 82%) |
| baseline | −11.83% |

## Graduation rule as tested

- Enter 5–30 minutes after the migration.
- The first post-graduation 5-minute bar must close up on at least the USD volume floor.
- Entry is the first up-closing bar in the window that fills.
- The stop is 0.5% under the post-graduation low. The migration bar's open and low are the pool-initialization print, so that bar contributes only its close.
- Exit: sell half at +20% and trail the rest 8, 12, or 15% under the peak, with a 3-hour max hold.

The stop as specified is often 40–99% below the fill, because of that print, so the 30% cap used elsewhere is lifted for (g). A 20%-cap variant was also gridded, and train never picked it. That wide stop is why the average graduation loss is −35%.

## Files

- `src/lib/onchain/strategy-search.ts`: entry families, trade simulator, sleeve admission, and stats (tests in `strategy-search.test.ts`).
- `scripts/strategy-universe.ts`, `scripts/strategy-discover-search.ts`, `scripts/strategy-graduation.ts`: universe, keyword search, and graduation timing plus launch windows.
- `scripts/strategy-search.ts`: walk-forward search. The output goes to `data/strategy-search/result.json`, which is local and not committed.

## Caveats

- This is a historical replay. Real 15-day numbers need forward paper trading on the live feed.
- Pools that died without GeckoTerminal candles are missing. The 124 rugged pools are the ones the public APIs still list.
- The pool lists are a snapshot from 10–11 Nov, so recent names lean toward survivors. This matters most for (g) and (d).
- Candles have no buy counts and no per-trade data. Intrabar order is assumed (stop before target), and the cost model is an approximation, especially into a rug.
