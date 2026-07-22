# PROJECT_STATE

## Completed Modules
- Core pipeline: data (Kraken/Coinbase public, synthetic) → indicators →
  scanner → signal engine → risk engine → position/portfolio → paper autopilot.
- Cloud autopilot: `server/autopilotRunner.mts` on GitHub Actions
  (`.github/workflows/autopilot.yml`); state in `state/autopilot-state.json`,
  committed each run + mid-run (~30 min) with resilient rebase+retry push.
  Long runs (LOOP_CYCLES 70) so it runs continuously without an external clock.
- Telegram (Hebrew): per-trade buy/sell (deduped by position id), 08:00/22:00
  digests + weekly/monthly reports — all gated by elapsed-time-since-last-send
  (never an exact calendar/hour match), so a coverage gap only DELAYS a
  message, never silently loses it. Move/risk/drawdown-halt/all-clear alerts,
  real-money readiness line. Secrets only in Actions.
- App (English, phone-first): Home (hero, readiness card, markets, positions,
  activity), interactive Markets detail chart (candles default + line toggle,
  crosshair/OHLC tooltip, live marker, 1D→All), interactive Portfolio value
  history, History. Live at davidpit1565.github.io/automatic-trading-ai.
- Validation harness: `src/core/backtest/livePipeline.ts` replays the REAL
  decision pipeline on history; `scripts/sweepStrategy.mts` +
  `validateStrategy.mts` = the measurement scoreboard.

## Strategy (measured on ~30d real Kraken data; SIMULATED)
- No-chase RSI ceiling `AUTOPILOT_MAX_RSI_FOR_LONG=65` (PF ~1.0→2.3).
- Trailing stop `AUTOPILOT_TRAILING={activateR:1,trailR:2}` (PF ~2.4→3.0,
  drawdown ~1.1%→0.8%). Conviction floor `AUTOPILOT_MIN_CONFIDENCE=20`.
- Shared pure helpers so live autopilot and harness stay identical.
- Portfolio drawdown circuit-breaker (`src/core/risk/drawdownBreaker.ts`,
  DD_BREAKER_PCT=8): pauses NEW entries when equity >8% below its peak; exits
  and stops keep running. Peak tracked in state (`equity-peak`); Hebrew
  Telegram alert once/day (`buildDrawdownHaltAlert`).

## Pending Work (autonomous queue)
- TESTED AND REJECTED (2026-07-20): David asked whether a CLOSER take-profit
  target (easier to hit, so more trades close in profit instead of stopping
  out) would help, having noticed recent closes were mostly stop-losses.
  Measured with `scripts/sweepStrategy.mts` on real Kraken history (5
  symbols, 720 1h candles, production trailing stop 1.0/2.0 held fixed):
  lowering `atrTargetMultiple` from 4 (current, 2:1 reward/risk) to 3 (1.5:1,
  the `minRiskReward` floor) DOES raise win% (52.9%→61.3%) exactly as
  expected, but out-of-sample profit factor drops (2.10→1.60) — same pattern
  at 3.5 (OOS-PF 1.92) and even at a FARTHER target of 5/2.5R (OOS-PF 1.49).
  **The current 4/2R setting has the best OOS-PF of everything tested.**
  Conclusion: win rate and profitability aren't the same thing — a closer
  target wins more often but each win is smaller and the edge is less
  robust out-of-sample. Correctly NOT changed. (Noted in passing: the
  existing "PROD + trail 1.5/1.5" candidate scored OOS-PF 3.18, the best of
  the whole sweep — unrelated to this question, not investigated further
  yet, worth a dedicated look later.)
- TESTED AND REJECTED (2026-07-20): a daily-trend regime filter
  (`src/core/signal/regimeFilter.ts` — `buildDailyRegimeFilter`, EMA on 1d
  closes, wired as an optional `regimeFilter` hook in `livePipeline.ts` only,
  NOT wired into production) was the natural next hypothesis for the 8/8
  losing streak. Measured honestly on ~2 YEARS of independent daily context
  (not the same 30-day window): EMA200 gate → 0 trades at all (every symbol's
  daily close currently sits below its 200-EMA); EMA100 → 1 trade; EMA50 → 11
  trades but WORSE quality (win% 38.2→27.3, PF 1.11→0.54) than no filter.
  **Conclusion: a simple daily-trend gate does not help — it either shuts
  down trading almost entirely or actively hurts. Correctly NOT shipped.**
  The module + tests are kept (harness gained a tested, inert capability) as
  a documented negative result so this exact approach isn't retried blind.
  An adx30+conf35 tweak was ALSO tested and rejected earlier the same day
  (looked good in-sample, only 2 OOS trades — inconclusive).
