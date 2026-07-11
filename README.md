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
- **Stage 2 — complete**: explainable Signal Engine on top of the verified scanner —
  quality gates (evidence score, ADX trend strength, RSI overextension, volatility
  ceiling), ATR-derived entry / stop loss / take profit with risk/reward, and a
  confidence score (hard-capped below 100) whose components are itemised. Rejections
  list every failed check; opportunities explain themselves in plain language.
  Long-only: bearish evidence yields an explained pass, never a short.
- **Stage 3.5 — complete**: Validation Harness — walk-forward analysis with rolling
  train/test windows, realistic costs (fees, spread, slippage, execution delay) in every
  reported number, professional metrics (profit factor, expectancy, Sharpe, drawdown,
  holding time), automatic overfitting detection with an explained verdict, and a
  Validation dashboard tab. Execution Control Layer designed but deliberately inert
  (see `docs/execution-architecture.md`).
- **Stage 3 — complete**: Risk Management Engine between signals and proposals —
  risk-based position sizing with a hard 1% per-trade ceiling, 20% single-position and
  per-asset caps, 60% total-exposure limit, max open positions, daily loss protection
  with automatic next-day reset, risk/reward and stop-distance validation, and a fully
  explainable `TradeRiskAssessment`. Refusing a trade is a success condition. See
  `ROADMAP.md` for stage-by-stage status.

## Architecture

Strict one-way layering; no business logic in UI components, no duplicated math:

```
Data Layer (src/core/data)          candle parsing, Revolut X read-only client,
                                    persistent storage, deterministic demo data
Indicator Engine (src/core/indicators)  pure functions, null-padded warm-up
Strategy Engine (src/core/strategies)   Buy & Hold, DCA, SMA-cross trend, grid
Backtesting (src/core/backtest)     fills, fees, equity curve, P&L, drawdown, stats
Portfolio (src/core/portfolio)      paper trading with average-cost accounting
Validation (src/core/validation)    walk-forward, cost-aware metrics, overfitting
                                    detection — reuses the backtest engine
Execution (src/core/execution)      DESIGN ONLY: contracts for Stage 6 (paper/live,
                                    human confirmation, kill switch, audit)
Monitoring (src/core/scan)          market scanner: scoring + hot/cold/neutral
Signal Engine (src/core/signal)     quality gates, trade levels, confidence
Risk Engine (src/core/risk)         position sizing, exposure limits, daily loss
                                    protection, trade approval/refusal with reasons
UI (src/ui + index.html)            Backtesting Lab · Grid Simulation ·
                                    Paper Portfolio · Market Scan · Learn
```

If the live API is unreachable, the dashboard falls back to clearly-labelled
deterministic demo data — synthetic data is never presented as live prices.

## Connecting live Revolut X data

Live market data comes from the official
[Revolut X REST API](https://developer.revolut.com/docs/x-api) through a **local
read-only proxy** (`server/revxProxy.mjs`). The proxy holds your credentials, signs
requests (Ed25519), and only forwards whitelisted market-data GETs — it refuses
orders, balances, and every account-mutating endpoint by construction, so it cannot
trade. No Claude connectors or company integrations are involved; the app talks to
Revolut X directly from your machine.

1. Generate an Ed25519 keypair locally:
   ```bash
   openssl genpkey -algorithm ed25519 -out revx-private.pem
   openssl pkey -in revx-private.pem -pubout -out revx-public.pem
   ```
2. In the **Revolut X web app**, create an API key, paste the contents of
   `revx-public.pem`, and grant it **read-only** permissions (no trading).
3. `cp .env.example .env` and fill in `REVX_API_KEY` and `REVX_PRIVATE_KEY_PATH`.
   `.env` and `*.pem` are gitignored — never commit credentials.
4. Run the proxy and the dashboard:
   ```bash
   npm run proxy   # terminal 1 — read-only signing proxy on :8788
   npm run dev     # terminal 2 — dashboard (proxies /api/revx automatically)
   ```

The banner turns green when live data is flowing. Without the proxy or credentials,
the app stays in clearly-labelled deterministic demo mode.

## Development

```bash
npm install
npm test          # unit + integration suite (vitest)
npm run typecheck # strict TypeScript, no emit
npm run dev       # dashboard dev server
npm run build     # typecheck + production build
npm run preview   # serve the production build on :4173
npm run test:e2e  # Chromium end-to-end test against the preview server
```

Every feature follows TDD: tests first, then implementation, then regression run.

## Roadmap

Stage 4 Market Monitoring → Stage 5 Position Tracking → Stage 6 Execution
Preparation (human confirmation mandatory; architecture already designed in
`docs/execution-architecture.md`) → Stage 7 Performance Feedback. Each stage
proceeds only after the previous one is verified — details in `ROADMAP.md`.

> Educational and analytical tool. Not financial advice. Past performance never
> guarantees future results.
