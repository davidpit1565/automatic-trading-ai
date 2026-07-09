# Trading Assistant — Honest Evaluation & Development Roadmap

Goal (user's words): a professional, data-driven, risk-managed trading
assistant that monitors markets, analyzes signals, sizes positions,
explains its reasoning, alerts on opportunities, and manages positions —
never guessing, never promising profits.

## Hard constraints (verified, not assumed)

1. **Execution is human-in-the-loop, always.** The Revolut X MCP connector
   is read-only by design; order placement needs a separate trading plugin,
   and every order requires explicit human confirmation. This assistant
   will never fire real trades unattended — that is a feature, not a gap.
   Read before any live trading:
   https://github.com/revolut-engineering/revolut-x-api/blob/master/SECURITY.md
2. **Monitoring is periodic, not real-time.** Scheduled scans
   (15–60 min cadence) with alerts are feasible; a 24/7 millisecond
   stream is not. Suitable for swing/position trading only.
3. **News/macro/sentiment input is shallow** (web search only, no
   professional feed). Context only — never a trade driver.
4. **The execution environment is ephemeral.** Session containers can be
   reclaimed at any time; one restart already destroyed uncommitted work
   and the Revolut key material. Consequence: *everything* lives in git,
   every stage ends with a push, and external connections must be
   re-establishable from documented steps.
5. **No profit promises.** Backtests describe the past. Most strategies
   don't beat buy-and-hold after costs. Risk management is the product.

## Current state

### Stage 0 — Foundation ✅ (rebuilt after container loss, now in git)
- Data pipeline: CoinGecko public API (Revolut X connector optional when
  reconnected), 365d daily EUR closes + volumes, 8 assets,
  validated for shape/monotonic timestamps/freshness/sanity
  (`tools/fetch-data.sh`, `tools/validate-data.js`).
- Strategy engine: buy & hold, weekly DCA, 20/50 trend-follow, grid
  (`src/strategy.js`).
- Dashboard artifact with Backtest Lab, Grid, Paper Portfolio, Learn tabs
  (`dashboard/template.html` + `tools/build-dashboard.js`; the build
  verifies embedded engine code is byte-identical to the tested source).

### Stage 1 — Indicator engine & Market Scan ✅
- `src/indicators.js`: SMA, EMA, Wilder RSI, MACD, Bollinger bands,
  annualized volatility, max drawdown, volume ratio, and a descriptive
  (explicitly non-advisory) `analyzeMarket` composite.
- Test gate: `tests/run-tests.js` — 52 assertions, hand-computed expected
  values, all passing. CI-able via `node tests/run-tests.js`.
- Market Scan tab: all-asset table + per-asset full reading with
  plain-language, past-tense descriptions.

### Stage 2 — Signal engine ✅
- `src/signals.js`: trend alignment (50/200-day structure), momentum
  (RSI + MACD), volatility and volume condition factors, documented
  confidence formula, quality gates (overbought, indicator conflict,
  extreme volatility, no-short spot, minimum confidence). Every score is
  reproducible from indicator values — the tests recompute it independently.
- Test gate: 43 assertions passing (`tests/signals-tests.js`).
- ATR added to the indicator engine (Wilder, H/L/C) with a documented
  close-only degradation; measured ~2× understatement vs true-range ATR
  on real BTC daily OHLC. ADX/Stochastic remain deferred until the data
  layer carries real highs/lows — pseudo-variants would be false precision.

### Stage 3 — Risk engine ✅
- `src/risk.js`: 1% fixed risk per trade, 2×/3× ATR stop/target
  (R/R 1.5 minimum), 20% max position, 5% max portfolio risk, minimum
  position size, close-only ATR calibration (×2), full plain-language
  plan or explicit rejection reasons. Long-only by design (spot market).
- Test gate: 31 assertions incl. hand-computed sizing and hard-ceiling
  property sweeps (`tests/risk-tests.js`); 50 integration assertions on
  the real dataset (`tests/integration-tests.js`); full gate:
  `bash tools/test-all.sh` (185 assertions).
- Dashboard "Signals" tab renders the engines' output (no logic in UI):
  per-asset direction, confidence, indicator breakdown, and — when gates
  pass — the complete plan (entry/stop/target/R/R/size/risk).

### Stage 3.5 — Validation harness ✅
- Strategy engine extended with a realistic cost model (fees, spread,
  slippage, one-bar execution delay) and per-execution trade logs;
  zero-cost defaults reproduce the original verified numbers exactly.
- `src/validation.js`: rolling walk-forward splits, per-window
  train-optimize → test-evaluate, buy & hold benchmark on the same test
  windows, round-trip win rates, and an overfitting report with explicit
  rules (no in-sample edge / OOS collapse / unrealistic win rate →
  rejected; thin samples or >3 parameters → caution).
- Test gate: 33 validation assertions incl. a seeded-noise deliberately
  overfit case that must not pass; costs-never-improve property;
  walk-forward on real BTC after costs (current verdict: rejected —
  trend-following lost 18% OOS; the harness refusing it is the product
  working). Dashboard "Validation" tab runs the same engine.

### Execution boundary — Revolut X connector module ✅ (architecture only)
- `src/execution.js`, strictly isolated from analysis: injected transport
  (no network code, no credentials), permission modes
  disconnected → read-only (required first) → trading; proposals built
  only from risk-engine-valid output; literal "CONFIRM TRADE" human gate;
  hard guardrails (max position, cumulative daily loss cap, portfolio
  exposure cap, emergency stop); immutable action/refusal log.
- Test gate: 30 assertions with a recording mock transport proving the
  order endpoint is unreachable without mode + confirmation + guardrails;
  full pipeline integration (signal → risk → proposal → gate → boundary).
- A REAL transport stays unwired until: Revolut X reconnected (fresh
  keypair — see below), validation harness passes a strategy, paper
  trading proves behavior, risk limits tested, security review complete.
  There is deliberately no code path to an unattended order.

## Remaining stages (each gated: tests pass before the next begins)

### Stage 4 — Scheduled monitoring & alerts
A scheduled routine refreshes data, runs the scan + signal engine, and
notifies only on high-confluence events (with the explanation attached).
Test gate: dry-run produces correct alerts on replayed historical days;
no-signal days stay silent.

### Stage 5 — Position & journal tracking
Persistent (in-repo or user-storage) record of open paper positions,
stops/targets, and a decision journal; automatic stop/target monitoring
in the scheduled scan.
Test gate: lifecycle tests (open → stop hit / target hit → closed, P&L).

### Stage 6 — Optional human-confirmed live execution
Only if the user still wants it after Stages 2–5 prove out, and only via
the separate Revolut trading plugin: the assistant prepares an exact
order (pair, size, limit, stop) and the user confirms each one. Hard
guardrails: max position size, max daily loss, kill switch.
Gate: paper track record reviewed together first; tiny size to start.

### Stage 7 — Performance feedback loop
Monthly comparison of live/paper results vs backtest expectations;
strategies that underperform their out-of-sample bands get retired,
not "tuned until they fit".

## Reconnecting Revolut X (when desired)

The container restart destroyed the generated keypair, so the previous
API key is unusable (and can be deleted in Revolut X → Profile → API
keys). To reconnect: re-enable the Revolut X connector on the session,
generate a fresh keypair, add the public key in Revolut X, create a new
API key with MCP/CLI usage enabled. The connector remains read-only.
