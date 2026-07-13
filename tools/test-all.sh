#!/usr/bin/env bash
# Full test gate: unit suites in dependency order, then integration.
# Any failure stops the run with a non-zero exit code.
set -e
cd "$(dirname "$0")/.."
echo "== indicators + strategies =="; node tests/run-tests.js
echo "== signal engine ==";          node tests/signals-tests.js
echo "== risk engine ==";            node tests/risk-tests.js
echo "== validation harness ==";     node tests/validation-tests.js
echo "== execution layer ==";        node tests/execution-tests.js
echo "== revolut transport ==";      node tests/transport-tests.js
echo "== integration ==";            node tests/integration-tests.js
echo "== dashboard build gate ==";   node tools/build-dashboard.js
if [ "${SKIP_E2E:-}" != "1" ]; then
  echo "== dashboard end-to-end ==";  NODE_PATH="$(npm root -g)" node tools/e2e-dashboard.js
fi
echo "ALL SUITES PASSED"
