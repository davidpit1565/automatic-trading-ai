/*
 * Test suite for indicators.js and strategy.js.
 * Run: node tests/run-tests.js
 * Expected values are hand-computed; every assertion is independent.
 */
const I = require('../src/indicators');
const S = require('../src/strategy');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}
function close(a, b, eps = 1e-9) {
  return a !== null && b !== null && Math.abs(a - b) <= eps;
}

/* ---------- SMA ---------- */
{
  const r = I.sma([1, 2, 3, 4, 5], 3);
  check('sma warmup nulls', r[0] === null && r[1] === null);
  check('sma values', close(r[2], 2) && close(r[3], 3) && close(r[4], 4));
  check('sma length preserved', r.length === 5);
}

/* ---------- EMA ---------- */
{
  // period 3, k=0.5; seed=SMA(1,2,3)=2; then 4*.5+2*.5=3; 5*.5+3*.5=4
  const r = I.ema([1, 2, 3, 4, 5], 3);
  check('ema seed', close(r[2], 2));
  check('ema recursion', close(r[3], 3) && close(r[4], 4));
  check('ema warmup nulls', r[0] === null && r[1] === null);
  check('ema short input all null', I.ema([1, 2], 5).every(v => v === null));
}

/* ---------- RSI ---------- */
{
  const rising = Array.from({ length: 20 }, (_, i) => i + 1);
  const r1 = I.rsi(rising, 14);
  check('rsi all-gains = 100', close(r1[19], 100));

  const falling = Array.from({ length: 20 }, (_, i) => 20 - i);
  const r2 = I.rsi(falling, 14);
  check('rsi all-losses = 0', close(r2[19], 0));

  // 14 gains of 1 then one loss of 1:
  // avgGain=(1*13)/14, avgLoss=1/14 -> RS=13 -> RSI=100-100/14
  const seq = Array.from({ length: 15 }, (_, i) => i + 1).concat([15]);
  seq[15] = 14; // drop of 1 after 14 unit gains
  const r3 = I.rsi(seq, 14);
  check('rsi one-loss value', close(r3[15], 100 - 100 / 14, 1e-9));

  const flat = new Array(20).fill(5);
  check('rsi flat = 50', close(I.rsi(flat, 14)[19], 50));
  const bounded = I.rsi([3, 7, 2, 9, 4, 8, 1, 6, 5, 9, 2, 7, 3, 8, 4, 9, 2], 14)
    .filter(v => v !== null).every(v => v >= 0 && v <= 100);
  check('rsi bounded 0-100', bounded);
}

/* ---------- MACD ---------- */
{
  const flat = new Array(60).fill(10);
  const m = I.macd(flat);
  check('macd flat = 0', close(m.macd[59], 0) && close(m.signal[59], 0) && close(m.histogram[59], 0));

  const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
  const m2 = I.macd(rising);
  check('macd positive in steady uptrend', m2.macd[59] > 0);
  check('macd warmup null', m2.macd[10] === null);
}

/* ---------- rollingStd / Bollinger ---------- */
{
  // population std of [1..5] = sqrt(2)
  const r = I.rollingStd([1, 2, 3, 4, 5], 5);
  check('rollingStd known value', close(r[4], Math.sqrt(2)));

  const flat = new Array(25).fill(7);
  const b = I.bollinger(flat, 20, 2);
  check('bollinger flat bands collapse', close(b.upper[24], 7) && close(b.lower[24], 7) && close(b.middle[24], 7));

  const b2 = I.bollinger([1, 2, 3, 4, 5], 5, 2);
  check('bollinger known bands', close(b2.upper[4], 3 + 2 * Math.sqrt(2)) && close(b2.lower[4], 3 - 2 * Math.sqrt(2)));
  check('bollinger warmup null', b2.upper[3] === null);
}

