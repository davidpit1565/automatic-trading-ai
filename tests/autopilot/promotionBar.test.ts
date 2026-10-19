import { describe, expect, it } from 'vitest';
import { PROMOTION_BAR, assessPromotion, maxDrawdownOfPnls, netPnl, probabilityMeanNotPositive, type PromotionTrade } from '../../src/core/autopilot/promotionBar';

function trade(i: number, pctMove: number, fees = 0): PromotionTrade {
  return { entryPrice: 100, exitPrice: 100 * (1 + pctMove / 100), positionSize: 10, fees, exitTimestamp: i };
}
function series(n: number, pattern: number[]): PromotionTrade[] {
  return Array.from({ length: n }, (_, i) => trade(i, pattern[i % pattern.length]!));
}

describe('promotion bar (pre-registered)', () => {
  it('net P&L includes BOTH fees (entry + exit)', () => {
    expect(netPnl({ entryPrice: 100, exitPrice: 110, positionSize: 2, fees: 3, exitTimestamp: 0 })).toBeCloseTo(17, 10);
  });

  it('is NOT TESTABLE below the minimum trade count, even with a perfect record', () => {
    const v = assessPromotion(series(50, [2]), 10_000);
    expect(v.testable).toBe(false);
    expect(v.passes).toBe(false);
  });

  it('passes a consistently profitable, large, low-drawdown record', () => {
    // 2 winners of +3% then 1 loser of -1%: PF 6, positive in every part.
    const v = assessPromotion(series(120, [3, 3, -1]), 10_000);
    expect(v.testable).toBe(true);
    expect(v.profitFactor).toBeGreaterThanOrEqual(PROMOTION_BAR.minProfitFactor);
    expect(v.partsProfitable).toBe(3);
    expect(v.probabilityMeanNotPositive).toBeLessThanOrEqual(PROMOTION_BAR.maxProbabilityMeanNotPositive);
    expect(v.passes).toBe(true);
  });

  it('fails a record with no edge (PF about 1) even when it is large', () => {
    const v = assessPromotion(series(120, [2, -2]), 10_000);
    expect(v.passes).toBe(false);
    expect(v.checks.profitFactor).toBe(false);
  });

  it('fails a record that only worked in one stretch of the market', () => {
    const early = Array.from({ length: 40 }, (_, i) => trade(i, 5)); // first third: great
    const rest = Array.from({ length: 80 }, (_, i) => trade(40 + i, i % 2 === 0 ? 1 : -3)); // then losing
    const v = assessPromotion([...early, ...rest], 10_000);
    expect(v.partsProfitable).toBeLessThan(PROMOTION_BAR.minPartsProfitable);
    expect(v.passes).toBe(false);
  });

  it('fees can turn a winning gross record into a failing net one', () => {
    const gross = assessPromotion(series(120, [1, -0.8]).map((t) => ({ ...t })), 10_000);
    const net = assessPromotion(series(120, [1, -0.8]).map((t) => ({ ...t, fees: 1.5 })), 10_000);
    expect(gross.totalNetPnl).toBeGreaterThan(net.totalNetPnl);
    expect(net.profitFactor!).toBeLessThan(gross.profitFactor!);
  });

  it('bootstrap probability is deterministic and sensible at the extremes', () => {
    expect(probabilityMeanNotPositive(Array(50).fill(1))).toBe(0);
    expect(probabilityMeanNotPositive(Array(50).fill(-1))).toBe(1);
    expect(probabilityMeanNotPositive([1, -1, 1, -1, 1, -1], 500)).toBe(probabilityMeanNotPositive([1, -1, 1, -1, 1, -1], 500));
    expect(probabilityMeanNotPositive([])).toBe(1);
  });

  it('measures max drawdown on the closed-trade equity curve', () => {
    expect(maxDrawdownOfPnls([1000, -2000, 500], 10_000)).toBeCloseTo((2000 / 11_000) * 100, 8);
    expect(maxDrawdownOfPnls([100, 100], 10_000)).toBe(0);
  });
});
