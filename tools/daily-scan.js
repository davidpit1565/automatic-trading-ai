/*
 * Daily monitoring scan (Stage 4).
 * Runs the verified pipeline over data/dataset.json and prints a compact
 * report: per-asset direction/confidence, and — only when every quality
 * gate passes — the full risk-managed proposal text a human could act on.
 * Exit code 0 always (an all-quiet market is a normal result, not an error).
 * Run after refreshing data:
 *   bash tools/fetch-data.sh && node tools/validate-data.js && node tools/daily-scan.js
 */
const I = require('../src/indicators');
const Sig = require('../src/signals');
const R = require('../src/risk');
const E = require('../src/execution');
const DATASET = require('../data/dataset.json');

const EQUITY = Number(process.env.SCAN_EQUITY || 1000);
const rows = [];
const actionable = [];

for (const coin of DATASET.coins) {
  const s = Sig.evaluateSignal(coin.closes, coin.volumes);
  const atrArr = I.atr(coin.closes, coin.closes, coin.closes, 14);
  const price = coin.closes[coin.closes.length - 1];
  rows.push({
    symbol: coin.symbol,
    price,
    direction: s.direction,
    confidence: s.confidence,
    actionable: s.actionable,
    topReason: s.actionable ? s.reasons[s.reasons.length - 1] : (s.rejections[0] || ''),
  });
  if (s.actionable) {
    const rec = R.buildRecommendation({
      signal: s, price, atr: atrArr[atrArr.length - 1], atrIsCloseOnly: true,
      equity: EQUITY, openRiskEur: 0,
    });
    if (rec.valid) {
      actionable.push(E.formatProposal(E.createTradeProposal({
        pair: coin.symbol + '-EUR', signal: s, recommendation: rec,
      })));
    }
  }
}

console.log(`DAILY SCAN — data through ${DATASET.generatedAt.slice(0, 10)} (EUR, daily closes)`);
console.log('symbol  price          direction  conf  note');
for (const r of rows) {
  console.log(
    r.symbol.padEnd(7)
    + ('€' + r.price.toFixed(r.price < 10 ? 4 : 0)).padEnd(14)
    + (r.direction + (r.actionable ? '*' : '')).padEnd(11)
    + String(r.confidence).padEnd(6)
    + r.topReason.slice(0, 80));
}
console.log('');
if (actionable.length === 0) {
  console.log('RESULT: no asset passes the quality gates today. No alert warranted.');
} else {
  console.log(`RESULT: ${actionable.length} proposal(s) pass every gate (study output, not advice):\n`);
  for (const p of actionable) console.log(p + '\n');
}
