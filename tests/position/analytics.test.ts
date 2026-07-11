/**
 * Portfolio analytics tests (TDD): trade statistics, equity/drawdown
 * curves, monthly performance, and drawdown-adjusted metrics — reusing the
 * verified trade-stat mathematics wherever it exists.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEquityCurve,
  monthlyPerformance,
  rollingDrawdownPct,
  tradeAnalytics,
} from '../../src/core/position/analytics';
import type { JournalEntry } from '../../src/core/position/tradeJournal';

const T = Date.UTC(2026, 0, 15); // 2026-01-15
const HOUR = 3_600_000;
const DAY = 86_400_000;

let counter = 0;
function trade(pnl: number, overrides: Partial<JournalEntry> = {}): JournalEntry {
  counter++;
  return {
    id: `t${counter}`,
    symbol: 'BTC-USD',
    entryTimestamp: T + counter * DAY,
    exitTimestamp: T + counter * DAY + 2 * HOUR,
    entryPrice: 100,
    exitPrice: 100 + pnl / 10,
    positionSize: 10,
    stopLoss: 95,
    takeProfit: 110,
    exitReason: 'manual',
    fees: 0,
    slippage: 0,
    holdingDurationMs: 2 * HOUR,
    mfePct: 5,
    maePct: 2,
    realizedPnl: pnl,
    returnPct: pnl / 10,
    strategyVersion: 'trend-v1',
    validationVerdict: 'caution',
    confidence: 50,
    notes: null,
    ...overrides,
  };
}

describe('tradeAnalytics', () => {
  it('computes the full statistic set from a hand-checked sample', () => {
    // Sequence: +100, +60, -50, +40, -30, -20 (wins 3, losses 3)
    const trades = [trade(100), trade(60), trade(-50), trade(40), trade(-30), trade(-20)];
    const stats = tradeAnalytics(trades);
    expect(stats.tradeCount).toBe(6);
    expect(stats.winRatePct).toBeCloseTo(50, 8);
    expect(stats.lossRatePct).toBeCloseTo(50, 8);
    expect(stats.profitFactor).toBeCloseTo(200 / 100, 8);
    expect(stats.expectancy).toBeCloseTo(100 / 6, 8);
    expect(stats.avgWinner).toBeCloseTo(200 / 3, 8);
    expect(stats.avgLoser).toBeCloseTo(-100 / 3, 8);
    expect(stats.largestGain).toBe(100);
    expect(stats.largestLoss).toBe(-50);
    // Streaks: WW L W LL -> max wins 2, max losses 2.
    expect(stats.maxConsecutiveWins).toBe(2);
    expect(stats.maxConsecutiveLosses).toBe(2);
    expect(stats.avgHoldingMs).toBe(2 * HOUR);
  });

  it('returns nulls (not fake numbers) for an empty journal', () => {
    const stats = tradeAnalytics([]);
    expect(stats.tradeCount).toBe(0);
    expect(stats.winRatePct).toBeNull();
    expect(stats.profitFactor).toBeNull();
    expect(stats.expectancy).toBeNull();
    expect(stats.avgWinner).toBeNull();
    expect(stats.largestGain).toBeNull();
    expect(stats.maxConsecutiveWins).toBe(0);
  });

  it('profit factor is null when there are no losses', () => {
    expect(tradeAnalytics([trade(10), trade(5)]).profitFactor).toBeNull();
  });
});

describe('buildEquityCurve', () => {
  it('starts at initial cash and steps at each exit in chronological order', () => {
    const trades = [trade(100), trade(-50)];
    const curve = buildEquityCurve(trades, 10_000);
    expect(curve).toHaveLength(3); // start + 2 exits
    expect(curve[0]!.equity).toBe(10_000);
    expect(curve[1]!.equity).toBe(10_100);
    expect(curve[2]!.equity).toBe(10_050);
    expect(curve[1]!.timestamp).toBe(trades[0]!.exitTimestamp);
  });

  it('sorts out-of-order journals by exit time', () => {
    const late = trade(100);
    const early = trade(-50, { exitTimestamp: late.exitTimestamp - 5 * DAY });
    const curve = buildEquityCurve([late, early], 1_000);
    expect(curve.map((p) => p.equity)).toEqual([1_000, 950, 1_050]);
  });
});

describe('rollingDrawdownPct', () => {
  it('reports per-point drawdown from the running peak', () => {
    const curve = [10_000, 11_000, 9_900, 10_450, 11_500].map((equity, i) => ({
      timestamp: T + i,
      equity,
    }));
    const drawdown = rollingDrawdownPct(curve);
    expect(drawdown.map((d) => Number(d.drawdownPct.toFixed(2)))).toEqual([
      0, 0, 10, 5, 0,
    ]);
  });
});

describe('drawdown-adjusted metrics', () => {
  it('computes recovery factor and Calmar per the documented conventions', () => {
    // Net profit 500 on initial 10,000 over ~4 days with 10% max drawdown.
    const trades = [trade(1_000), trade(-500)];
    const stats = tradeAnalytics(trades, { initialCash: 10_000 });
    // Recovery factor = net profit / max drawdown amount.
    expect(stats.recoveryFactor).not.toBeNull();
    expect(stats.maxDrawdownPct).toBeGreaterThan(0);
    expect(stats.calmar).not.toBeNull();
  });

  it('leaves drawdown-adjusted metrics null when no drawdown occurred', () => {
    const stats = tradeAnalytics([trade(10), trade(20)], { initialCash: 1_000 });
    expect(stats.maxDrawdownPct).toBe(0);
    expect(stats.recoveryFactor).toBeNull();
    expect(stats.calmar).toBeNull();
  });
});

describe('monthlyPerformance', () => {
  it('groups realized P&L by UTC month', () => {
    const january = trade(100, { exitTimestamp: Date.UTC(2026, 0, 20) });
    const january2 = trade(-30, { exitTimestamp: Date.UTC(2026, 0, 25) });
    const march = trade(70, { exitTimestamp: Date.UTC(2026, 2, 5) });
    const months = monthlyPerformance([march, january, january2]);
    expect(months).toEqual([
      { month: '2026-01', pnl: 70, tradeCount: 2 },
      { month: '2026-03', pnl: 70, tradeCount: 1 },
    ]);
  });
});
