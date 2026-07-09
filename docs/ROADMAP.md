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

## Remaining stages (each gated: tests pass before the next begins)

### Stage 2 — Signal & risk engine
Rule-based signal definitions (trend/momentum/mean-reversion confluence),
each with: entry condition, invalidation (stop) level, target, and
volatility-scaled position size capped at a fixed % risk per idea.
Every signal carries a machine-checkable explanation of *why* it fired.
Test gate: signal generation reproduces hand-computed cases; position
sizes never exceed the risk cap under property tests.

### Stage 3 — Validation harness
Walk-forward / out-of-sample splits, fee & slippage modeling, benchmark
comparison vs buy-and-hold, and an overfitting sanity report per strategy.
Test gate: known-answer tests on synthetic series; a deliberately
overfit strategy must be flagged.

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
