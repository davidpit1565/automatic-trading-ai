#!/usr/bin/env bash
# Full test gate: unit suites in dependency order, then integration.
# Any failure stops the run with a non-zero exit code.
set -e
cd "$(dirname "$0")/.."
echo "== indicators + strategies =="; node tests/run-tests.js
echo "== signal engine ==";          node tests/signals-tests.js
echo "== risk engine ==";            node tests/risk-tests.js
echo "== integration ==";            node tests/integration-tests.js
echo "== dashboard build gate ==";   node tools/build-dashboard.js
echo "ALL SUITES PASSED"