- FINDING (2026-07-20): live track record hit 8/8 losing trades. Root cause
  confirmed with real data at BOTH the 1h (choppy, ~3% range, ~flat) AND the
  daily scale (broad daily downtrend across ALL 10 traded majors right now,
  per the regime-filter test above) — this is a genuinely difficult market
  period for a long-only strategy, not a fixable code defect. Wiring verified
  intact (minConfidence/maxRsiForLong/trailing/haltNewEntries all correctly
  applied). Drawdown breaker correctly has NOT engaged (~2.7% dd vs 8%
  threshold) — it is not supposed to yet. Sample is tiny (8 trades, 9 days);
  the readiness gate (needs 20 trades/14 days) exists exactly for this.
  Right call: keep running the already-validated strategy on paper and
  accumulate a real track record rather than force an unproven change.
- TESTED AND REJECTED (2026-07-20): a cross-asset correlated-cluster
  exposure cap, built to address the 2026-07-20 ADA+LINK+LTC correlated
  stop-out. Built as a fully additive, opt-in capability — `RiskLimits`
  gained optional `correlationThreshold`/`maxCorrelatedExposurePct`;
  `assessTrade` gained `AssessTradeOptions.correlationTo`; `PaperAutoPilot`
  gained `riskLimits`/`correlationBetween` (all `undefined` by default — zero
  behaviour change unless explicitly wired). A new pure `src/core/risk/
  correlation.ts` computes real return-correlation from candle history.
  Measured with `scripts/measureCorrelationLimit.mts`, which replays the
  ACTUAL production `PaperAutoPilot` (not a simplified proxy) over real
  Kraken history for the 10 majors, in-sample vs out-of-sample:
  - threshold 0.6 / cap 30%: in-sample maxDD 3.41%→2.18%, clustered
    stop-out cycles 3→2, but return -1.47%→-2.63% and PF 0.99→0.54 (worse).
    Out-of-sample: maxDD 2.19%→1.36%, clustered cycles 1→0, return
    -2.60%→-1.36% (better), PF 0.36→0.32 (flat/worse).
  - threshold 0.7 / cap 40% (milder, tested to check robustness): WORSE on
    every metric in both windows (in-sample return -1.47%→-4.92%, PF
    0.99→0.41; OOS PF 0.36→0.17) — not monotonic with the milder setting,
    i.e. the effect is parameter-sensitive rather than a stable improvement.
  **Conclusion: consistently reduces clustered stop-outs and (mostly) max
  drawdown, but does NOT consistently improve — and sometimes clearly
  hurts — overall return/profit factor, and the result is sensitive to the
  exact threshold/cap chosen. Real tradeoff, not a clear win. Correctly NOT
  wired into `autopilotRunner.mts`.** Kept as a tested, inert, documented
  capability (same treatment as the regime filter) — the code is real and
  correct, it's just not proven to net-improve results yet. Re-measure once
  there's more real trade history (current samples: 20-27 trades per
  window) before revisiting.
