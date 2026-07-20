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
- NEXT: regime filter (long only with larger trend — EMA200/ADX), then
  confidence/volatility-based sizing. Measure before shipping.
- Correlation-risk limit: 2026-07-20 saw ADA+LINK+LTC (all alts) stop out in
  the same cycle after a coverage gap — risk engine caps per-asset exposure
  but not co-movement. Worth a measured cross-asset exposure limit.
- Then: broaden universe carefully; re-tune with walkForward/robustness.
- Later: Telegram approve/reject flow (prerequisite for real money).

## Last Successful Tests
tsc clean · 447 vitest tests green · vite build OK (main).
Chart smoothness root-fixed: list sweep 60s + in-flight guard (serialized
Kraken queue no longer stacks), failures never cached (keep last good series),
no repaint while the crosshair is open.

## Architecture Notes
Strict layering (data→…→UI); UI presentation-only (architecture tests enforce
imports + no live-order path). Autopilot applies strategy tuning at the
capital-risking layer; the shared signal defaults stay permissive.

## Important Decisions
- Autonomous improvement loop (CronCreate ~every 5h) resumes after usage resets;
  David pre-approved changes — no approval prompts.
- Real money remains OFF until the readiness gate is green AND an approval flow
  exists. Measure-don't-guess for every strategy change.
