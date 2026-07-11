/**
 * Portfolio Engine tests (TDD): cash accounting around the Position Engine,
 * equity/exposure/allocation snapshots, daily return tracking, configurable
 * base currency.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';

const T = 1_700_000_000_000;
const DAY = 86_400_000;

function makePortfolio(initialCash = 10_000) {
  const store = new MemoryStore();
  const positions = new PositionEngine(store, new TradeJournal(store));
  const portfolio = new PortfolioEngine(store, positions, {
    initialCash,
    baseCurrency: 'USD',
  });
  return { portfolio, positions, store };
}

const openInput = {
  symbol: 'BTC-USD', quantity: 10, entryPrice: 100, stopLoss: 95, takeProfit: 110,
};

describe('cash accounting', () => {
  it('opening deducts cost + fee; closing credits proceeds - fee', () => {
    const { portfolio } = makePortfolio();
    const opened = portfolio.open({ ...openInput, timestamp: T, fee: 5 });
    expect(opened.ok).toBe(true);
    expect(portfolio.cash()).toBeCloseTo(10_000 - 1_000 - 5, 10);

    if (!opened.ok) return;
    portfolio.exit(opened.value.id, { quantity: 10, price: 110, timestamp: T + 1, reason: 'take-profit', fee: 11 });
    expect(portfolio.cash()).toBeCloseTo(8_995 + 1_100 - 11, 10);
  });

  it('opens from an approved trade proposal and refuses rejected ones', () => {
    const { portfolio } = makePortfolio();
    const assessment = {
      approved: true,
      asset: 'BTC-USD',
      entry: 100,
      stopLoss: 95,
      takeProfit: 110,
      positionSize: 10,
      positionValue: 1000,
      riskAmount: 50,
      riskPercentage: 0.5,
      rewardRiskRatio: 2,
      portfolioExposure: 10,
      reasons: [],
      warnings: [],
    };
    const opened = portfolio.openFromAssessment(assessment, { timestamp: T, confidence: 60 });
    expect(opened.ok).toBe(true);
    expect(portfolio.cash()).toBeCloseTo(9_000, 10);
    if (opened.ok) expect(opened.value.confidence).toBe(60);

    const refused = portfolio.openFromAssessment(
      { ...assessment, approved: false },
      { timestamp: T },
    );
    expect(refused.ok).toBe(false);
    expect(portfolio.cash()).toBeCloseTo(9_000, 10);
  });

  it('refuses to open beyond available cash', () => {
    const { portfolio } = makePortfolio(500);
    const result = portfolio.open({ ...openInput, timestamp: T });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('cash');
    expect(portfolio.cash()).toBe(500);
  });
});

describe('snapshot', () => {
  it('reports equity, invested capital, exposure, allocation, and largest position', () => {
    const { portfolio } = makePortfolio();
    portfolio.open({ ...openInput, timestamp: T });
    portfolio.open({
      symbol: 'ETH-USD', quantity: 5, entryPrice: 200, stopLoss: 180, takeProfit: 240, timestamp: T,
    });

    const snapshot = portfolio.snapshot({ 'BTC-USD': 110, 'ETH-USD': 190 }, T + 1);
    expect(snapshot.baseCurrency).toBe('USD');
    expect(snapshot.cash).toBeCloseTo(8_000, 10);
    // Market values: BTC 1,100 + ETH 950 = 2,050.
    expect(snapshot.investedValue).toBeCloseTo(2_050, 10);
    expect(snapshot.equity).toBeCloseTo(10_050, 10);
    expect(snapshot.unrealizedPnl).toBeCloseTo(100 - 50, 10);
    expect(snapshot.exposurePct).toBeCloseTo((2_050 / 10_050) * 100, 8);
    expect(snapshot.largestPosition).toMatchObject({ symbol: 'BTC-USD' });
    expect(snapshot.allocation.find((a) => a.symbol === 'BTC-USD')!.pctOfEquity).toBeCloseTo(
      (1_100 / 10_050) * 100,
      8,
    );
    expect(snapshot.cashAvailable).toBeCloseTo(8_000, 10);
    expect(snapshot.totalReturnPct).toBeCloseTo(0.5, 8);
  });

  it('includes realized P&L after closing trades', () => {
    const { portfolio } = makePortfolio();
    const opened = portfolio.open({ ...openInput, timestamp: T });
    if (!opened.ok) return;
    portfolio.exit(opened.value.id, { quantity: 10, price: 110, timestamp: T + 1, reason: 'take-profit' });
    const snapshot = portfolio.snapshot({}, T + 2);
    expect(snapshot.realizedPnl).toBeCloseTo(100, 10);
    expect(snapshot.equity).toBeCloseTo(10_100, 10);
    expect(snapshot.totalReturnPct).toBeCloseTo(1, 8);
  });

  it('tracks daily return against the first snapshot of each UTC day', () => {
    const { portfolio } = makePortfolio();
    const opened = portfolio.open({ ...openInput, timestamp: T });
    if (!opened.ok) return;

    // First snapshot of the day anchors the day-start equity (10,000 flat).
    const first = portfolio.snapshot({ 'BTC-USD': 100 }, T);
    expect(first.dailyPnl).toBeCloseTo(0, 10);

    const later = portfolio.snapshot({ 'BTC-USD': 105 }, T + 3_600_000);
    expect(later.dailyPnl).toBeCloseTo(50, 10);
    expect(later.dailyReturnPct).toBeCloseTo(0.5, 8);

    // A new day re-anchors.
    const nextDay = portfolio.snapshot({ 'BTC-USD': 105 }, T + DAY);
    expect(nextDay.dailyPnl).toBeCloseTo(0, 10);
  });

  it('persists cash and day anchors across instances', () => {
    const { portfolio, store, positions } = makePortfolio();
    portfolio.open({ ...openInput, timestamp: T });
    const restored = new PortfolioEngine(store, positions, { initialCash: 999, baseCurrency: 'EUR' });
    // Saved state wins over constructor defaults.
    expect(restored.cash()).toBeCloseTo(9_000, 10);
    expect(restored.snapshot({}, T + 1).baseCurrency).toBe('USD');
  });

  it('rejects invalid initial cash', () => {
    const store = new MemoryStore();
    const positions = new PositionEngine(store, new TradeJournal(store));
    expect(
      () => new PortfolioEngine(store, positions, { initialCash: 0, baseCurrency: 'USD' }),
    ).toThrow(RangeError);
  });
});
