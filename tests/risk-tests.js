/*
 * Stage 3 test suite: risk engine.
 * Run: node tests/risk-tests.js
 * Sizing, stops, targets, and caps are hand-computed; property blocks
 * verify the risk cap can never be exceeded.
 */
const R = require('../src/risk');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}
const close = (a, b, eps = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= eps;

const SIGNAL_OK = { direction: 'bullish', confidence: 60, actionable: true };

/* ---------- textbook sizing case ----------
 * equity 10000, risk 1% = €100; entry 100, ATR 5 (true-range),
 * stop = 100 - 2*5 = 90, target = 100 + 3*5 = 115, R/R = 15/10 = 1.5
 * units = 100 / 10 = 10, position = 10*100 = €1000 (10% of equity, under cap)
 */
{
  const r = R.buildRecommendation({
    signal: SIGNAL_OK, price: 100, atr: 5, atrIsCloseOnly: false,
    equity: 10000, openRiskEur: 0,
  });
  check('sizing: valid', r.valid === true);
  check('sizing: entry', close(r.entry, 100));
  check('sizing: stop', close(r.stopLoss, 90));
  check('sizing: target', close(r.takeProfit, 115));
  check('sizing: risk/reward', close(r.riskReward, 1.5));
  check('sizing: units', close(r.units, 10));
  check('sizing: position value', close(r.positionEur, 1000));
  check('sizing: risk €100', close(r.riskEur, 100));
  check('sizing: confidence passthrough', r.confidence === 60);
  check('sizing: explanation mentions stop', r.explanation.join(' ').includes('90'));
}

/* ---------- close-only ATR calibration ----------
 * close-only ATR 5 with factor 2 behaves like true ATR 10:
 * stop = 100 - 20 = 80, units = 100/20 = 5
 */
{
  const r = R.buildRecommendation({
    signal: SIGNAL_OK, price: 100, atr: 5, atrIsCloseOnly: true,
    equity: 10000, openRiskEur: 0,
  });
  check('calibration: stop uses doubled ATR', close(r.stopLoss, 80));
  check('calibration: units halved vs raw', close(r.units, 5));
  check('calibration: explanation mentions calibration', r.explanation.join(' ').toLowerCase().includes('close-only'));
}

/* ---------- position cap ----------
 * Tiny ATR would size a huge position: entry 100, true ATR 0.5 -> stop 99,
 * units = 100/1 = 100 -> position €10000 = 100% of equity.
 * Cap at 20%: position €2000, units 20, effective risk = 20*1 = €20 (< €100).
 */
{
  const r = R.buildRecommendation({
    signal: SIGNAL_OK, price: 100, atr: 0.5, atrIsCloseOnly: false,
    equity: 10000, openRiskEur: 0,
  });
  check('cap: position capped at 20%', close(r.positionEur, 2000));
  check('cap: units recomputed', close(r.units, 20));
  check('cap: effective risk below budget', close(r.riskEur, 20));
  check('cap: still valid', r.valid === true);
  check('cap: explanation mentions cap', r.explanation.join(' ').includes('20%'));
}

/* ---------- rejection gates ---------- */
{
  const base = { signal: SIGNAL_OK, price: 100, atr: 5, atrIsCloseOnly: false, equity: 10000, openRiskEur: 0 };

  const r1 = R.buildRecommendation({ ...base, signal: { ...SIGNAL_OK, confidence: 30 } });
  check('gate: low confidence rejected', r1.valid === false && r1.rejections.some(x => /confidence/i.test(x)));

  const r2 = R.buildRecommendation({ ...base, signal: { ...SIGNAL_OK, direction: 'bearish' } });
  check('gate: non-bullish rejected', r2.valid === false);

  const r3 = R.buildRecommendation({ ...base, signal: { ...SIGNAL_OK, actionable: false } });
  check('gate: non-actionable rejected', r3.valid === false);

  const r4 = R.buildRecommendation({ ...base, atr: null });
  check('gate: missing ATR rejected', r4.valid === false && r4.rejections.some(x => /atr/i.test(x)));

  const r5 = R.buildRecommendation({ ...base, atr: 0 });
  check('gate: zero ATR rejected', r5.valid === false);

  // stop would be <= 0: entry 10, true ATR 6 -> stop = -2
  const r6 = R.buildRecommendation({ ...base, price: 10, atr: 6 });
  check('gate: non-positive stop rejected', r6.valid === false && r6.rejections.some(x => /stop/i.test(x)));

  // min R/R: force target multiple below stop multiple
  const r7 = R.buildRecommendation({ ...base, config: { atrTargetMult: 2, atrStopMult: 2 } });
  check('gate: R/R below minimum rejected', r7.valid === false && r7.rejections.some(x => /reward/i.test(x)));

  // portfolio exposure: open risk 4.5% + new 1% > 5% cap
  const r8 = R.buildRecommendation({ ...base, openRiskEur: 450 });
  check('gate: portfolio risk cap rejected', r8.valid === false && r8.rejections.some(x => /portfolio/i.test(x)));

  // dust position: equity €200, 1% risk = €2, entry 100 ATR 5 -> units 0.2, position €20 >= €10 min ok
  // equity €50 -> risk €0.5 -> position €5 < €10 minimum
  const r9 = R.buildRecommendation({ ...base, equity: 50 });
  check('gate: dust position rejected', r9.valid === false && r9.rejections.some(x => /minimum|small/i.test(x)));
}

/* ---------- properties: the risk budget is a hard ceiling ---------- */
{
  let holds = true, rrHolds = true, orderHolds = true;
  const cases = [];
  for (const equity of [500, 1000, 10000, 250000]) {
    for (const price of [0.05, 1, 60, 55000]) {
      for (const atrPct of [0.005, 0.02, 0.05, 0.12]) {
        cases.push({ equity, price, atr: price * atrPct });
      }
    }
  }
  for (const c of cases) {
    const r = R.buildRecommendation({
      signal: SIGNAL_OK, price: c.price, atr: c.atr, atrIsCloseOnly: false,
      equity: c.equity, openRiskEur: 0,
    });
    if (!r.valid) continue;
    if (r.riskEur > c.equity * 0.01 + 1e-9) holds = false;
    if (r.riskReward < 1.5 - 1e-9) rrHolds = false;
    if (!(r.stopLoss < r.entry && r.entry < r.takeProfit)) orderHolds = false;
  }
  check('property: risk never exceeds 1% of equity', holds);
  check('property: R/R never below minimum', rrHolds);
  check('property: stop < entry < target always', orderHolds);
}

/* ---------- floating-point boundary regression ----------
 * With messy real-world numbers, (target − entry)/stopDistance can come
 * out as 1.4999999999999998 for the default 3×/2× plan; the minimum-R/R
 * gate must not reject its own default by rounding noise.
 */
{
  const r = R.buildRecommendation({
    signal: SIGNAL_OK, price: 204.66760144, atr: 0.26454817875428327,
    atrIsCloseOnly: true, equity: 1000, openRiskEur: 0,
  });
  check('float: boundary R/R accepted', r.valid === true);
  check('float: R/R still reported ~1.5', close(r.riskReward, 1.5, 1e-9));
}

/* ---------- determinism ---------- */
{
  const args = { signal: SIGNAL_OK, price: 100, atr: 5, atrIsCloseOnly: false, equity: 10000, openRiskEur: 0 };
  check('deterministic', JSON.stringify(R.buildRecommendation(args)) === JSON.stringify(R.buildRecommendation(args)));
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);
