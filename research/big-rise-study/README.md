# Big-rise predictability study (2026-10-22)

Python (pandas/numpy). Run from this directory, in order:
`mkdir data && python3 fetch.py && python3 panel.py && python3 lifts.py && python3 robust.py`.
Data: Coinbase Exchange EUR daily candles 2018-2026 (28 coins) + alternative.me Fear & Greed.
Target: close +7d >= +10%. Train < 2023, test >= 2023 (cutoffs from train only). Costs 0.4% round trip.
Results and caveats: see PROJECT_STATE.md "Big-rise predictability study".
