/**
 * Trade economics tests (TDD).
 *
 * A pure check of whether a proposed trade's theoretical reward at target
 * can even clear round-trip fees — built entirely from an assessment's own
 * numbers, never a separately guessed edge model.
 */

import { describe, expect, it } from 'vitest';
import { assessTradeEconomics } from '../../src/core/risk/tradeEconomics';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';

function assessment(overrides: Partial<TradeRiskAssessment> = {}): TradeRiskAssessment {
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
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

describe('assessTradeEconomics', () => {
  it('is viable when the target reward comfortably clears round-trip fees', () => {
    // roundTripFees = 200 * 0.003 * 2 = 1.2; rewardAtTarget = 10 * 3 = 30.
    const result = assessTradeEconomics(assessment(), 0.003);

    expect(result.roundTripFees).toBeCloseTo(1.2);
    expect(result.netRewardAtTarget).toBeCloseTo(28.8);
    expect(result.feeShareOfReward).toBeCloseTo(1.2 / 30);
    expect(result.viable).toBe(true);
  });

  it('is not viable when fees would consume the entire target reward — an objective fact, not a guessed threshold', () => {
    // A tiny, low-reward-ratio position where round-trip fees on the
    // notional exceed what hitting the target would even pay out.
    const result = assessTradeEconomics(
      assessment({ positionValue: 1000, riskAmount: 0.5, rewardRiskRatio: 1 }),
      0.003,
    );

    // roundTripFees = 1000 * 0.003 * 2 = 6; rewardAtTarget = 0.5 * 1 = 0.5.
    expect(result.roundTripFees).toBeCloseTo(6);
    expect(result.netRewardAtTarget).toBeCloseTo(-5.5);
    expect(result.feeShareOfReward).toBeGreaterThan(1);
    expect(result.viable).toBe(false);
  });

  it('is exactly on the boundary (not viable) when fees exactly equal the target reward', () => {
    // roundTripFees = 100 * 0.003 * 2 = 0.6; rewardAtTarget = 0.3 * 2 = 0.6.
    const result = assessTradeEconomics(
      assessment({ positionValue: 100, riskAmount: 0.3, rewardRiskRatio: 2 }),
      0.003,
    );

    expect(result.netRewardAtTarget).toBeCloseTo(0);
    expect(result.feeShareOfReward).toBeCloseTo(1);
    expect(result.viable).toBe(false);
  });

  it('reports Infinity feeShareOfReward (never divides by zero) when there is no theoretical reward at all', () => {
    const result = assessTradeEconomics(assessment({ riskAmount: 0, rewardRiskRatio: 3 }), 0.003);

    expect(result.feeShareOfReward).toBe(Infinity);
    expect(result.viable).toBe(false);
  });

  it('scales with costRate — a higher assumed fee rate makes the same trade less viable, never more', () => {
    const cheap = assessTradeEconomics(assessment(), 0.001);
    const expensive = assessTradeEconomics(assessment(), 0.01);

    expect(expensive.roundTripFees).toBeGreaterThan(cheap.roundTripFees);
    expect(expensive.netRewardAtTarget).toBeLessThan(cheap.netRewardAtTarget);
  });
});
