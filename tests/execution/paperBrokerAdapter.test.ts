import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PaperBrokerAdapter } from '../../src/core/execution/paperBrokerAdapter';
import type { OrderIntent } from '../../src/core/execution/types';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';

function approvedAssessment(overrides: Partial<TradeRiskAssessment> = {}): TradeRiskAssessment {
  return {
    approved: true,
    asset: 'BTCEUR',
    entry: 100,
    stopLoss: 95,
    takeProfit: 115,
    positionSize: 2,
    positionValue: 200,
    riskAmount: 10,
    riskPercentage: 1,
    rewardRiskRatio: 3,
    portfolioExposure: 2,
    reasons: ['confidence above floor'],
    warnings: [],
    ...overrides,
  };
}

function buildIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  const assessment = approvedAssessment(overrides.assessment as Partial<TradeRiskAssessment>);
  return {
    id: 'BTCEUR:1:0',
    createdAt: 1_000,
    mode: 'paper',
    symbol: 'BTCEUR',
    side: 'buy',
    quantity: 2,
    limitPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
    assessment,
    ...overrides,
  };
}

function setup() {
  const store = new MemoryStore();
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'EUR' });
  const killSwitch = new PersistedKillSwitch(store);
  const broker = new PaperBrokerAdapter(portfolio, killSwitch);
  return { store, portfolio, killSwitch, broker };
}

describe('PaperBrokerAdapter (paper-only, no network — Stage 6 machinery)', () => {
  it('fills a buy order by opening a paper position and deducting cash', async () => {
    const { portfolio, broker } = setup();
    const report = await broker.submit(buildIntent());
    expect(report.state).toBe('filled');
    expect(report.filledQuantity).toBe(2);
    expect(report.avgFillPrice).toBe(100);
    expect(portfolio.openPositions()).toHaveLength(1);
    expect(portfolio.cash()).toBeCloseTo(10_000 - 200, 5);
  });

  it('refuses every order while the kill switch is engaged, without touching the portfolio', async () => {
    const { portfolio, killSwitch, broker } = setup();
    killSwitch.engage('test halt');
    const report = await broker.submit(buildIntent());
    expect(report.state).toBe('cancelled');
    expect(portfolio.openPositions()).toHaveLength(0);
  });

  it('rejects a live-mode order — this adapter only ever accepts paper orders', async () => {
    const { broker, portfolio } = setup();
    const report = await broker.submit(buildIntent({ mode: 'live' }));
    expect(report.state).toBe('rejected');
    expect(portfolio.openPositions()).toHaveLength(0);
  });

  it('rejects an unapproved assessment instead of opening a position anyway', async () => {
    const { broker, portfolio } = setup();
    const report = await broker.submit(buildIntent({ assessment: approvedAssessment({ approved: false }) }));
    expect(report.state).toBe('rejected');
    expect(portfolio.openPositions()).toHaveLength(0);
  });

  it('fills a sell order by closing the matching open position', async () => {
    const { portfolio, broker } = setup();
    await broker.submit(buildIntent());
    const report = await broker.submit(
      buildIntent({ id: 'BTCEUR:2:0', side: 'sell', quantity: 2, limitPrice: 110, createdAt: 2_000 }),
    );
    expect(report.state).toBe('filled');
    expect(portfolio.openPositions()).toHaveLength(0);
    // Bought 2 @ 100 (200 spent), sold 2 @ 110 (220 back) — net +20 realized.
    expect(portfolio.cash()).toBeCloseTo(10_000 + 20, 5);
  });

  it('rejects a sell order when there is no matching open position', async () => {
    const { broker } = setup();
    const report = await broker.submit(buildIntent({ side: 'sell' }));
    expect(report.state).toBe('rejected');
    expect(report.detail).toContain('no open');
  });

  it('cancel() is always a no-op acknowledgement — submit() never leaves an order in-flight', async () => {
    const { broker } = setup();
    const report = await broker.cancel('some-intent-id');
    expect(report.state).toBe('cancelled');
  });

  it('fetchPositions() reports the portfolio\'s real open positions', async () => {
    const { broker } = setup();
    await broker.submit(buildIntent());
    const positions = await broker.fetchPositions();
    expect(positions).toEqual([{ symbol: 'BTCEUR', quantity: 2, avgCost: 100 }]);
  });
});