/* ---------- volatility ---------- */
{
  const flat = new Array(40).fill(100);
  check('volatility of constant = 0', close(I.annualizedVolatility(flat, 30), 0));
  check('volatility short input null', I.annualizedVolatility([1, 2, 3], 30) === null);
  const noisy = Array.from({ length: 40 }, (_, i) => 100 * (1 + 0.05 * (i % 2)));
  check('volatility positive when prices move', I.annualizedVolatility(noisy, 30) > 0);
}

/* ---------- maxDrawdown ---------- */
{
  check('drawdown 10->5 = 50%', close(I.maxDrawdown([10, 5, 8]), 50));
  check('drawdown monotonic rise = 0', close(I.maxDrawdown([1, 2, 3]), 0));
  check('drawdown late peak', close(I.maxDrawdown([5, 10, 9, 12, 6]), 50)); // 12 -> 6
}

/* ---------- volumeRatio / pctChange ---------- */
{
  const vols = new Array(19).fill(100).concat([200]);
  // avg of last 20 = (19*100+200)/20 = 105; ratio = 200/105
  check('volumeRatio known', close(I.volumeRatio(vols, 20), 200 / 105));
  check('volumeRatio short input null', I.volumeRatio([1, 2], 20) === null);
  check('pctChange known', close(I.pctChange([100, 110, 121], 2), 21));
  check('pctChange too short null', I.pctChange([1, 2], 5) === null);
}

/* ---------- analyzeMarket ---------- */
{
  const up = Array.from({ length: 250 }, (_, i) => 100 * Math.pow(1.005, i));
  const a = I.analyzeMarket(up, new Array(250).fill(1000));
  check('analyze uptrend detected', a.trend === 'uptrend');
  check('analyze price is last close', close(a.price, up[249]));
  check('analyze rsi high in uptrend', a.rsi > 70);

  const down = Array.from({ length: 250 }, (_, i) => 100 * Math.pow(0.995, i));
  const d = I.analyzeMarket(down, new Array(250).fill(1000));
  check('analyze downtrend detected', d.trend === 'downtrend');
  check('analyze drawdown reported', d.maxDrawdown365 > 50);
  check('analyze fields present', 'volatilityRegime' in a && 'bollingerPosition' in a && 'macdState' in a);
}

/* ---------- buyHold ---------- */
{
  const r = S.buyHold([100, 110], 1000);
  check('buyHold final value', close(r.finalValue, 1100));
  check('buyHold return pct', close(r.returnPct, 10));
  check('buyHold equity curve', close(r.equity[0], 1000) && close(r.equity[1], 1100));
  const r2 = S.buyHold([100, 50, 75], 1000);
  check('buyHold drawdown', close(r2.maxDrawdownPct, 50));
}

/* ---------- DCA ---------- */
{
  // closes [100,200], interval 1 -> two buys of 500: 5 units + 2.5 units
  // final = 7.5 * 200 = 1500
  const r = S.dca([100, 200], 1000, 1);
  check('dca final value', close(r.finalValue, 1500));
  check('dca return pct', close(r.returnPct, 50));
  check('dca trade count', r.trades === 2);
  // interval wider than series -> single buy at bar 0 = buy & hold
  const r2 = S.dca([100, 110, 121], 1000, 10);
  check('dca single-buy equals buyHold', close(r2.finalValue, 1210));
}

/* ---------- trendFollow ---------- */
{
  // fast=1, slow=2: fast SMA = price, slow = 2-bar avg.
  // prices: 10,12,14 -> at i=1 fast(12)>slow(11): buy at 12. i=2 fast(14)>slow(13): hold.
  // final = 1000/12*14
  const r = S.trendFollow([10, 12, 14], 1000, 1, 2);
  check('trendFollow rides uptrend', close(r.finalValue, 1000 / 12 * 14));
  check('trendFollow one entry trade', r.trades === 1);
  // falling: 14,12,10 -> fast<slow always once ready -> stays in cash
  const r2 = S.trendFollow([14, 12, 10], 1000, 1, 2);
  check('trendFollow stays in cash in downtrend', close(r2.finalValue, 1000));
  // up then down: 10,12,14,12,10 -> buy at 12 (i=1); at i=3 fast(12)=slow(13)? slow=(14+12)/2=13, fast=12 -> exit at 12
  const r3 = S.trendFollow([10, 12, 14, 12, 10], 1000, 1, 2);
  check('trendFollow exits on cross-down', r3.trades === 2 && close(r3.finalValue, 1000));
}

