import { describe, expect, it } from 'vitest';
import { compareStrategies, runBacktest, type Strategy } from '../../src/core/backtest/engine';
import { candlesFromCloses } from '../helpers';

const CONFIG = { initialCash: 1000 };

describe('runBacktest', () => {
  it('computes P&L for a simple buy-then-sell', () => {
    const candles = candlesFromCloses([100, 110, 120]);
    const strategy: Strategy = {
      name: 'test',
      generateOrders: () => [
        { index: 0, side: 'buy' },
        { index: 2, side: 'sell' },
      ],
    };
    const result = runBacktest(candles, strategy, CONFIG);
    // 1000 buys 10 units at 100, sold at 120 -> 1200.
    expect(result.finalEquity).toBeCloseTo(1200, 8);
    expect(result.totalReturnPct).toBeCloseTo(20, 8);
    expect(result.stats.tradeCount).toBe(1);
    expect(result.closedTrades[0]?.pnl).toBeCloseTo(200, 8);
  });

  it('deducts proportional fees on both sides', () => {
    const candles = candlesFromCloses([100, 100]);
    const strategy: Strategy = {
      name: 'fees',
      generateOrders: () => [
        { index: 0, side: 'buy' },
        { index: 1, side: 'sell' },
      ],
    };
    const result = runBacktest(candles, strategy, { initialCash: 1000, feeRate: 0.01 });
    // Buy: 1000 spend, 10 fee -> 9.9 units. Sell at 100: gross 990, fee 9.9.
    expect(result.feesPaid).toBeCloseTo(19.9, 8);
    expect(result.finalEquity).toBeCloseTo(980.1, 8);
    expect(result.stats.totalPnl).toBeLessThan(0);
  });

  it('tracks equity per candle including unrealized value', () => {
    const candles = candlesFromCloses([100, 150, 50, 100]);
    const strategy: Strategy = {
      name: 'hold',
      generateOrders: () => [{ index: 0, side: 'buy' }],
    };
    const result = runBacktest(candles, strategy, CONFIG);
    expect(result.equityCurve.map((p) => p.equity)).toEqual([1000, 1500, 500, 1000]);
    expect(result.maxDrawdownPct).toBeCloseTo(((1500 - 500) / 1500) * 100, 8);
  });

  it('supports partial sells with average cost basis', () => {
    const candles = candlesFromCloses([100, 200]);
    const strategy: Strategy = {
      name: 'partial',
      generateOrders: () => [
        { index: 0, side: 'buy' },
        { index: 1, side: 'sell', fractionOfPosition: 0.5 },
      ],
    };
    const result = runBacktest(candles, strategy, CONFIG);
    // 10 units at 100; sell 5 at 200 -> cash 1000, position 5*200 = 1000.
    expect(result.finalEquity).toBeCloseTo(2000, 8);
    expect(result.closedTrades[0]?.quantity).toBeCloseTo(5, 8);
    expect(result.closedTrades[0]?.pnl).toBeCloseTo(500, 8);
  });

  it('ignores sells with no position and buys with no cash', () => {
    const candles = candlesFromCloses([100, 100, 100]);
    const strategy: Strategy = {
      name: 'noop-ish',
      generateOrders: () => [
        { index: 0, side: 'sell' },
        { index: 1, side: 'buy' },
        { index: 2, side: 'buy' }, // no cash left
      ],
    };
    const result = runBacktest(candles, strategy, CONFIG);
    expect(result.stats.tradeCount).toBe(0);
    expect(result.finalEquity).toBeCloseTo(1000, 8);
  });

  it('rejects invalid configs and order indices', () => {
    const candles = candlesFromCloses([100, 101]);
    const bad: Strategy = { name: 'bad', generateOrders: () => [{ index: 99, side: 'buy' }] };
    expect(() => runBacktest(candles, bad, CONFIG)).toThrow(RangeError);
    const noop: Strategy = { name: 'noop', generateOrders: () => [] };
    expect(() => runBacktest([], noop, CONFIG)).toThrow(RangeError);
    expect(() => runBacktest(candles, noop, { initialCash: 0 })).toThrow(RangeError);
    expect(() => runBacktest(candles, noop, { initialCash: 100, feeRate: 1 })).toThrow(RangeError);
  });
});

describe('compareStrategies', () => {
  it('runs all strategies over identical data and config', () => {
    const candles = candlesFromCloses([100, 110, 121]);
    const hold: Strategy = { name: 'A', generateOrders: () => [{ index: 0, side: 'buy' }] };
    const idle: Strategy = { name: 'B', generateOrders: () => [] };
    const [a, b] = compareStrategies(candles, [hold, idle], CONFIG);
    expect(a?.strategyName).toBe('A');
    expect(a?.finalEquity).toBeCloseTo(1210, 8);
    expect(b?.finalEquity).toBeCloseTo(1000, 8);
  });
});
