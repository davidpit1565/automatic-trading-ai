# Spike / rotation study (2026-10-30)

Python (pandas/numpy). Run in this directory: `mkdir data && python3 fetch.py && python3 ev.py 0.003 && python3 early.py && python3 rot.py`.
Data: Kraken public daily candles (720 days, 2024-11 to 2026-10) for all 482 online EUR pairs; 346 pass a liquidity filter
(20-day median volume >= EUR 10k, event-day volume >= EUR 30k). Costs 0.30%/side (+0.3% slippage for early entries). Survivorship bias: only pairs still listed.

Question (David): "coins rise 20-40% in a day; find those trades, and trade constantly".
Results (net of costs):
- Spikes exist (~29 days a month with a >= 20% day), but buying them AFTER the fact loses: event-day close -> sell next day -1.8% (>=20%), -3.3% (>=30%);
  sell +7d -4.8%/-6.0%; next open -> +1d -1.2%/-3.4%. Win rate 31-38%.
- Entering EARLY (stop-buy when the coin is +5/10/15/20% above the day open) also loses: same-day close -0.9/-1.6/-2.8/-3.8%, next close -1.0/-1.9/-3.3/-4.4%.
- Buying after a >= 10/20/30% daily DROP: no robust edge (1-3 day mean ~0 or negative, 90% CI includes 0; 7-day clearly negative).
- Baseline: a random liquid coin held 1 day lost 0.77% net (gross about -0.17%/day) and the equal-weight liquid universe fell 0.77%/week gross of costs: the alt universe bled in this window; BTC was -2.8%.
- Weekly momentum rotation (top 3/5/10 by 7/14/30-day return, equal weight, 0.6% round trip each week): about -80..-95% over 2 years without a regime filter;
  with a BTC > 50-day SMA filter roughly flat (-47%..+12%, 60% drawdowns, win weeks ~20%). Nothing usable.
Conclusion: in this window, neither chasing spikes, buying dips, nor rotating into strength has a positive net edge in the liquid Kraken alt universe.
