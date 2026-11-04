# 3-year hourly backtest of the bot's entry rules + slow trend study (2026-11-04)

Research only; not part of the build. Data (not committed): `python3 research/hourly-3y/fetch_hourly.py` (Coinbase public hourly EUR candles, 10 majors, 2023-11..2026-11) then
`COINS=BTC,ETH,... CFG=prod40 COST=0.003 REGIME=50 HIST_DIR=research/hourly-3y/data npx tsx research/hourly-3y/bt.mts` (configs: prod40/30/20, t1/t2/t3/t6, trail; 6 chunks of ~6 months).
`donchian_daily.py` = long-only Donchian trend ensemble on 27 daily Coinbase coins (needs the daily panel data of `research/big-rise-study`). Results: see PROJECT_STATE.md.