/* ---------- gridBacktest ---------- */
{
  // Grid [90,100,110], 3 levels, 2 lots of 500 each.
  // Prices: 100, 90, 100.
  //  bar1: cross down through 90? prev=100 > 90, c=90 <= 90 -> buy lot0: 500/90 units.
  //         also level 100: prev=100 not > 100 -> no.
  //  bar2: cross up through 100 (prev 90 < 100, c=100 >= 100) -> sell lot0 at 100.
  //  P&L = 500/90*100 - 500 = 55.555...
  const r = S.gridBacktest([100, 90, 100], 1000, 90, 110, 3);
  check('grid buys low sells high', close(r.finalValue, 1000 + 500 / 90 * 100 - 500));
  check('grid trade count', r.trades === 2);
  // No crossings -> no trades, equity flat at capital
  const r2 = S.gridBacktest([100, 100, 100], 1000, 90, 110, 3);
  check('grid no crossings no trades', r2.trades === 0 && close(r2.finalValue, 1000));
  // Falling straight through -> buys but no sells; equity = cash + held*last
  const r3 = S.gridBacktest([120, 80], 1000, 90, 110, 3);
  // crossings down at 110 (lot1) and 90 (lot0) on same bar at price 80:
  // both lots buy 500 at 80. equity = 1000/80*80 = 1000 at that bar (bought at close).
  check('grid falling market holds lots', r3.trades === 2 && close(r3.finalValue, 1000));
  check('grid invalid throws', (() => { try { S.gridBacktest([1], 100, 110, 90, 3); return false; } catch { return true; } })());
}

/* ---------- ATR (Wilder) ---------- */
{
  // period 2: TR1 = max(11-9,|11-9|,|9-9|) = 2; TR2 = max(12-10,|12-10|,|10-10|) = 2
  // ATR[2] = mean(TR1,TR2) = 2
  const r = I.atr([10, 11, 12], [8, 9, 10], [9, 10, 11], 2);
  check('atr known value', close(r[2], 2));
  check('atr warmup nulls', r[0] === null && r[1] === null);
  check('atr length preserved', r.length === 3);

  // Gap day dominates: TR at idx1 = max(14-12, |14-9.5|, |12-9.5|) = 4.5
  // period 1 -> ATR[1] = 4.5, ATR[2] = (4.5*0 + TR2)/1 = TR2 = max(1, |13.5-13|, |12.5-13|) = 1
  const r2 = I.atr([10, 14, 13.5], [9, 12, 12.5], [9.5, 13, 13.2], 1);
  check('atr gap true range', close(r2[1], 4.5));

  // Wilder smoothing, period 2: TR3 = max(18-12, |18-11|, |12-11|) = 7
  // ATR[2] = 2, ATR[3] = (2*1 + 7)/2 = 4.5
  const r3 = I.atr([10, 11, 12, 18], [8, 9, 10, 12], [9, 10, 11, 17], 2);
  check('atr wilder smoothing', close(r3[3], 4.5));

  // Close-only degradation: h=l=c -> TR = |c - prevC|
  const c = [100, 102, 99, 99];
  const r4 = I.atr(c, c, c, 2);
  check('atr close-only equals mean abs delta', close(r4[2], (2 + 3) / 2)); // TRs: 2,3
  check('atr close-only smoothing', close(r4[3], (2.5 * 1 + 0) / 2));
  check('atr flat series is zero', close(I.atr([5,5,5,5],[5,5,5,5],[5,5,5,5], 2)[3], 0));
  check('atr short input all null', I.atr([1,2],[1,2],[1,2], 5).every(v => v === null));
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);
