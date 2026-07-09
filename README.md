# AI Trading Assistant

A professional AI-powered trading **analysis** platform — a disciplined analyst, not a
trading bot. It monitors markets, computes technical indicators, backtests strategies,
scores opportunities objectively, and explains every reading. It never promises profits,
never claims certainty, and never executes trades: if execution is ever added (roadmap
Stage 6), every live order will require explicit human confirmation.

## Current state

- **Stage 0 — complete**: read-only Revolut X market connection, candle parsing,
  historical retrieval, Buy & Hold / DCA / trend backtesting, grid simulation,
  paper trading portfolio, persistent storage.
- **Stage 1 — complete**: reusable indicator engine (SMA, EMA, RSI, MACD, Bollinger
  Bands, ATR, ADX, Stochastic, volume statistics) with a full reference-value test suite.
- **Stage 1 integration — complete**: Market Scan tab in the dashboard, powered by the
  indicator engine — hot / cold / neutral classification with clickable rows that expand
  into a transparent, component-by-component score breakdown.

## Architecture

Strict one-way layering; no business logic in UI components, no duplicated math:

```
Data Layer (src/core/data)          candle parsing, Revolut X read-only client,
                                    persistent storage, deterministic demo data
Indicator Engine (src/core/indicators)  pure functions, null-padded warm-up
Strategy Engine (src/core/strategies)   Buy & Hold, DCA, SMA-cross trend, grid
Backtesting (src/core/backtest)     fills, fees, equity curve, P&L, drawdown, stats
Portfolio (src/core/portfolio)      paper trading with average-cost accounting
Monitoring (src/core/scan)          market scanner: scoring + hot/cold/neutral
UI (src/ui + index.html)            Backtesting Lab · Grid Simulation ·
                                    Paper Portfolio · Market Scan · Learn
```

If the live API is unreachable, the dashboard falls back to clearly-labelled
deterministic demo data — synthetic data is never presented as live prices.

## Development

```bash
npm install
npm test          # full test suite (vitest)
npm run typecheck # strict TypeScript, no emit
npm run dev       # dashboard dev server
npm run build     # typecheck + production build
```

Every feature follows TDD: tests first, then implementation, then regression run.

## Roadmap

Stage 2 Signal Engine → Stage 3 Risk Management → Stage 4 Market Monitoring →
Stage 5 Position Tracking → Stage 6 Execution Preparation (human confirmation
mandatory) → Stage 7 Performance Feedback. Each stage proceeds only after the
previous one is verified.

> Educational and analytical tool. Not financial advice. Past performance never
> guarantees future results.
