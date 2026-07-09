/*
 * Stage 3.5 — Validation harness.
 * Proves (or disproves) that a strategy's performance survives outside
 * the data it was tuned on. Deterministic, explainable, no shortcuts:
 *
 *   walkForwardSplits  — rolling train/test index windows
 *   roundTrips         — win/loss accounting from a strategy trade log
 *   overfittingReport  — explicit, documented rejection rules
 *   walkForward        — optimize on train → evaluate out-of-sample,
 *                        after realistic costs, vs a buy & hold benchmark
 *
 * OVERFITTING RULES (mirrored by the test suite)
 *   rejected: in-sample return ≤ 0 (no edge to validate)
 *   rejected: OOS return < 50% of in-sample return (collapse), incl. negative
 *   rejected: win rate > 90% with ≥ 10 trades (unrealistic)
 *   caution:  fewer than 20 out-of-sample trades (thin evidence)
 *   caution:  more than 3 tunable parameters (curve-fitting risk)
 *   verdict = rejected > caution > acceptable
 */

function _valDeps() {
  if (typeof module !== 'undefined') return require('./strategy');
  return window.Strategy;
}

function walkForwardSplits(nBars, { trainBars, testBars, step }) {
  const stride = step || testBars;
  const out = [];
  for (let start = 0; start + trainBars + testBars <= nBars; start += stride) {
    out.push({
      trainStart: start,
      trainEnd: start + trainBars - 1,
      testStart: start + trainBars,
      testEnd: start + trainBars + testBars - 1,
    });
  }
  return out;
}

/* Pair buys with their subsequent sells; an unclosed buy is excluded. */
function roundTrips(tradeLog) {
  const trips = [];
  let open = null;
  for (const t of tradeLog) {
    if (t.side === 'buy') open = t;
    else if (t.side === 'sell' && open) {
      trips.push({
        buyBar: open.bar, sellBar: t.bar,
        pnl: (t.price - open.price) * t.units,
      });
      open = null;
    }
  }
  const wins = trips.filter(t => t.pnl > 0).length;
  return {
    trips,
    winRate: trips.length ? wins / trips.length : null,
  };
}

function overfittingReport({ paramCount, trades, winRate, inSampleReturnPct, outSampleReturnPct }) {
  const flags = [];
  let rejected = false;

  if (inSampleReturnPct <= 0) {
    flags.push(`no in-sample edge: the optimized strategy still lost ${inSampleReturnPct.toFixed(1)}% on its own training data — nothing to validate`);
    rejected = true;
  } else if (outSampleReturnPct < inSampleReturnPct * 0.5) {
    flags.push(`performance collapse out of sample: ${inSampleReturnPct.toFixed(1)}% in training vs ${outSampleReturnPct.toFixed(1)}% on unseen data — the fit does not generalize`);
    rejected = true;
  }
  if (winRate !== null && winRate > 0.9 && trades >= 10) {
    flags.push(`unrealistic win rate: ${(winRate * 100).toFixed(0)}% over ${trades} trades — real strategies do not win this often; suspect look-ahead or curve fit`);
    rejected = true;
  }
  if (trades < 20) {
    flags.push(`low trade sample: only ${trades} out-of-sample trades — too little evidence to trust the statistics`);
  }
  if (paramCount > 3) {
    flags.push(`too many parameters: ${paramCount} tunable knobs invite curve fitting — prefer 3 or fewer`);
  }

  return {
    flags,
    verdict: rejected ? 'rejected' : flags.length ? 'caution' : 'acceptable',
  };
}

/*
 * Walk-forward evaluation of the trend-following strategy family.
 * Per window: pick the param set with the best in-sample return, then
 * measure it on the unseen test slice (warm-up may use earlier data —
 * exactly what a live system would have had).
 */
function walkForward(closes, { paramGrid, trainBars, testBars, step, costs, capital = 1000 }) {
  const S = _valDeps();
  const splits = walkForwardSplits(closes.length, { trainBars, testBars, step });

  const windowReturn = (params, from, to) => {
    const run = S.trendFollow(closes.slice(0, to + 1), capital, params.fast, params.slow, costs || {});
    return {
      returnPct: (run.equity[to] / run.equity[from] - 1) * 100,
      tradeLog: run.tradeLog,
    };
  };

  const windows = [];
  for (const w of splits) {
    let best = null;
    for (const params of paramGrid) {
      const r = windowReturn(params, w.trainStart, w.trainEnd);
      if (!best || r.returnPct > best.returnPct) best = { params, returnPct: r.returnPct };
    }
    const oos = windowReturn(best.params, w.testStart, w.testEnd);
    const oosTrades = oos.tradeLog.filter(t => t.bar >= w.testStart && t.bar <= w.testEnd);
    const rt = roundTrips(oos.tradeLog);
    const oosTrips = rt.trips.filter(t => t.buyBar >= w.testStart && t.sellBar <= w.testEnd);
    windows.push({
      ...w,
      params: best.params,
      inSampleReturnPct: best.returnPct,
      outSampleReturnPct: oos.returnPct,
      trades: oosTrades.length,
      trips: oosTrips,
    });
  }

  // aggregate: compound the out-of-sample windows (the only honest chain)
  let oosGrowth = 1, isMean = 0, benchGrowth = 1, totalTrades = 0;
  const allTrips = [];
  for (const w of windows) {
    oosGrowth *= 1 + w.outSampleReturnPct / 100;
    benchGrowth *= closes[w.testEnd] / closes[w.testStart];
    isMean += w.inSampleReturnPct;
    totalTrades += w.trades;
    allTrips.push(...w.trips);
  }
  isMean = windows.length ? isMean / windows.length : 0;
  const wins = allTrips.filter(t => t.pnl > 0).length;
  const winRate = allTrips.length ? wins / allTrips.length : null;

  const aggregate = {
    windows: windows.length,
    inSampleMeanReturnPct: isMean,
    outSampleReturnPct: (oosGrowth - 1) * 100,
    benchmarkOosReturnPct: (benchGrowth - 1) * 100,
    trades: totalTrades,
    winRate,
  };

  const report = overfittingReport({
    paramCount: paramGrid.length ? Object.keys(paramGrid[0]).length : 0,
    trades: totalTrades,
    winRate,
    inSampleReturnPct: isMean,
    outSampleReturnPct: aggregate.outSampleReturnPct,
  });

  return { windows, aggregate, report };
}

const validationApi = { walkForwardSplits, roundTrips, overfittingReport, walkForward };
if (typeof module !== 'undefined') module.exports = validationApi;
if (typeof window !== 'undefined') window.Validation = validationApi;
