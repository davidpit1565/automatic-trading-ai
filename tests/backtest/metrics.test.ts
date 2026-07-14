import { describe, expect, it } from 'vitest';
import {
  maxDrawdownPct,
  totalReturnPct,
  tradeStats,
  type ClosedTrade,
} from '../../src/core/backtest/metrics';

function curve(values: number[]) {
  return values.map((equity, i) => ({ timestamp: i, equity }));
}

describe('totalReturnPct', () => {
  it('computes percentage gain and loss', () => {
    expect(totalReturnPct(curve([100, 150]))).toBeCloseTo(50, 10);
    expect(totalReturnPct(curve([100, 80]))).toBeCloseTo(-20, 10);
  });

  it('is 0 for empty or flat curves', () => {
    expect(totalReturnPct([])).toBe(0);
    expect(totalReturnPct(curve([100, 100]))).toBe(0);
  });
});

describe('maxDrawdownPct', () => {
  it('finds the deepest peak-to-trough drop', () => {
    // Peak 200, trough 100 -> 50%, even though the curve recovers.
    expect(maxDrawdownPct(curve([100, 200, 100, 180]))).toBeCloseTo(50, 10);
  });

  it('is 0 for a monotonically rising curve', () => {
    expect(maxDrawdownPct(curve([100, 110, 120]))).toBe(0);
  });

  it('uses the running peak, not the global maximum', () => {
    // Drop from 150 to 120 (20%) happens before the higher peak of 300.
    expect(maxDrawdownPct(curve([150, 120, 300]))).toBeCloseTo(20, 10);
  });
});

describe('tradeStats', () => {
  const trade = (pnl: number): ClosedTrade => ({
    entryTimestamp: 0,
    exitTimestamp: 1,
    entryPrice: 100,
    exitPrice: 100 + pnl,
    quantity: 1,
    pnl,
  });

  it('counts wins, losses, and win rate', () => {
    const stats = tradeStats([trade(10), trade(-5), trade(3), trade(0)]);
    expect(stats.tradeCount).toBe(4);
    expect(stats.winCount).toBe(2);
    expect(stats.lossCount).toBe(1);
    expect(stats.winRatePct).toBeCloseTo(50, 10);
    expect(stats.totalPnl).toBeCloseTo(8, 10);
  });

  it('win rate is null with no trades (not fake 0%)', () => {
    expect(tradeStats([]).winRatePct).toBeNull();
  });
});