- FINDING (2026-07-20): `DailyLossTracker.record()` (`src/core/risk/
  dailyLoss.ts`) is never called anywhere in `server/autopilotRunner.mts` or
  any UI view (grep-confirmed) — realized losses are never actually
  accumulated, so `dailyLossLimitPct` (3% of equity) never trips; `getDailyLoss`
  always reads back 0. This is a genuine dormant capital-protection gap, not
  yet fixed (found while building the correlation-limit measurement harness,
  which mirrors this exact dead behaviour for fidelity to production — see
  the harness's `getDailyLoss` comment). Queued: wire `.record(pnl, timestamp)`
  after each realized exit (needs `CycleResult.closed` to carry `pnl`, which
  it currently doesn't) and measure that the limit now actually engages.
- The robot's TRADED universe stays pinned to the 10 curated majors
  (`slice(0, 10)`, deliberately) — widening THAT requires a proper sweep +
  out-of-sample validation first (measure, don't guess), not a slice change.
  Not yet done.
- Later: Telegram approve/reject flow (prerequisite for real money).

## FIXED: Portfolio Value chart flattened to 1-2 candles (2026-07-20)
David reported the wallet-history chart still "isn't organized well at all."
Root-caused with the REAL live cloud state (fetched from the raw
githubusercontent state URL, not a guess): equity tracking is only ~5 days
old (588 samples). `valueView.ts`'s 'All'/'1Y' ranges used a FIXED weekly
(7-day) candle bucket — with only ~5 days of real history, that bucketed the
ENTIRE history into just 1-2 giant candles. Since 'All' is the default range,
this was the very first thing shown on opening the chart. Fixed with
`adaptiveBucketMs(spanMs, niceBucketMs)`: shrinks the bucket toward the
actual data span (targeting ~30 candles, floored at 5 min) when there isn't
enough history to fill the nice bucket width yet; once real history exceeds
`niceBucketMs × 30`, it returns the original nice width unchanged (1Y stays
weekly once a year has actually elapsed). 6 new tests (pure `adaptiveBucketMs`/
`bucketize` unit tests + a DOM-integration repro of the exact live scenario:
5 days of history on the default 'All' range). Verified visually in a real
Chromium browser (dev server + Playwright, mocked cloud-state fetch since
this sandbox can't reach raw.githubusercontent.com directly): before would
have shown ~1-2 candles, after shows 31 real candles with visible structure.

## App-wide bug sweep (2026-07-20)
David asked to go over the whole app in detail and fix what's found. Ran a
systematic review agent over every view file (`src/ui/views/*.ts`) plus the
shared UI utilities, looking specifically for concrete, reproducible defects
(not style). Found and fixed 3 more real bugs beyond the value-chart one above:
- **`marketsView.ts` — stale coin-detail fetch could overwrite a different
  coin.** The staleness guard (`paintSeq`) was scoped per-`openDetail()` call,
  not to the component instance. Repro: open BTC, switch its range (a slow
  fetch), back out and open ETH before that fetch resolves — BTC's response
  would land later and silently snap the screen back to BTC's chart/price/live
  ticker. Fixed with a component-level `detailGeneration` counter bumped on
  every `openDetail()`/`backToList()`, checked alongside `paintSeq` before any
  write to the shared `detailView`. Test reproduces the exact race (fails on
  the old code, passes fixed).
- **`marketsView.ts` — `resume()` silently reset the user's range/chart mode.**
  Pausing (switching tabs) then resuming a coin detail reopened the right coin
  but always reset to 1D/Candle, contradicting the pause/resume design intent.
  Fixed by threading `savedRangeKey`/`savedChartMode` through an
  `openDetail(index, { preserveRange })` option; a genuinely fresh tap from the
  list still starts at the defaults. Test confirms (fails old, passes fixed).
- **`homeView.ts` — "vs Bitcoin" banner never cleared once shown.** If a later
  refresh cycle failed to price BTC (one transient fetch failure), the stale
  comparison stayed on screen looking current, with no `else` branch to hide
  it. Fixed with `else { bench.hidden = true }`. Test confirms (fails old,
  passes fixed).
- **`monitoringView.ts` — alert messages always got a trailing "…"** even when
  not truncated (a 20-char message rendered as `"...text..."…`). Extracted a
  small `truncate(text, max)` helper (`src/ui/format.ts`) that only appends
  the ellipsis when actually cut; unit tested.
6 new tests total for this sweep (on top of the value-chart fix's 6).
The audit also covered `main.ts`, `dataSource.ts`, `markets.ts`, `charts.ts`,
`cloudState.ts`, `liveTicker.ts` — no further concrete (not stylistic) defects
found there.

## Broadened the BROWSABLE (display) universe (2026-07-20)
David asked for more coins beyond the old ~26 and to actually reflect the
full market in the app. `KrakenPublicSource.getInstruments()` now fetches
Kraken's live AssetPairs list and appends every online EUR pair beyond the
10 curated majors (measured live: 538 total today) instead of a fixed ~26
list; falls back to the previous static ~16-coin list if that call fails, so
browsing never regresses. The curated 10 majors always lead in their fixed,
load-bearing order — `autopilotRunner.mts`'s `slice(0, 10)` (what the robot
actually TRADES) is completely unaffected; this only broadens what's
BROWSABLE. Guarded against reintroducing the chart-freeze bug: the Markets
list's auto-refresh sweep (`fetchTopMarkets`) is now capped at 60 coins
(`MARKETS_LIST_CAP`) instead of unbounded — measured per-request latency
(~200-700ms) meant sweeping 500+ coins through the serialized queue would
take minutes, not seconds. 3 new tests cover the broadening, the failure
fallback, and the one-fetch cache. Verified live against the real API
(538 pairs, curated order intact, 324ms).

## Last Successful Tests
tsc clean · 484 vitest tests green · vite build OK (main).
Chart freeze root-fixed (two causes, both shipped):
1. KrakenPublicSource queue now supports `priority` so an opened chart jumps
   ahead of the background list sweep (measured 8092ms → 1746ms for the exact
   repro) while keeping the "never parallel" rate-limit guarantee intact.
2. Leaked view intervals (2026-07-20): `main.ts` mounted each primary view
   (Home/Value/Markets/History) exactly once and never paused its background
   polling when the user navigated away — all 7 `setInterval` loops across
   those views kept running forever, competing for the same Kraken queue even
   off-screen, undermining fix #1. Added a `ViewHandle` (`pause()`/`resume()`)
   pattern: each view returns one from its render function; `main.ts` calls
   `.pause()` on the outgoing primary view and `.resume()` on the incoming one
   (first visit still does a fresh mount). Markets view additionally tracks
   which coin's detail is open so resume reopens the detail (not the list).
   5 new DOM-integration tests assert pause clears every interval and resume
   restarts them (`tests/ui/viewLifecycle.integration.test.ts`).

## Architecture Notes
Strict layering (data→…→UI); UI presentation-only (architecture tests enforce
imports + no live-order path). Autopilot applies strategy tuning at the
capital-risking layer; the shared signal defaults stay permissive.

## Important Decisions
- Autonomous improvement loop (CronCreate ~every 5h) resumes after usage resets;
  David pre-approved changes — no approval prompts.
- Real money remains OFF until the readiness gate is green AND an approval flow
  exists. Measure-don't-guess for every strategy change.
