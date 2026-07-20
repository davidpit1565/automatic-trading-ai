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
- Correlation-risk limit: 2026-07-20 saw ADA+LINK+LTC (all alts) stop out in
  the same cycle after a coverage gap — risk engine caps per-asset exposure
  but not co-movement. Worth a measured cross-asset exposure limit.
- Then: broaden universe carefully; re-tune with walkForward/robustness.
- Later: Telegram approve/reject flow (prerequisite for real money).

## Last Successful Tests
tsc clean · 448 vitest tests green · vite build OK (main).
Chart freeze root-fixed: KrakenPublicSource queue now supports `priority` so
an opened chart jumps ahead of the background list sweep (measured 8092ms →
1746ms for the exact repro) while keeping the "never parallel" rate-limit
guarantee intact (existing test unchanged, new priority test added).

## Architecture Notes
Strict layering (data→…→UI); UI presentation-only (architecture tests enforce
imports + no live-order path). Autopilot applies strategy tuning at the
capital-risking layer; the shared signal defaults stay permissive.

## Important Decisions
- Autonomous improvement loop (CronCreate ~every 5h) resumes after usage resets;
  David pre-approved changes — no approval prompts.
- Real money remains OFF until the readiness gate is green AND an approval flow
  exists. Measure-don't-guess for every strategy change.
