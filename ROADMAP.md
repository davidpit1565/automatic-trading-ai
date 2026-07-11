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

### Live Revolut X market data ✅
Official REST API via a local read-only Ed25519 signing proxy; credentials
never reach the browser; only whitelisted market-data GETs are forwarded.

### Stage 3.5 — Validation Harness ✅
- Realistic execution costs in the backtest engine (backwards compatible):
  fees, bid/ask spread, adverse slippage, execution delay. All reported
  performance includes them.
- Walk-forward analysis: rolling train/test windows with no lookahead;
  parameters chosen on training data only (grid-optimising trend factory
  with full diagnostics), evaluated once on unseen data; chained
  out-of-sample equity curve.
- Performance metrics: win rate, profit factor, expectancy, max drawdown,
  annualised Sharpe (documented convention: per-candle equity returns,
  population std, risk-free 0), average trade, average holding time.
  Undefined ratios are null, never fake numbers.
- Overfitting detection: degradation, curve fitting, parameter sensitivity,
  unrealistic win rates, small samples — with a plain-language verdict
  (robust / caution / overfitted / insufficient-data). Failing strategies
  are flagged automatically; a harsh verdict is the harness working.
- Dashboard Validation tab: verdict, out-of-sample equity curve, train-vs-
  unseen comparison, per-fold metrics. UI consumes only the validation engine.
- Execution Control Layer designed (interfaces + docs only, nothing enabled):
  paper/live modes, blocking human confirmation, kill switch, audit log,
  position synchronisation, broker abstraction. Architecture tests enforce
  the module stays inert until Stage 6.

### Stage 4 — Market Monitoring ✅
Analysis only — no execution capability of any kind (enforced by tests).

- Monitoring Engine orchestrating the verified pipeline (scanner → signal →
  risk → validation verdict) on every scheduled scan; no duplicated
  calculations (architecture-tested).
- Scheduler abstraction: 5m/15m/30m/1h/4h/1d intervals; timers never live in
  business logic (IntervalScheduler for the app, ManualScheduler for tests).
- Opportunity detection per symbol per scan: none / watch candidate /
  qualified, where qualified = signal opportunity approved by the Risk
  Engine, with asset, timestamp, price, confidence, entry/stop/target,
  position size, risk %, plain-language explanation, validation verdict.
- Persistent watchlists: manual + automatic entries, favourites, first
  detection, latest scan, highest confidence, current status.
- Append-only opportunity history with indicator snapshot and one-time
  disappearance marking — records are never overwritten.
- Alert engine: in-app + browser notification channels (pluggable for
  email/Telegram later), alerts only for qualified opportunities, per
  symbol+timeframe cooldown and duplicate suppression, persistent history.
- Monitoring dashboard tab: scheduler status, last/next scan, current
  opportunities, watchlist management, opportunity history, alert history.

### Stage 5 — Position Tracking & Portfolio Analytics ✅
No broker writes, no automatic execution, no auto-closing (enforced by tests).

- Position Engine: open (only from approved Risk Engine proposals), partial
  exits with proportional realized P&L, full close, fees, MFE/MAE excursion
  tracking, persistence. One journal entry per completed trade.
- Portfolio Engine: cash accounting coupled to positions, snapshots with
  equity / invested capital / unrealized + realized P&L / total and daily
  return (UTC-day anchored) / exposure / largest position / allocation /
  cash available; configurable base currency.
- Trade Journal: structured and append-only — id, asset, entry/exit
  timestamps and prices, size, stop, target, exit reason, fees, slippage,
  holding duration, MFE/MAE, realized P&L, return %, strategy version,
  validation verdict, confidence, notes. Duplicate ids refused.
- Position monitoring: pure insight function — P&L, distance to stop and
  target, current risk/reward, time in trade, market regime, validation
  deterioration. Informational warnings only; never closes positions.
- Analytics reusing verified math (profitStats, maxDrawdownPct): win/loss
  rate, profit factor, expectancy, average winner/loser, largest gain/loss,
  win/loss streaks, average holding, equity curve, rolling drawdown,
  recovery factor, Calmar (conventions documented in the module).
- Portfolio dashboard tab: overview cards, open positions with live
  insights and manual close / half-close, interactive journal, analytics
  with equity + drawdown charts and monthly performance.

## Next

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
