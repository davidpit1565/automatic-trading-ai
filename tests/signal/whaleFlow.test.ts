import { describe, expect, it } from 'vitest';
import { isWhaleFlowBearish, type RecentTradeLike } from '../../src/core/signal/whaleFlow';

const buy = (notional: number): RecentTradeLike => ({ price: 1, volume: notional, side: 'buy' });
const sell = (notional: number): RecentTradeLike => ({ price: 1, volume: notional, side: 'sell' });

describe('isWhaleFlowBearish', () => {
  it('flags heavy net selling among the largest trades as bearish', () => {
    const trades = [
      sell(1000), sell(900), sell(800), sell(700), sell(600), // large sells
      buy(50), buy(40), buy(30), buy(20), buy(10), // small buys (noise)
      buy(100), // one mid-size buy, still outweighed
    ];
    // largeFraction 1 so all 11 trades count as "large" here — isolates the
    // net buy/sell notional comparison from the large-slice cutoff, tested
    // separately below.
    expect(isWhaleFlowBearish(trades, { largeFraction: 1, minLargeTrades: 5 })).toBe(true);
  });

  it('does not flag heavy net buying among the largest trades', () => {
    const trades = [
      buy(1000), buy(900), buy(800), buy(700), buy(600),
      sell(50), sell(40), sell(30), sell(20), sell(10),
      sell(100),
    ];
    expect(isWhaleFlowBearish(trades, { largeFraction: 1, minLargeTrades: 5 })).toBe(false);
  });

  it('does not flag a roughly balanced large-trade tape', () => {
    const trades = [buy(1000), sell(950), buy(900), sell(850), buy(800), sell(750)];
    expect(isWhaleFlowBearish(trades, { largeFraction: 1, minLargeTrades: 5 })).toBe(false);
  });

  it('by default, only the top 20% of trades by notional count as "large"', () => {
    // 30 trades: 6 huge sells (exactly the top 20%) surrounded by small buys
    // that would flip the verdict if they were allowed to dilute the large
    // slice — proving the cutoff, not just the comparison, is exercised.
    const bigSells = Array.from({ length: 6 }, (_, i) => sell(1000 - i));
    const smallBuys = Array.from({ length: 24 }, (_, i) => buy(10 + i));
    expect(isWhaleFlowBearish([...bigSells, ...smallBuys])).toBe(true);
  });

  it('fails safe (not bearish) with too few large trades to judge', () => {
    const trades = [sell(1000), sell(900)]; // only 2, below the default minimum of 5
    expect(isWhaleFlowBearish(trades)).toBe(false);
  });

  it('fails safe (not bearish) on an empty trade tape', () => {
    expect(isWhaleFlowBearish([])).toBe(false);
  });

  it('respects a custom bearish threshold and minimum sample size', () => {
    const trades = [sell(600), sell(500), buy(400), buy(300), buy(200)];
    // 55% sell share: bearish at a lenient 0.5 threshold, not at the default 0.65.
    expect(isWhaleFlowBearish(trades, { minLargeTrades: 5, largeFraction: 1 })).toBe(false);
    expect(isWhaleFlowBearish(trades, { minLargeTrades: 5, largeFraction: 1, bearishThreshold: 0.5 })).toBe(true);
  });
});
