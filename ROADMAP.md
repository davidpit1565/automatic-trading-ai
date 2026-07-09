# Roadmap

Development proceeds stage by stage. A stage is **complete** only when its tests,
the full regression suite, strict TypeScript compilation, the production build,
and the Chromium end-to-end run all pass — then the milestone is committed and
pushed. The repository and its Git history are the single source of truth.

## Completed

### Stage 0 — Foundations ✅
Read-only Revolut X market connection, defensive candle parsing, historical
retrieval, Buy & Hold / DCA / trend backtesting, grid simulation, paper trading
portfolio with average-cost accounting and journal, persistent storage
abstraction, deterministic demo data fallback (never presented as live).

### Stage 1 — Indicator Engine ✅
SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ADX, Stochastic, volume statistics.
Pure reusable functions, 1:1 aligned output with null warm-up, reference-value
tests. Single source of indicator math for the whole platform (enforced by
architecture tests).

### Stage 1 integration — Market Scan ✅
Dashboard tab (immediately before Learn): weighted market scoring from −100 to
+100, hot/neutral/cold classification, clickable rows expanding into the full
component breakdown, warnings, minimum-history validation.

### Stage 2 — Signal Engine ✅
Consumes scanner output only (no duplicated indicator math). Quality gates
(evidence score, ADX trend strength, RSI overextension, volatility ceiling),
ATR-derived entry / stop loss / take profit, risk/reward validation,
confidence score hard-capped at 90/100 with itemised components, plain-language
explanations with explicit uncertainty. Long-only: bearish evidence yields an
explained rejection, never a short.

### Stage 3 — Risk Management Engine ✅
Answers "even if this is a good opportunity, is it safe for this portfolio?"

- `calculatePositionSize` (moved out of the Signal Engine): risk-based sizing
  with a hard per-trade risk ceiling (default 1% of equity), single-position
  cap (default 20%), and total-exposure headroom — every constraint reported.
- Portfolio exposure control: max total exposure (60%), max open positions (5),
  per-asset duplicate protection (20%).
- Daily loss protection: configurable daily loss limit (3% of equity) pauses
  new proposals; resets automatically on the next UTC day; persisted.
- Risk/reward validation: minimum 1.5, unrealistic-target ceiling, minimum stop
  distance.
- `TradeRiskAssessment`: fully explainable approval object; refusing a trade is
  a success condition and every refusal lists all failed checks.
- Dashboard: each qualifying signal shows the Risk Engine verdict against the
  live paper portfolio — approved with sizing, or refused with reasons.

All limits are configurable constants in `DEFAULT_RISK_LIMITS`.

## Next

### Stage 3.5 — Validation Harness
Walk-forward testing, out-of-sample validation, fee/slippage modelling,
overfitting detection. Gate before any live-facing functionality.

### Stage 4 — Market Monitoring
Continuous scheduled scans, opportunity detection, watchlists, alerts.

### Stage 5 — Position Tracking
Open positions, P&L tracking, performance metrics, trade journal analytics.

### Stage 6 — Execution Preparation
Prepare complete orders and full trade summaries. **Every live order requires
explicit human confirmation — no exceptions.** Never executes automatically.

### Stage 7 — Performance Feedback
Strategy evaluation, backtest comparison, win rate, drawdown, Sharpe ratio,
expectancy, continuous improvement from verified historical performance.

## Standing principles

Correctness over speed. Reliability over feature count. No profit promises,
no certainty claims. Every recommendation explainable and evidence-based.
Strict TDD and the full verification gate before every merge.
