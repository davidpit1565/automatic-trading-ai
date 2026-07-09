# automatic-trading-ai — Crypto Strategy Lab

An educational, risk-first crypto analysis platform: backtesting,
indicator-based market scanning, and paper trading on real historical
EUR prices. **Read-only — it cannot place orders and never promises
profits.** Roadmap and honest constraints: [docs/ROADMAP.md](docs/ROADMAP.md).

## Layout

| Path | Purpose |
|---|---|
| `src/indicators.js` | Technical indicator engine (pure functions) |
| `src/strategy.js` | Backtest engine: buy & hold, DCA, trend, grid |
| `tests/run-tests.js` | Test suite (hand-computed expected values) |
| `tools/fetch-data.sh` | Fetch 365d daily EUR data from CoinGecko |
| `tools/validate-data.js` | Validate + compile `data/dataset.json` |
| `tools/build-dashboard.js` | Bake engines + data into `dashboard/index.html` |
| `dashboard/template.html` | Dashboard source (Market Scan, Backtest Lab, Grid, Paper Portfolio, Learn) |

## Workflow

```bash
node tests/run-tests.js        # must pass before anything ships
bash tools/fetch-data.sh       # refresh market data
node tools/validate-data.js    # gate: shape, freshness, sanity
node tools/build-dashboard.js  # gate: embedded code byte-identical to tested source
```

The built `dashboard/index.html` is published as a Claude artifact.
Every stage of development is test-gated and committed — the execution
environment is ephemeral, so git is the only durable store.
