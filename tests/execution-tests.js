/*
 * Execution layer test suite: Revolut X connector boundaries.
 * Run: node tests/execution-tests.js
 * A recording mock transport proves the connector can never reach the
 * order endpoint unless mode, confirmation, and every guardrail pass.
 */
const E = require('../src/execution');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}
const close = (a, b, eps = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= eps;

function mockTransport() {
  const calls = [];
  return {
    calls,
    getPrices: async () => { calls.push('getPrices'); return { 'BTC-EUR': 54000 }; },
    getCandles: async () => { calls.push('getCandles'); return [[1, 2, 3, 4]]; },
    getBalances: async () => { calls.push('getBalances'); return { EUR: 1000 }; },
    getPositions: async () => { calls.push('getPositions'); return []; },
    listAssets: async () => { calls.push('listAssets'); return ['BTC-EUR']; },
    placeOrder: async (o) => { calls.push('placeOrder'); return { id: 'ord-1', ...o }; },
  };
}

const FIXED_NOW = () => 1751980000000;

/* a valid signal+recommendation fixture (shape produced by Stages 2-3) */
const SIGNAL = {
  direction: 'bullish', confidence: 55, actionable: true,
  reasons: ['trend confirmed: price above SMA50 above SMA200', 'momentum positive: RSI 62, MACD rising', 'volatility acceptable: 45% annualized (normal)'],
  rejections: [],
};
const REC = {
  valid: true, entry: 54000, stopLoss: 51000, takeProfit: 58500,
  riskReward: 1.5, units: 0.00333, positionEur: 180, riskEur: 10,
  confidence: 55, rejections: [],
  explanation: ['entry at 54,000.00, stop at 51,000.00 (2× ATR below), target at 58,500.00 (3× ATR above) → risk/reward 1.50'],
};

(async () => {

/* ---------- permission model ---------- */
{
  const t = mockTransport();
  const c = E.createConnector({ mode: 'disconnected', transport: t, now: FIXED_NOW });
  let threw = false;
  try { await c.getPrices(); } catch (e) { threw = /permission|disconnected/i.test(e.message); }
  check('disconnected: reads blocked', threw);
  check('disconnected: transport untouched', t.calls.length === 0);
}
{
  const t = mockTransport();
  const c = E.createConnector({ mode: 'read-only', transport: t, now: FIXED_NOW });
  const prices = await c.getPrices();
  check('read-only: prices readable', prices['BTC-EUR'] === 54000);
  await c.getCandles('BTC-EUR');
  await c.getBalances();
  await c.getPositions();
  await c.listAssets();
  check('read-only: all read methods pass through', t.calls.join(',') === 'getPrices,getCandles,getBalances,getPositions,listAssets');

  let threw = false;
  try {
    const p = E.createTradeProposal({ pair: 'BTC-EUR', signal: SIGNAL, recommendation: REC, now: FIXED_NOW });
    const confirmed = E.confirmProposal(p, 'CONFIRM TRADE', { now: FIXED_NOW });
    await c.placeOrder(confirmed.proposal);
  } catch (e) { threw = /read-only|permission/i.test(e.message); }
  check('read-only: order blocked even when confirmed', threw);
  check('read-only: order endpoint never called', !t.calls.includes('placeOrder'));
  check('read-only: refusal is logged', c.getLog().some(l => l.event === 'order_refused'));
}

/* ---------- trade proposal generation ---------- */
{
  const p = E.createTradeProposal({ pair: 'BTC-EUR', signal: SIGNAL, recommendation: REC, now: FIXED_NOW });
  check('proposal: core fields', p.pair === 'BTC-EUR' && p.direction === 'long'
    && close(p.entry, 54000) && close(p.stopLoss, 51000) && close(p.takeProfit, 58500));
  check('proposal: size and risk', close(p.positionEur, 180) && close(p.riskEur, 10) && close(p.riskReward, 1.5));
  check('proposal: reasoning carried over', p.reasoning.length >= 3
    && p.reasoning.some(r => /trend/i.test(r)));
  check('proposal: starts unconfirmed', p.confirmed === false && p.status === 'pending' && p.requiresConfirmation === true);

  const text = E.formatProposal(p);
  check('proposal: text includes pair and direction', /BTC-EUR/.test(text) && /long/i.test(text));
  check('proposal: text includes entry/stop/target', /54,000/.test(text) && /51,000/.test(text) && /58,500/.test(text));
  check('proposal: text demands confirmation', /CONFIRM TRADE/.test(text));

  let threw = false;
  try { E.createTradeProposal({ pair: 'BTC-EUR', signal: SIGNAL, recommendation: { ...REC, valid: false }, now: FIXED_NOW }); }
  catch (e) { threw = /invalid|valid/i.test(e.message); }
  check('proposal: refuses invalid recommendation', threw);
}

/* ---------- human confirmation gate ---------- */
{
  const p = E.createTradeProposal({ pair: 'BTC-EUR', signal: SIGNAL, recommendation: REC, now: FIXED_NOW });
  check('confirm: wrong phrase rejected', E.confirmProposal(p, 'yes please', { now: FIXED_NOW }).ok === false);
  check('confirm: lowercase rejected', E.confirmProposal(p, 'confirm trade', { now: FIXED_NOW }).ok === false);
  check('confirm: original object untouched', p.confirmed === false);

  const r = E.confirmProposal(p, 'CONFIRM TRADE', { now: FIXED_NOW });
  check('confirm: exact phrase accepted', r.ok === true && r.proposal.confirmed === true && r.proposal.status === 'confirmed');
}

/* ---------- trading mode guardrails ---------- */
{
  const mk = (guards) => {
    const t = mockTransport();
    const c = E.createConnector({ mode: 'trading', transport: t, now: FIXED_NOW, guards });
    return { t, c };
  };
  const confirmed = () => E.confirmProposal(
    E.createTradeProposal({ pair: 'BTC-EUR', signal: SIGNAL, recommendation: REC, now: FIXED_NOW }),
    'CONFIRM TRADE', { now: FIXED_NOW }).proposal;

  // happy path
  const { t, c } = mk({ maxPositionEur: 500, maxDailyLossEur: 50, maxPortfolioExposureEur: 800 });
  const res = await c.placeOrder(confirmed());
  check('trading: confirmed order placed', res.id === 'ord-1');
  check('trading: transport called once', t.calls.filter(x => x === 'placeOrder').length === 1);
  check('trading: order logged', c.getLog().some(l => l.event === 'order_placed'));

  // unconfirmed proposal
  const un = E.createTradeProposal({ pair: 'BTC-EUR', signal: SIGNAL, recommendation: REC, now: FIXED_NOW });
  let threw = false;
  try { await c.placeOrder(un); } catch (e) { threw = /confirm/i.test(e.message); }
  check('trading: unconfirmed order refused', threw);

  // position size guard
  const g1 = mk({ maxPositionEur: 100, maxDailyLossEur: 50, maxPortfolioExposureEur: 800 });
  threw = false;
  try { await g1.c.placeOrder(confirmed()); } catch (e) { threw = /position/i.test(e.message); }
  check('guard: max position size', threw && !g1.t.calls.includes('placeOrder'));

  // daily loss guard: two orders of riskEur 10 with a 15 cap -> second refused
  const g2 = mk({ maxPositionEur: 500, maxDailyLossEur: 15, maxPortfolioExposureEur: 800 });
  await g2.c.placeOrder(confirmed());
  threw = false;
  try { await g2.c.placeOrder(confirmed()); } catch (e) { threw = /daily loss/i.test(e.message); }
  check('guard: max daily loss accumulates', threw && g2.t.calls.filter(x => x === 'placeOrder').length === 1);

  // portfolio exposure guard: two positions of 180 with a 300 cap -> second refused
  const g3 = mk({ maxPositionEur: 500, maxDailyLossEur: 100, maxPortfolioExposureEur: 300 });
  await g3.c.placeOrder(confirmed());
  threw = false;
  try { await g3.c.placeOrder(confirmed()); } catch (e) { threw = /exposure/i.test(e.message); }
  check('guard: max portfolio exposure', threw);

  // emergency stop blocks orders but not reads
  const g4 = mk({ maxPositionEur: 500, maxDailyLossEur: 100, maxPortfolioExposureEur: 800 });
  g4.c.emergencyStop('manual kill switch test');
  threw = false;
  try { await g4.c.placeOrder(confirmed()); } catch (e) { threw = /emergency/i.test(e.message); }
  check('guard: emergency stop blocks orders', threw && !g4.t.calls.includes('placeOrder'));
  const stillReads = await g4.c.getPrices();
  check('guard: emergency stop keeps reads working', stillReads['BTC-EUR'] === 54000);
  check('guard: emergency stop logged', g4.c.getLog().some(l => l.event === 'emergency_stop'));

  // every refusal path is logged
  check('logging: refusals recorded with reasons', g1.c.getLog().concat(g2.c.getLog(), g3.c.getLog())
    .filter(l => l.event === 'order_refused').every(l => typeof l.reason === 'string' && l.reason.length > 5));
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);
})();
