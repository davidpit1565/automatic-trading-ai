import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PaperPortfolio } from '../../src/core/portfolio/paperPortfolio';

const T = 1_700_000_000_000;

describe('PaperPortfolio', () => {
  it('buys reduce cash and create positions with average cost', () => {
    const portfolio = new PaperPortfolio(new MemoryStore(), 10_000);
    expect(portfolio.buy('BTC/USD', 0.05, 60_000, T).ok).toBe(true);
    expect(portfolio.buy('BTC/USD', 0.05, 80_000, T + 1).ok).toBe(true);
    expect(portfolio.cash).toBeCloseTo(3_000, 8);
    const [position] = portfolio.positions();
    expect(position?.quantity).toBeCloseTo(0.1, 12);
    expect(position?.avgCost).toBeCloseTo(70_000, 8);
  });

  it('rejects buys exceeding available cash', () => {
    const portfolio = new PaperPortfolio(new MemoryStore(), 100);
    const result = portfolio.buy('BTC/USD', 1, 60_000, T);
    expect(result.ok).toBe(false);
    expect(portfolio.cash).toBe(100);
    expect(portfolio.positions()).toEqual([]);
  });

  it('sells realize P&L against average cost and free cash', () => {
    const portfolio = new PaperPortfolio(new MemoryStore(), 10_000);
    portfolio.buy('ETH/USD', 2, 3_000, T);
    const result = portfolio.sell('ETH/USD', 1, 3_500, T + 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.realizedPnl).toBeCloseTo(500, 8);
    expect(portfolio.realizedPnl).toBeCloseTo(500, 8);
    expect(portfolio.cash).toBeCloseTo(10_000 - 6_000 + 3_500, 8);
    expect(portfolio.positions()[0]?.quantity).toBeCloseTo(1, 12);
  });

  it('rejects selling more than held', () => {
    const portfolio = new PaperPortfolio(new MemoryStore(), 10_000);
    portfolio.buy('ETH/USD', 1, 3_000, T);
    expect(portfolio.sell('ETH/USD', 2, 3_500, T + 1).ok).toBe(false);
    expect(portfolio.sell('SOL/USD', 1, 100, T + 1).ok).toBe(false);
  });

  it('removes fully closed positions', () => {
    const portfolio = new PaperPortfolio(new MemoryStore(), 10_000);
    portfolio.buy('ETH/USD', 1, 3_000, T);
    portfolio.sell('ETH/USD', 1, 3_100, T + 1);
    expect(portfolio.positions()).toEqual([]);
  });

  it('computes equity and unrealized P&L from market prices', () => {
    const portfolio = new PaperPortfolio(new MemoryStore(), 10_000);
    portfolio.buy('BTC/USD', 0.1, 60_000, T);
    expect(portfolio.equity({ 'BTC/USD': 70_000 })).toBeCloseTo(4_000 + 7_000, 8);
    expect(portfolio.unrealizedPnl({ 'BTC/USD': 70_000 })).toBeCloseTo(1_000, 8);
    // Unknown price: valued at cost, so no phantom P&L.
    expect(portfolio.unrealizedPnl({})).toBeCloseTo(0, 8);
  });

  it('persists across instances via the store and keeps a trade journal', () => {
    const store = new MemoryStore();
    const first = new PaperPortfolio(store, 10_000);
    first.buy('BTC/USD', 0.1, 60_000, T);
    first.sell('BTC/USD', 0.05, 65_000, T + 1);

    const restored = new PaperPortfolio(store, 999); // initialCash ignored when state exists
    expect(restored.cash).toBeCloseTo(10_000 - 6_000 + 3_250, 8);
    expect(restored.positions()[0]?.quantity).toBeCloseTo(0.05, 12);
    expect(restored.trades).toHaveLength(2);
    expect(restored.realizedPnl).toBeCloseTo(250, 8);
  });

  it('validates order inputs and reset', () => {
    const portfolio = new PaperPortfolio(new MemoryStore(), 1_000);
    expect(portfolio.buy('', 1, 10, T).ok).toBe(false);
    expect(portfolio.buy('X/Y', 0, 10, T).ok).toBe(false);
    expect(portfolio.buy('X/Y', 1, -5, T).ok).toBe(false);
    expect(() => portfolio.reset(0)).toThrow(RangeError);
    portfolio.reset(500);
    expect(portfolio.cash).toBe(500);
    expect(portfolio.trades).toEqual([]);
  });
});
