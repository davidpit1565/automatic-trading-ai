/*
 * Strategy backtesting engine.
 * Pure functions over arrays of daily closes. Every backtest returns:
 *   { finalValue, returnPct, maxDrawdownPct, trades, equity, tradeLog }
 * where `equity` is the portfolio value at every bar (same length as input)
 * and `tradeLog` records every execution {bar, side, price, units}.
 * Backtests describe THE PAST ONLY; they are not predictions.
 *
 * REALISTIC COST MODEL (all optional, default zero — zero-cost results are
 * identical to the original verified engine):
 *   costs = { feePct, spreadPct, slippagePct, delayBars }
 *   buy exec price  = close × (1 + (spreadPct/2 + slippagePct)/100)
 *   sell exec price = close × (1 − (spreadPct/2 + slippagePct)/100)
 *   fee: a buy spending N cash yields N·(1 − feePct/100)/execPrice units;
 *        a sell credits units·execPrice·(1 − feePct/100)
 *   delayBars (trendFollow only): a signal computed at bar i executes at
 *        the close of bar i + delayBars (later signals supersede earlier).
 *   Open positions are marked to market at the close, with no
 *   hypothetical exit costs until an actual exit.
 */

/* Requires indicators.js (sma, maxDrawdown) — injected or global. */
function _deps() {
  if (typeof module !== 'undefined') return require('./indicators');
  return window.Indicators;
}

function _costModel(costs) {
  const c = costs || {};
  const half = ((c.spreadPct || 0) / 2 + (c.slippagePct || 0)) / 100;
  return {
    fee: (c.feePct || 0) / 100,
    buyMult: 1 + half,
    sellMult: 1 - half,
    delay: c.delayBars || 0,
  };
}

function _result(equity, trades, tradeLog) {
  const { maxDrawdown } = _deps();
  const finalValue = equity[equity.length - 1];
  return {
    finalValue,
    returnPct: (finalValue / equity[0] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    trades,
    equity,
    tradeLog: tradeLog || [],
  };
}

/* Put all capital in at bar 0, hold to the end. */
function buyHold(closes, capital, costs) {
  const cm = _costModel(costs);
  const exec = closes[0] * cm.buyMult;
  const units = capital * (1 - cm.fee) / exec;
  const equity = closes.map(c => units * c);
  return _result(equity, 1, [{ bar: 0, side: 'buy', price: exec, units }]);
}

/*
 * Dollar-cost averaging: split capital into equal buys every
 * `intervalDays` bars starting at bar 0. Uninvested cash earns nothing.
 */
function dca(closes, capital, intervalDays = 7, costs) {
  const cm = _costModel(costs);
  const buyBars = [];
  for (let i = 0; i < closes.length; i += intervalDays) buyBars.push(i);
  const perBuy = capital / buyBars.length;
  let units = 0, cash = capital, next = 0;
  const equity = [], tradeLog = [];
  for (let i = 0; i < closes.length; i++) {
    if (next < buyBars.length && i === buyBars[next]) {
      const exec = closes[i] * cm.buyMult;
      const bought = perBuy * (1 - cm.fee) / exec;
      units += bought;
      cash -= perBuy;
      tradeLog.push({ bar: i, side: 'buy', price: exec, units: bought });
      next++;
    }
    equity.push(cash + units * closes[i]);
  }
  return _result(equity, buyBars.length, tradeLog);
}

/*
 * Trend following: fully long while SMA(fast) > SMA(slow), else in cash.
 * Signals are computed on the close; with delayBars = d the state change
 * executes at the close d bars later.
 */
function trendFollow(closes, capital, fast = 20, slow = 50, costs) {
  const { sma } = _deps();
  const cm = _costModel(costs);
  const fastMa = sma(closes, fast);
  const slowMa = sma(closes, slow);
  // desired[i]: true = long, false = cash (false during warmup: no position)
  const desired = closes.map((_, i) =>
    fastMa[i] !== null && slowMa[i] !== null && fastMa[i] > slowMa[i]);
  let cash = capital, units = 0, trades = 0;
  const equity = [], tradeLog = [];
  for (let i = 0; i < closes.length; i++) {
    const target = i >= cm.delay ? desired[i - cm.delay] : false;
    if (target && units === 0) {
      const exec = closes[i] * cm.buyMult;
      units = cash * (1 - cm.fee) / exec;
      tradeLog.push({ bar: i, side: 'buy', price: exec, units });
      cash = 0; trades++;
    } else if (!target && units > 0) {
      const exec = closes[i] * cm.sellMult;
      cash = units * exec * (1 - cm.fee);
      tradeLog.push({ bar: i, side: 'sell', price: exec, units });
      units = 0; trades++;
    }
    equity.push(cash + units * closes[i]);
  }
  return _result(equity, trades, tradeLog);
}

/*
 * Grid strategy: `levels` evenly spaced price levels in [lower, upper].
 * Capital is split into (levels - 1) equal lots. When the close crosses
 * DOWN through a level, one lot buys; that lot sells when the close
 * crosses back UP through the level ABOVE its buy level. Unrealistic
 * fills between bars are ignored (daily-close approximation).
 */
function gridBacktest(closes, capital, lower, upper, levels = 5, costs) {
  if (!(upper > lower) || levels < 2) throw new Error('invalid grid');
  const cm = _costModel(costs);
  const step = (upper - lower) / (levels - 1);
  const gridPrices = Array.from({ length: levels }, (_, i) => lower + i * step);
  const lotCash = capital / (levels - 1);
  // openLots[i] = units bought at grid level i (sell target = level i+1)
  const openLots = new Array(levels).fill(0);
  let cash = capital, trades = 0;
  const equity = [], tradeLog = [];
  let prev = closes[0];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    for (let g = 0; g < levels - 1; g++) {
      const lv = gridPrices[g];
      // Cross down through level g -> buy one lot (if free cash for it)
      if (prev > lv && c <= lv && openLots[g] === 0 && cash >= lotCash - 1e-9) {
        const exec = c * cm.buyMult;
        openLots[g] = lotCash * (1 - cm.fee) / exec;
        cash -= lotCash;
        tradeLog.push({ bar: i, side: 'buy', price: exec, units: openLots[g] });
        trades++;
      }
      // Cross up through level g+1 -> sell the lot bought at level g
      const sellLv = gridPrices[g + 1];
      if (prev < sellLv && c >= sellLv && openLots[g] > 0) {
        const exec = c * cm.sellMult;
        cash += openLots[g] * exec * (1 - cm.fee);
        tradeLog.push({ bar: i, side: 'sell', price: exec, units: openLots[g] });
        openLots[g] = 0;
        trades++;
      }
    }
    const held = openLots.reduce((a, u) => a + u, 0);
    equity.push(cash + held * c);
    prev = c;
  }
  return _result(equity, trades, tradeLog);
}

const api = { buyHold, dca, trendFollow, gridBacktest };
if (typeof module !== 'undefined') module.exports = api;
if (typeof window !== 'undefined') window.Strategy = api;
