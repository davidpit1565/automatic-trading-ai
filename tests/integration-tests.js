/*
 * Integration tests: data → indicators → signals → risk on the real
 * validated dataset (data/dataset.json). Run: node tests/integration-tests.js
 */
const I = require('../src/indicators');
const Sig = require('../src/signals');
const R = require('../src/risk');
const DATASET = require('../data/dataset.json');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}
const close = (a, b, eps = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= eps;

check('dataset present with 8 coins', DATASET.coins.length === 8);

const EQUITY = 1000;
let actionableCount = 0;

for (const coin of DATASET.coins) {
  const { closes, volumes, symbol } = coin;
  let s;
  try {
    s = Sig.evaluateSignal(closes, volumes);
  } catch (e) {
    check(`${symbol}: signal engine throws (${e.message})`, false);
    continue;
  }
  check(`${symbol}: direction valid`, ['bullish', 'bearish', 'neutral'].includes(s.direction));
  check(`${symbol}: confidence in bounds`, s.confidence >= 0 && s.confidence <= 100);
  check(`${symbol}: actionable only if bullish and clean`,
    !s.actionable || (s.direction === 'bullish' && s.rejections.length === 0));
  check(`${symbol}: reasons non-empty`, s.reasons.length > 0);

  const atrArr = I.atr(closes, closes, closes, 14);
  const atr = atrArr[atrArr.length - 1];
  check(`${symbol}: ATR computable and positive`, atr !== null && atr > 0);

  const rec = R.buildRecommendation({
    signal: s, price: closes[closes.length - 1], atr, atrIsCloseOnly: true,
    equity: EQUITY, openRiskEur: 0,
  });
  if (s.actionable) {
    actionableCount++;
    if (rec.valid) {
      // internal arithmetic consistency, recomputed from the plan itself
      check(`${symbol}: R/R consistent`, close(rec.riskReward,
        (rec.takeProfit - rec.entry) / (rec.entry - rec.stopLoss), 1e-9));
      check(`${symbol}: risk = units × stop distance`, close(rec.riskEur,
        rec.units * (rec.entry - rec.stopLoss), 1e-6));
      check(`${symbol}: risk within 1% budget`, rec.riskEur <= EQUITY * 0.01 + 1e-9);
      check(`${symbol}: position within 20% cap`, rec.positionEur <= EQUITY * 0.20 + 1e-9);
      check(`${symbol}: stop < entry < target`, rec.stopLoss < rec.entry && rec.entry < rec.takeProfit);
      check(`${symbol}: explanation present`, rec.explanation.length >= 3);
    } else {
      // an actionable signal may still fail risk gates (e.g. stop <= 0) — must say why
      check(`${symbol}: risk rejection explained`, rec.rejections.length > 0);
    }
  } else {
    check(`${symbol}: no plan for non-actionable signal`, rec.valid === false);
  }
}

// End-to-end reproducibility on real data: recompute BTC's confidence
{
  const btc = DATASET.coins.find(c => c.symbol === 'BTC');
  const s = Sig.evaluateSignal(btc.closes, btc.volumes);
  const vf = s.components.volatility.factor, uf = s.components.volume.factor;
  const expected = Math.round(Math.min(100, Math.abs(s.directionalScore) * 100 * vf * uf));
  check('BTC: confidence reproducible on real data', s.confidence === expected);
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total (actionable today: ${actionableCount}/8)`);
process.exit(fail === 0 ? 0 : 1);
