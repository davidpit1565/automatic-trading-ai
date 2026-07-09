/*
 * Stage 2 test suite: signal engine.
 * Run: node tests/signals-tests.js
 * Every confidence score must be reproducible from indicator values —
 * several tests recompute the documented formula independently.
 */
const I = require('../src/indicators');
const Sig = require('../src/signals');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}
const close = (a, b, eps = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= eps;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- helper factors (exported for direct testing) ---------- */
{
  check('volumeFactor at average = 1.0', close(Sig._volumeFactor(1), 1));
  check('volumeFactor capped high', close(Sig._volumeFactor(3), 1.1));
  check('volumeFactor floored low', close(Sig._volumeFactor(0.2), 0.85));
  check('volumeFactor null = 1.0', close(Sig._volumeFactor(null), 1));
  check('volatilityFactor calm', close(Sig._volatilityFactor(20), 1));
  check('volatilityFactor normal', close(Sig._volatilityFactor(45), 1));
  check('volatilityFactor elevated', close(Sig._volatilityFactor(80), 0.75));
  check('volatilityFactor extreme', close(Sig._volatilityFactor(150), 0.4));
}

/* ---------- insufficient history ---------- */
{
  const s = Sig.evaluateSignal(new Array(50).fill(100), new Array(50).fill(1000));
  check('short history: neutral', s.direction === 'neutral');
  check('short history: zero confidence', s.confidence === 0);
  check('short history: not actionable', s.actionable === false);
  check('short history: rejection says insufficient', s.rejections.some(r => /insufficient/i.test(r)));
}

/* ---------- flat market ---------- */
{
  const s = Sig.evaluateSignal(new Array(250).fill(100), new Array(250).fill(1000));
  check('flat: neutral direction', s.direction === 'neutral');
  check('flat: trend score 0', close(s.components.trend.score, 0));
  check('flat: not actionable', s.actionable === false);
}

/* ---------- strong downtrend ---------- */
{
  const closes = Array.from({ length: 250 }, (_, i) => 1000 * Math.pow(0.995, i));
  const s = Sig.evaluateSignal(closes, new Array(250).fill(1000));
  check('downtrend: bearish', s.direction === 'bearish');
  check('downtrend: trend score -1', close(s.components.trend.score, -1));
  check('downtrend: not actionable (spot)', s.actionable === false);
  check('downtrend: rejection mentions no-short/avoid', s.rejections.some(r => /short|avoid/i.test(r)));
}

/* ---------- parabolic uptrend: overbought gate ---------- */
{
  const closes = Array.from({ length: 250 }, (_, i) => 100 * Math.pow(1.01, i));
  const vols = new Array(250).fill(1000);
  const s = Sig.evaluateSignal(closes, vols);
  check('parabolic: bullish direction', s.direction === 'bullish');
  check('parabolic: trend score +1', close(s.components.trend.score, 1));
  check('parabolic: overbought rejection', s.rejections.some(r => /overbought/i.test(r)));
  check('parabolic: not actionable', s.actionable === false);

  // Reproducibility: recompute confidence from raw indicator values
  const rsiArr = I.rsi(closes, 14);
  const rsiV = rsiArr[rsiArr.length - 1];
  const m = I.macd(closes);
  const hist = m.histogram[m.histogram.length - 1];
  const momentum = clamp((rsiV - 50) / 25, -1, 1) * 0.5 + (hist > 0 ? 0.5 : hist < 0 ? -0.5 : 0);
  const vol30 = I.annualizedVolatility(closes, 30);
  const vf = Sig._volatilityFactor(vol30);
  const uf = Sig._volumeFactor(I.volumeRatio(vols, 20));
  const directional = 0.6 * 1 + 0.4 * momentum;
  const expected = Math.round(Math.min(100, Math.abs(directional) * 100 * vf * uf));
  check('parabolic: confidence reproducible from indicators', s.confidence === expected);
  check('parabolic: directionalScore matches formula', close(s.directionalScore, directional, 1e-12));
}

/* ---------- determinism ---------- */
{
  const closes = Array.from({ length: 250 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1);
  const vols = Array.from({ length: 250 }, (_, i) => 1000 + (i % 5) * 100);
  const a = Sig.evaluateSignal(closes, vols);
  const b = Sig.evaluateSignal(closes, vols);
  check('deterministic output', JSON.stringify(a) === JSON.stringify(b));
  check('confidence bounded 0..100', a.confidence >= 0 && a.confidence <= 100);
  check('confidence is integer', Number.isInteger(a.confidence));
}

/* ---------- extreme volatility gate ---------- */
{
  // Alternating ±8% daily with upward drift: annualized vol >> 100%
  const closes = [100];
  for (let i = 1; i < 250; i++) closes.push(closes[i - 1] * (i % 2 ? 1.09 : 0.93));
  const s = Sig.evaluateSignal(closes, new Array(250).fill(1000));
  check('extreme vol: factor 0.4', close(s.components.volatility.factor, 0.4));
  check('extreme vol: rejection present', s.rejections.some(r => /extreme volatility/i.test(r)));
  check('extreme vol: not actionable', s.actionable === false);
}

/* ---------- conflict gate ---------- */
{
  // Long uptrend keeps price > SMA50 > SMA200, then a sharp 8-day slide
  // turns momentum hard negative while trend structure is still intact.
  const closes = [];
  let p = 100;
  for (let i = 0; i < 242; i++) { p *= 1.006; closes.push(p); }
  for (let i = 0; i < 8; i++) { p *= 0.988; closes.push(p); }
  const s = Sig.evaluateSignal(closes, new Array(250).fill(1000));
  check('conflict: trend still positive', s.components.trend.score >= 0.5);
  check('conflict: momentum negative', s.components.momentum.score <= -0.5);
  check('conflict: rejection present', s.rejections.some(r => /conflict/i.test(r)));
  check('conflict: not actionable', s.actionable === false);
}

/* ---------- valid actionable setup ---------- */
{
  // Established uptrend, mild consolidation, fresh push with strong volume:
  // structurally bullish, RSI not overbought, healthy volatility.
  const closes = [];
  let p = 100;
  for (let i = 0; i < 180; i++) { p *= 1.004; closes.push(p); }             // steady rise
  for (let i = 0; i < 60; i++) { p *= (i % 2 ? 1.0005 : 0.9995); closes.push(p); } // consolidation
  for (let i = 0; i < 10; i++) { p *= (i % 2 ? 0.999 : 1.003); closes.push(p); } // fresh two-steps-forward push
  const vols = new Array(250).fill(1000).map((v, i) => i >= 240 ? 1600 : v); // volume expands on push
  const s = Sig.evaluateSignal(closes, vols);
  check('setup: bullish', s.direction === 'bullish');
  check('setup: rsi below overbought', s.components.momentum.rsi < 75);
  check('setup: no rejections', s.rejections.length === 0);
  check('setup: actionable', s.actionable === true);
  check('setup: confidence >= 40', s.confidence >= 40);
  check('setup: volume factor > 1', s.components.volume.factor > 1);
  check('setup: reasons include numbers', s.reasons.join(' ').includes(s.components.momentum.rsi.toFixed(0)));

  // Reproducibility on the actionable case too
  const vf = s.components.volatility.factor, uf = s.components.volume.factor;
  const expected = Math.round(Math.min(100, Math.abs(s.directionalScore) * 100 * vf * uf));
  check('setup: confidence reproducible', s.confidence === expected);
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);
