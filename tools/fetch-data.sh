#!/usr/bin/env bash
# Fetch 365d of daily prices + volumes (EUR) from CoinGecko's public API
# into data/<coin>.json. Retries on rate limits. Run from repo root.
set -u
mkdir -p data
COINS="bitcoin ethereum solana ripple cardano dogecoin litecoin polkadot"
for coin in $COINS; do
  for attempt in 1 2 3 4; do
    out=$(curl -sS --max-time 30 \
      "https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=eur&days=365&interval=daily")
    # A valid payload starts with {"prices": — rate-limit errors contain "status"
    if printf '%s' "$out" | head -c 30 | grep -q '"prices"'; then
      printf '%s' "$out" > "data/${coin}.json"
      echo "OK   ${coin} ($(printf '%s' "$out" | wc -c) bytes)"
      break
    fi
    echo "RETRY ${coin} (attempt ${attempt}): $(printf '%s' "$out" | head -c 120)"
    sleep $((attempt * 15))
  done
  sleep 3
done
