/*
 * Stage 3.5 test suite: validation harness.
 * Run: node tests/validation-tests.js
 */
const V = require('../src/validation');
const S = require('../src/strategy');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}
const close = (a, b, eps = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= eps;

/* ---------- walk-forward splitting ---------- */
{
  const w = V.walkForwardSplits(100, { trainBars: 30, testBars: 10, step: 10 });
  check('splits: count', w.length === 7);
  check('splits: first window', w[0].trainStart === 0 && w[0].trainEnd === 29
    && w[0].testStart === 30 && w[0].testEnd === 39);
  check('splits: rolling by step', w[1].trainStart === 10 && w[1].testStart === 40);
  check('splits: last window inside data', w[6].testEnd === 99);
  check('splits: train and test never overlap', w.every(x => x.trainEnd < x.testStart));

  check('splits: step defaults to testBars', V.walkForwardSplits(100, { trainBars: 30, testBars: 10 }).length === 7);
  check('splits: too little data -> empty', V.walkForwardSplits(35, { trainBars: 30, testBars: 10 }).length === 0);
  check('splits: exact fit -> one window', V.walkForwardSplits(40, { trainBars: 30, testBars: 10 }).length === 1);
}

/* ---------- round trips & win rate ---------- */
{
  const log = [
    { bar: 2, side: 'buy', price: 100, units: 1 },
    { bar: 5, side: 'sell', price: 110, units: 1 },   // win +10
    { bar: 8, side: 'buy', price: 100, units: 2 },
    { bar: 9, side: 'sell', price: 95, units: 2 },    // loss -10
    { bar: 12, side: 'buy', price: 50, units: 1 },    // still open -> excluded
  ];
  const rt = V.roundTrips(log);
  check('roundTrips: count excludes open position', rt.trips.length === 2);
  check('roundTrips: pnl values', close(rt.trips[0].pnl, 10) && close(rt.trips[1].pnl, -10));
  check('roundTrips: win rate', close(rt.winRate, 0.5));
  check('roundTrips: empty log', V.roundTrips([]).trips.length === 0 && V.roundTrips([]).winRate === null);
}

/* ---------- overfitting report rules ---------- */
{
  const ok = V.overfittingReport({ paramCount: 2, trades: 30, winRate: 0.6, inSampleReturnPct: 20, outSampleReturnPct: 15 });
  check('report: healthy -> acceptable', ok.verdict === 'acceptable' && ok.flags.length === 0);

  const collapse = V.overfittingReport({ paramCount: 2, trades: 30, winRate: 0.6, inSampleReturnPct: 20, outSampleReturnPct: 5 });
  check('report: OOS < half IS -> collapse flag', collapse.flags.some(f => /collapse/i.test(f)));
  check('report: collapse -> rejected', collapse.verdict === 'rejected');

  const flip = V.overfittingReport({ paramCount: 2, trades: 30, winRate: 0.6, inSampleReturnPct: 20, outSampleReturnPct: -3 });
  check('report: OOS negative while IS positive -> rejected', flip.verdict === 'rejected');

  const lucky = V.overfittingReport({ paramCount: 2, trades: 25, winRate: 0.95, inSampleReturnPct: 20, outSampleReturnPct: 18 });
  check('report: unrealistic win rate flagged', lucky.flags.some(f => /win rate/i.test(f)));
  check('report: unrealistic win rate -> rejected', lucky.verdict === 'rejected');

  const thin = V.overfittingReport({ paramCount: 2, trades: 8, winRate: 0.6, inSampleReturnPct: 20, outSampleReturnPct: 15 });
  check('report: low sample flagged', thin.flags.some(f => /sample/i.test(f)));
  check('report: low sample alone -> caution', thin.verdict === 'caution');

  const bloated = V.overfittingReport({ paramCount: 6, trades: 30, winRate: 0.6, inSampleReturnPct: 20, outSampleReturnPct: 15 });
  check('report: too many parameters flagged', bloated.flags.some(f => /parameter/i.test(f)));
  check('report: too many parameters -> caution', bloated.verdict === 'caution');

  const edgeless = V.overfittingReport({ paramCount: 2, trades: 30, winRate: 0.6, inSampleReturnPct: -5, outSampleReturnPct: -2 });
  check('report: no in-sample edge -> rejected', edgeless.verdict === 'rejected' && edgeless.flags.some(f => /in-sample/i.test(f)));

  check('report: every flag is explained text', collapse.flags.every(f => typeof f === 'string' && f.length > 10));
}

/* ---------- walk-forward end-to-end on synthetic data ---------- */
const GRID = [{ fast: 5, slow: 20 }, { fast: 10, slow: 30 }];
{
  // clean uptrend: OOS should be positive in every window
  const up = Array.from({ length: 200 }, (_, i) => 100 * Math.pow(1.004, i));
  const r = V.walkForward(up, { paramGrid: GRID, trainBars: 60, testBars: 30, step: 30 });
  check('wf: window count', r.windows.length === V.walkForwardSplits(200, { trainBars: 60, testBars: 30, step: 30 }).length);
  check('wf: every OOS window positive on uptrend', r.windows.every(w => w.outSampleReturnPct > 0));
  check('wf: chosen params come from the grid', r.windows.every(w => GRID.some(g => g.fast === w.params.fast && g.slow === w.params.slow)));
  check('wf: aggregate present', typeof r.aggregate.outSampleReturnPct === 'number'
    && typeof r.aggregate.benchmarkOosReturnPct === 'number');
  check('wf: report attached', ['acceptable', 'caution', 'rejected'].includes(r.report.verdict));

  const r2 = V.walkForward(up, { paramGrid: GRID, trainBars: 60, testBars: 30, step: 30 });
  check('wf: deterministic', JSON.stringify(r) === JSON.stringify(r2));

  // realistic costs must not improve results
  const costly = V.walkForward(up, {
    paramGrid: GRID, trainBars: 60, testBars: 30, step: 30,
    costs: { feePct: 1, spreadPct: 1, slippagePct: 0.5 },
  });
  check('wf: costs never improve OOS', costly.aggregate.outSampleReturnPct <= r.aggregate.outSampleReturnPct + 1e-9);
}

{
  // deliberately overfit case: pure seeded noise — optimizing on train data
  // must NOT earn an "acceptable" verdict out of sample
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const noise = [100];
  for (let i = 1; i < 300; i++) noise.push(Math.max(1, noise[i - 1] * (0.97 + rnd() * 0.06)));
  const r = V.walkForward(noise, { paramGrid: GRID, trainBars: 60, testBars: 30, step: 30 });
  check('wf: overfit-on-noise is not acceptable', r.report.verdict !== 'acceptable');
  check('wf: rejection is explained', r.report.flags.length > 0);
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);
