import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../src/core/backtest/engine';
import {
  buyAndHoldStrategy,
  computeGridLevels,
  dcaStrategy,
  gridStrategy,
  trendStrategy,
} from '../../src/core/strategies';
import { candlesFromCloses } from '../helpers';

const CONFIG = { initialCash: 1000 };

describe('buyAndHoldStrategy', () => {
  it('captures the full move from first to last close', () => {
    const result = runBacktest(candlesFromCloses([100, 90, 130]), buyAndHoldStrategy(), CONFIG);
    expect(result.finalEquity).toBeCloseTo(1300, 8);
    expect(result.stats.tradeCount).toBe(1);
  });

  it('emits no orders for a single candle', () => {
    expect(buyAndHoldStrategy().generateOrders(candlesFromCloses([100]))).toEqual([]);
  });
});

describe('dcaStrategy', () => {
  it('spreads purchases at the configured interval and liquidates at the end', () => {
    const strategy = dcaStrategy({ intervalCandles: 2, amountPerPurchase: 250 });
    const candles = candlesFromCloses([100, 100, 50, 50, 100]);
    const orders = strategy.generateOrders(candles);
    // No buy on the final candle — it is the liquidation candle.
    expect(orders.filter((o) => o.side === 'buy').map((o) => o.index)).toEqual([0, 2]);
    expect(orders[orders.length - 1]).toEqual({ index: 4, side: 'sell' });
    const result = runBacktest(candles, strategy, CONFIG);
    // Buys: 250@100 = 2.5u, 250@50 = 5u -> 7.5u sold @100 = 750,
    // plus 500 never-invested cash = 1250 total.
    expect(result.finalEquity).toBeCloseTo(1250, 8);
  });

  it('outperforms lump-sum buy & hold when price dips below the entry', () => {
    const candles = candlesFromCloses([100, 60, 60, 60, 80]);
    const dca = runBacktest(
      candles,
      dcaStrategy({ intervalCandles: 1, amountPerPurchase: 200 }),
      CONFIG,
    );
    const hold = runBacktest(candles, buyAndHoldStrategy(), CONFIG);
    expect(dca.finalEquity).toBeGreaterThan(hold.finalEquity);
  });

  it('rejects invalid options', () => {
    expect(() => dcaStrategy({ intervalCandles: 0, amountPerPurchase: 100 })).toThrow(RangeError);
    expect(() => dcaStrategy({ intervalCandles: 1, amountPerPurchase: 0 })).toThrow(RangeError);
  });
});

describe('trendStrategy', () => {
  it('buys on golden cross and closes the position by the end', () => {
    // Flat, then strong rise: fast SMA crosses above slow SMA during the rise.
    const closes = [...Array(12).fill(100), ...Array.from({ length: 20 }, (_, i) => 100 + (i + 1) * 5)];
    const strategy = trendStrategy({ fastPeriod: 3, slowPeriod: 8 });
    const orders = strategy.generateOrders(candlesFromCloses(closes));
    expect(orders[0]?.side).toBe('buy');
    expect(orders[orders.length - 1]?.side).toBe('sell');
    const result = runBacktest(candlesFromCloses(closes), strategy, CONFIG);
    expect(result.finalEquity).toBeGreaterThan(1000);
  });

  it('emits no orders when there is never a cross', () => {
    // Monotonic decline from the start: fast stays below slow.
    const closes = Array.from({ length: 40 }, (_, i) => 200 - i * 2);
    const orders = trendStrategy({ fastPeriod: 3, slowPeriod: 8 }).generateOrders(
      candlesFromCloses(closes),
    );
    expect(orders).toEqual([]);
  });

  it('never emits a sell before a buy and alternates sides', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i * 0.25) * 20);
    const orders = trendStrategy({ fastPeriod: 5, slowPeriod: 15 }).generateOrders(
      candlesFromCloses(closes),
    );
    let position = false;
    for (const order of orders) {
      if (order.side === 'buy') {
        expect(position).toBe(false);
        position = true;
      } else {
        expect(position).toBe(true);
        position = false;
      }
    }
  });

  it('rejects fast >= slow', () => {
    expect(() => trendStrategy({ fastPeriod: 10, slowPeriod: 10 })).toThrow(RangeError);
  });
});

describe('grid', () => {
  it('computes evenly spaced levels inclusive of both bounds', () => {
    expect(computeGridLevels(100, 200, 5)).toEqual([100, 125, 150, 175, 200]);
    expect(() => computeGridLevels(200, 100, 5)).toThrow(RangeError);
    expect(() => computeGridLevels(100, 200, 1)).toThrow(RangeError);
  });

  it('buys dips through levels and sells recoveries', () => {
    const strategy = gridStrategy({
      lowerBound: 90,
      upperBound: 110,
      levels: 3, // 90, 100, 110
      amountPerLevel: 100,
    });
    // 105 -> 95 crosses down through 100 (buy) -> 112 crosses up through 110 (sell).
    const candles = candlesFromCloses([105, 95, 112]);
    const orders = strategy.generateOrders(candles);
    expect(orders.map((o) => o.side)).toEqual(['buy', 'sell']);
    const result = runBacktest(candles, strategy, CONFIG);
    // Bought 100/95 units at 95, sold at 112: profit ≈ 17.89.
    expect(result.stats.totalPnl).toBeGreaterThan(0);
  });

  it('liquidates remaining slots on the final candle', () => {
    const strategy = gridStrategy({ lowerBound: 90, upperBound: 110, levels: 3, amountPerLevel: 100 });
    // Price falls through 100 and 90 and never recovers.
    const candles = candlesFromCloses([105, 95, 85, 80]);
    const orders = strategy.generateOrders(candles);
    expect(orders[orders.length - 1]).toEqual({ index: 3, side: 'sell' });
    const result = runBacktest(candles, strategy, CONFIG);
    expect(result.stats.totalPnl).toBeLessThan(0); // honest loss, no hidden bags
  });

  it('emits nothing when price never touches the grid', () => {
    const strategy = gridStrategy({ lowerBound: 90, upperBound: 110, levels: 3, amountPerLevel: 100 });
    expect(strategy.generateOrders(candlesFromCloses([150, 155, 160]))).toEqual([]);
  });
});
