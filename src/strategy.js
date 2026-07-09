/*
 * Strategy backtesting engine.
 * Pure functions over arrays of daily closes. Every backtest returns:
 *   { finalValue, returnPct, maxDrawdownPct, trades, equity }
 * where `equity` is the portfolio value at every bar (same length as input).
 * Backtests describe THE PAST ONLY; they are not predictions.
 */

/* Requires indicators.js (sma, maxDrawdown) — injected or global. */
function _deps() {
  if (typeof module !== 'undefined') return require('./indicators');
  return window.Indicators;
}

function _result(equity, trades) {
  const { maxDrawdown } = _deps();
  const finalValue = equity[equity.length - 1];
  return {
    finalValue,
    returnPct: (finalValue / equity[0] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    trades,
    equity,
  };
}

/* Put all capital in at bar 0, hold to the end. */
function buyHold(closes, capital) {
  const units = capital / closes[0];
  const equity = closes.map(c => units * c);
  return _result(equity, 1);
}

/*
 * Dollar-cost averaging: split capital into equal buys every
 * `intervalDays` bars starting at bar 0. Uninvested cash earns nothing.
 */
function dca(closes, capital, intervalDays = 7) {
  const buyBars = [];
  for (let i = 0; i < closes.length; i += intervalDays) buyBars.push(i);
  const perBuy = capital / buyBars.length;
  let units = 0, cash = capital, next = 0;
  const equity = [];
  for (let i = 0; i < closes.length; i++) {
    if (next < buyBars.length && i === buyBars[next]) {
      units += perBuy / closes[i];
      cash -= perBuy;
      next++;
    }
    equity.push(cash + units * closes[i]);
  }
  return _result(equity, buyBars.length);
}

/*
 * Trend following: fully long while SMA(fast) > SMA(slow), else in cash.
 * Trades on the close of the bar where the state flips.
 */
function trendFollow(closes, capital, fast = 20, slow = 50) {
  const { sma } = _deps();
  const fastMa = sma(closes, fast);
  const slowMa = sma(closes, slow);
  let cash = capital, units = 0, trades = 0;
  const equity = [];
  for (let i = 0; i < closes.length; i++) {
    const ready = fastMa[i] !== null && slowMa[i] !== null;
    if (ready && fastMa[i] > slowMa[i] && units === 0) {
      units = cash / closes[i]; cash = 0; trades++;
    } else if (ready && fastMa[i] <= slowMa[i] && units > 0) {
      cash = units * closes[i]; units = 0; trades++;
    }
    equity.push(cash + units * closes[i]);
  }
  return _result(equity, trades);
}

/*
 * Grid strategy: `levels` evenly spaced price levels in [lower, upper].
 * Capital is split into (levels - 1) equal lots. When the close crosses
 * DOWN through a level, one lot buys; that lot sells when the close
 * crosses back UP through the level ABOVE its buy level. Unrealistic
 * fills between bars are ignored (daily-close approximation).
 */
function gridBacktest(closes, capital, lower, upper, levels = 5) {
  if (!(upper > lower) || levels < 2) throw new Error('invalid grid');
  const step = (upper - lower) / (levels - 1);
  const gridPrices = Array.from({ length: levels }, (_, i) => lower + i * step);
  const lotCash = capital / (levels - 1);
  // openLots[i] = units bought at grid level i (sell target = level i+1)
  const openLots = new Array(levels).fill(0);
  let cash = capital, trades = 0;
  const equity = [];
  let prev = closes[0];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    for (let g = 0; g < levels - 1; g++) {
      const lv = gridPrices[g];
      // Cross down through level g -> buy one lot (if free cash for it)
      if (prev > lv && c <= lv && openLots[g] === 0 && cash >= lotCash - 1e-9) {
        openLots[g] = lotCash / c;
        cash -= lotCash;
        trades++;
      }
      // Cross up through level g+1 -> sell the lot bought at level g
      const sellLv = gridPrices[g + 1];
      if (prev < sellLv && c >= sellLv && openLots[g] > 0) {
        cash += openLots[g] * c;
        openLots[g] = 0;
        trades++;
      }
    }
    const held = openLots.reduce((a, u) => a + u, 0);
    equity.push(cash + held * c);
    prev = c;
  }
  return _result(equity, trades);
}

const api = { buyHold, dca, trendFollow, gridBacktest };
if (typeof module !== 'undefined') module.exports = api;
if (typeof window !== 'undefined') window.Strategy = api;
