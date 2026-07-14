/**
 * Realistic execution cost tests (TDD).
 *
 * The backtest engine gains optional, backwards-compatible cost modelling:
 * bid/ask spread, slippage, and execution delay. Defaults are zero so all
 * previously verified behaviour is unchanged; when set, every reported
 * result includes the costs.
 */

import { describe, expect, it } from 'vitest';
import { runBacktest, type Strategy } from '../../src/core/backtest/engine';
import { candlesFromCloses } from '../helpers';

const buySellStrategy: Strategy = {
  name: 'buy0-sell2',
  generateOrders: () => [
    { index: 0, side: 'buy' },
    { index: 2, side: 'sell' },
  ],
};

describe('spread and slippage', () => {
  it('buys pay above close and sells receive below close', () => {
    // Flat price 100. Spread 1% (half = 0.5%), slippage 0.25%.
    const candles = candlesFromCloses([100, 100, 100]);
    const result = runBacktest(candles, buySellStrategy, {
      initialCash: 1000,
      spreadPct: 0.01,
      slippagePct: 0.0025,
    });
    // Buy fill: 100 * 1.0075 = 100.75 -> quantity = 1000 / 100.75
    // Sell fill: 100 * 0.9925 -> proceeds = quantity * 99.25
    const quantity = 1000 / 100.75;
    expect(result.finalEquity).toBeCloseTo(quantity * 99.25, 8);
    expect(result.stats.totalPnl).toBeLessThan(0); // round trip costs money
    expect(result.closedTrades[0]?.entryPrice).toBeCloseTo(100.75, 8);
    expect(result.closedTrades[0]?.exitPrice).toBeCloseTo(99.25, 8);
  });

  it('costs compound with fees', () => {
    const candles = candlesFromCloses([100, 100]);
    const strategy: Strategy = {
      name: 'roundtrip',
      generateOrders: () => [
        { index: 0, side: 'buy' },
        { index: 1, side: 'sell' },
      ],
    };
    const frictionless = runBacktest(candles, strategy, { initialCash: 1000 });
    const costly = runBacktest(candles, strategy, {
      initialCash: 1000,
      feeRate: 0.001,
      spreadPct: 0.001,
      slippagePct: 0.0005,
    });
    expect(frictionless.finalEquity).toBeCloseTo(1000, 8);
    expect(costly.finalEquity).toBeLessThan(1000);
  });

  it('zero-cost defaults preserve verified behaviour exactly', () => {
    const candles = candlesFromCloses([100, 110, 120]);
    const plain = runBacktest(candles, buySellStrategy, { initialCash: 1000 });
    const explicitZeros = runBacktest(candles, buySellStrategy, {
      initialCash: 1000,
      spreadPct: 0,
      slippagePct: 0,
      executionDelayCandles: 0,
    });
    expect(explicitZeros).toEqual(plain);
    expect(plain.finalEquity).toBeCloseTo(1200, 8);
  });

  it('rejects invalid cost parameters', () => {
    const candles = candlesFromCloses([100, 101]);
    const noop: Strategy = { name: 'noop', generateOrders: () => [] };
    expect(() =>
      runBacktest(candles, noop, { initialCash: 1000, spreadPct: -0.01 }),
    ).toThrow(RangeError);
    expect(() =>
      runBacktest(candles, noop, { initialCash: 1000, slippagePct: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      runBacktest(candles, noop, { initialCash: 1000, executionDelayCandles: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      runBacktest(candles, noop, { initialCash: 1000, executionDelayCandles: 1.5 }),
    ).toThrow(RangeError);
  });
});

describe('execution delay', () => {
  it('fills orders N candles after the signal', () => {
    // Signal at index 0, price rises; delayed fill buys at index 1's close.
    const candles = candlesFromCloses([100, 110, 120, 130]);
    const strategy: Strategy = {
      name: 'delayed',
      generateOrders: () => [{ index: 0, side: 'buy' }],
    };
    const immediate = runBacktest(candles, strategy, { initialCash: 1000 });
    const delayed = runBacktest(candles, strategy, {
      initialCash: 1000,
      executionDelayCandles: 1,
    });
    // Immediate: 10 units at 100 -> 1300. Delayed: 1000/110 units -> *130.
    expect(immediate.finalEquity).toBeCloseTo(1300, 8);
    expect(delayed.finalEquity).toBeCloseTo((1000 / 110) * 130, 8);
  });

  it('clamps delayed fills to the final candle so positions still close', () => {
    const candles = candlesFromCloses([100, 110, 120]);
    const strategy: Strategy = {
      name: 'late-sell',
      generateOrders: () => [
        { index: 0, side: 'buy' },
        { index: 2, side: 'sell' }, // would land at index 3 with delay 1
      ],
    };
    const result = runBacktest(candles, strategy, {
      initialCash: 1000,
      executionDelayCandles: 1,
    });
    // Buy fills at index 1 (110), sell clamps to last candle (120).
    expect(result.stats.tradeCount).toBe(1);
    expect(result.finalEquity).toBeCloseTo((1000 / 110) * 120, 8);
  });
});
