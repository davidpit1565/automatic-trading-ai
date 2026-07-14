/**
 * Performance metrics tests (TDD).
 *
 * Metrics used by the validation harness: win rate (reused), profit factor,
 * expectancy, Sharpe ratio (documented convention: mean/std of per-candle
 * equity returns, annualised, risk-free rate 0), average trade P&L, and
 * average holding time.
 */

import { describe, expect, it } from 'vitest';
import type { BacktestResult } from '../../src/core/backtest/engine';
import { tradeStats, type ClosedTrade, type EquityPoint } from '../../src/core/backtest/metrics';
import {
  performanceReport,
  periodsPerYearFor,
  sharpeRatio,
} from '../../src/core/validation/performance';

const HOUR = 3_600_000;

function trade(pnl: number, holdMs = HOUR): ClosedTrade {
  return {
    entryTimestamp: 0,
    exitTimestamp: holdMs,
    entryPrice: 100,
    exitPrice: 100 + pnl,
    quantity: 1,
    pnl,
  };
}

function curve(values: number[]): EquityPoint[] {
  return values.map((equity, i) => ({ timestamp: i * HOUR, equity }));
}

function fakeResult(trades: ClosedTrade[], equity: number[]): BacktestResult {
  const equityCurve = curve(equity);
  return {
    strategyName: 'test',
    initialCash: equity[0] ?? 1000,
    finalEquity: equity[equity.length - 1] ?? 1000,
    totalReturnPct: (((equity[equity.length - 1] ?? 0) - (equity[0] ?? 0)) / (equity[0] ?? 1)) * 100,
    maxDrawdownPct: 0,
    feesPaid: 0,
    equityCurve,
    closedTrades: trades,
    stats: tradeStats(trades),
  };
}

describe('sharpeRatio', () => {
  it('is null for constant equity (zero variance) or too few points', () => {
    expect(sharpeRatio(curve([100, 100, 100]), 8760)).toBeNull();
    expect(sharpeRatio(curve([100]), 8760)).toBeNull();
    expect(sharpeRatio([], 8760)).toBeNull();
  });

  it('matches a hand-computed example', () => {
    // Equity 100 -> 110 -> 104.5: returns +10%, -5%.
    // mean = 0.025, population std = 0.075, periodsPerYear = 4.
    // Sharpe = 0.025 / 0.075 * 2 = 0.6667
    const value = sharpeRatio(curve([100, 110, 104.5]), 4);
    expect(value).toBeCloseTo((0.025 / 0.075) * 2, 6);
  });

  it('is positive for steady growth and negative for steady decline', () => {
    const up = sharpeRatio(curve([100, 101, 102.2, 103.1, 104.4]), 8760)!;
    const down = sharpeRatio(curve([100, 99, 98.2, 97.1, 95.9]), 8760)!;
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
  });
});

describe('periodsPerYearFor', () => {
  it('derives candle periods per year from the timeframe', () => {
    expect(periodsPerYearFor('1h')).toBeCloseTo(8760, 0);
    expect(periodsPerYearFor('1d')).toBeCloseTo(365, 0);
    expect(periodsPerYearFor('1m')).toBeCloseTo(525_600, 0);
  });
});

describe('performanceReport', () => {
  it('computes profit factor, expectancy, averages, and holding time', () => {
    const trades = [trade(100, HOUR), trade(-50, 2 * HOUR), trade(60, 3 * HOUR), trade(-30, 2 * HOUR)];
    const report = performanceReport(fakeResult(trades, [1000, 1080]), '1h');
    expect(report.winRatePct).toBeCloseTo(50, 8);
    expect(report.profitFactor).toBeCloseTo(160 / 80, 8);
    expect(report.expectancy).toBeCloseTo((100 - 50 + 60 - 30) / 4, 8);
    expect(report.avgTradePnl).toBeCloseTo(20, 8);
    expect(report.avgHoldingTimeMs).toBeCloseTo(2 * HOUR, 8);
    expect(report.tradeCount).toBe(4);
  });

  it('profit factor is null with no losses (undefined ratio, not Infinity)', () => {
    const report = performanceReport(fakeResult([trade(10), trade(5)], [1000, 1015]), '1h');
    expect(report.profitFactor).toBeNull();
  });

  it('handles zero trades without fake numbers', () => {
    const report = performanceReport(fakeResult([], [1000, 1000]), '1h');
    expect(report.tradeCount).toBe(0);
    expect(report.winRatePct).toBeNull();
    expect(report.profitFactor).toBeNull();
    expect(report.expectancy).toBeNull();
    expect(report.avgHoldingTimeMs).toBeNull();
    expect(report.sharpe).toBeNull();
  });

  it('carries return and drawdown through from the backtest result', () => {
    const report = performanceReport(fakeResult([trade(80)], [1000, 1080]), '1h');
    expect(report.totalReturnPct).toBeCloseTo(8, 8);
  });
});
