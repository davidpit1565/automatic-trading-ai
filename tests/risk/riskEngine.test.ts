/**
 * Stage 3 — Risk Engine tests (written before the implementation, TDD).
 *
 * The Risk Engine answers: "even if this is a good opportunity, is it safe
 * for THIS portfolio?" It consumes Signal Engine output, performs no
 * indicator math, and produces a fully explainable TradeRiskAssessment.
 */

import { describe, expect, it } from 'vitest';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { scanCandles } from '../../src/core/scan/marketScanner';
import { evaluateScan, type TradeOpportunity } from '../../src/core/signal/signalEngine';
import {
  assessTrade,
  calculatePositionSize,
  DEFAULT_RISK_LIMITS,
  type PortfolioRiskState,
} from '../../src/core/risk/riskEngine';

const T = 1_700_000_000_000;

/** Hand-built opportunity for precise level control. */
function makeOpportunity(overrides: Partial<{
  symbol: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
}> = {}): TradeOpportunity {
  const entry = overrides.entry ?? 100;
  const stopLoss = overrides.stopLoss ?? 95;
  const takeProfit = overrides.takeProfit ?? 110;
  return {
    symbol: overrides.symbol ?? 'BTC/USD',
    timeframe: '1h',
    direction: 'long',
    levels: {
      entry,
      stopLoss,
      takeProfit,
      riskReward: (takeProfit - entry) / (entry - stopLoss),
    },
    confidence: 60,
    confidenceComponents: [],
    explanation: 'test opportunity',
    warnings: [],
    basedOn: { score: 55, candleCount: 150 },
  };
}

function emptyPortfolio(equity = 10_000): PortfolioRiskState {
  return { equity, openPositions: [] };
}

// ---------------------------------------------------------------------------
// 1. Position sizing
// ---------------------------------------------------------------------------

describe('calculatePositionSize', () => {
  it('sizes so the stop-loss loss equals the risked fraction of equity', () => {
    const result = calculatePositionSize({
      accountEquity: 10_000,
      riskPerTradePct: 1,
      entry: 100,
      stopLoss: 95,
      currentExposure: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quantity).toBeCloseTo(20, 10);
    expect(result.value.positionValue).toBeCloseTo(2_000, 10);
    expect(result.value.maxLoss).toBeCloseTo(100, 10);
    expect(result.value.riskPctUsed).toBeCloseTo(1, 10);
    expect(result.value.constraintsApplied).toEqual([]);
  });

  it('the per-trade risk ceiling cannot be exceeded, even if more is requested', () => {
    const result = calculatePositionSize({
      accountEquity: 10_000,
      riskPerTradePct: 5, // above the 1% default ceiling
      entry: 100,
      stopLoss: 95,
      currentExposure: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.riskPctUsed).toBeCloseTo(DEFAULT_RISK_LIMITS.maxRiskPerTradePct, 10);
    expect(result.value.maxLoss).toBeCloseTo(100, 10); // still 1% of 10,000
    expect(result.value.constraintsApplied.some((c) => c.includes('risk ceiling'))).toBe(true);
  });

  it('volatility scales sizing: wider stops mean smaller positions', () => {
    // Stops chosen so neither hits the 20% position cap: pure risk scaling.
    const tight = calculatePositionSize({
      accountEquity: 10_000, riskPerTradePct: 1, entry: 100, stopLoss: 92, currentExposure: 0,
    });
    const wide = calculatePositionSize({
      accountEquity: 10_000, riskPerTradePct: 1, entry: 100, stopLoss: 90, currentExposure: 0,
    });
    expect(tight.ok && wide.ok).toBe(true);
    if (!tight.ok || !wide.ok) return;
    expect(tight.value.quantity).toBeCloseTo(12.5, 10); // 100 / 8
    expect(wide.value.quantity).toBeCloseTo(10, 10); // 100 / 10
    // Max loss identical regardless of volatility.
    expect(tight.value.maxLoss).toBeCloseTo(wide.value.maxLoss, 10);
    expect(tight.value.maxLoss).toBeCloseTo(100, 10);
  });

  it('caps the position at the maximum single-position share of equity', () => {
    // Tight stop implies 20,000 notional; cap is 20% of 10,000 = 2,000.
    const result = calculatePositionSize({
      accountEquity: 10_000, riskPerTradePct: 1, entry: 100, stopLoss: 99.5, currentExposure: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.positionValue).toBeCloseTo(2_000, 10);
    expect(result.value.quantity).toBeCloseTo(20, 10);
    expect(result.value.maxLoss).toBeCloseTo(10, 10); // 20 units * 0.5 stop distance
    expect(result.value.riskPctUsed).toBeCloseTo(0.1, 10);
    expect(result.value.constraintsApplied.some((c) => c.includes('position'))).toBe(true);
  });

  it('respects remaining total-exposure headroom', () => {
    // 55% of equity already deployed; total cap 60% leaves 500 headroom.
    const result = calculatePositionSize({
      accountEquity: 10_000, riskPerTradePct: 1, entry: 100, stopLoss: 95,
      currentExposure: 5_500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.positionValue).toBeCloseTo(500, 10);
    expect(result.value.constraintsApplied.some((c) => c.includes('exposure'))).toBe(true);
  });

  it('rejects invalid inputs', () => {
    const base = {
      accountEquity: 10_000, riskPerTradePct: 1, entry: 100, stopLoss: 95, currentExposure: 0,
    };
    expect(calculatePositionSize({ ...base, accountEquity: 0 }).ok).toBe(false);
    expect(calculatePositionSize({ ...base, riskPerTradePct: 0 }).ok).toBe(false);
    expect(calculatePositionSize({ ...base, entry: 0 }).ok).toBe(false);
    expect(calculatePositionSize({ ...base, stopLoss: 100 }).ok).toBe(false);
    expect(calculatePositionSize({ ...base, stopLoss: 101 }).ok).toBe(false);
    expect(calculatePositionSize({ ...base, currentExposure: -1 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2 + 4 + 5. Trade assessment: exposure, validation, approval object
// ---------------------------------------------------------------------------

describe('assessTrade — approvals', () => {
  it('approves a sound trade with a complete, explainable assessment', () => {
    const assessment = assessTrade(makeOpportunity(), emptyPortfolio());
    expect(assessment.approved).toBe(true);
    expect(assessment.asset).toBe('BTC/USD');
    expect(assessment.entry).toBe(100);
    expect(assessment.stopLoss).toBe(95);
    expect(assessment.takeProfit).toBe(110);
    expect(assessment.positionSize).toBeCloseTo(20, 10);
    expect(assessment.positionValue).toBeCloseTo(2_000, 10);
    expect(assessment.riskAmount).toBeCloseTo(100, 10);
    expect(assessment.riskPercentage).toBeCloseTo(1, 10);
    expect(assessment.rewardRiskRatio).toBeCloseTo(2, 10);
    expect(assessment.portfolioExposure).toBeCloseTo(20, 10); // 2,000 of 10,000 after entry
    expect(assessment.reasons.length).toBeGreaterThan(0); // approvals explain themselves too
  });

  it('accepts real Signal Engine output end to end', () => {
    // drift 0.001 / seed 1: bullish enough to pass every signal gate
    // (score 38, RSI ~70) without tripping the overextension ceiling.
    const candles = generateSyntheticCandles({
      seed: 1, startPrice: 100, count: 150, timeframe: '1h',
      startTimestamp: T, drift: 0.001, volatility: 0.004,
    });
    const scan = scanCandles('UP/USD', '1h', candles);
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    const decision = evaluateScan(scan.value);
    expect(decision.kind).toBe('opportunity');
    if (decision.kind !== 'opportunity') return;

    const assessment = assessTrade(decision.opportunity, emptyPortfolio());
    expect(assessment.approved).toBe(true);
    expect(assessment.positionSize).toBeGreaterThan(0);
    expect(assessment.entry).toBe(decision.opportunity.levels.entry);
  });

  it('carries a warning when the size is capped rather than rejecting', () => {
    const assessment = assessTrade(
      makeOpportunity({ entry: 100, stopLoss: 99.5, takeProfit: 101 }),
      emptyPortfolio(),
    );
    expect(assessment.approved).toBe(true);
    expect(assessment.warnings.some((w) => w.includes('capped'))).toBe(true);
    expect(assessment.riskPercentage).toBeLessThan(1);
  });
});

describe('assessTrade — portfolio exposure control', () => {
  it('rejects when the maximum number of open positions is reached', () => {
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: Array.from({ length: DEFAULT_RISK_LIMITS.maxOpenPositions }, (_, i) => ({
        symbol: `COIN${i}/USD`,
        quantity: 1,
        entryPrice: 100,
      })),
    };
    const assessment = assessTrade(makeOpportunity({ symbol: 'NEW/USD' }), portfolio);
    expect(assessment.approved).toBe(false);
    expect(assessment.positionSize).toBe(0);
    expect(assessment.reasons.some((r) => r.includes('open position'))).toBe(true);
  });

  it('rejects a duplicate asset already at its exposure cap', () => {
    // BTC already holds 20% of equity — the per-asset cap.
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'BTC/USD', quantity: 20, entryPrice: 100 }],
    };
    const assessment = assessTrade(makeOpportunity({ symbol: 'BTC/USD' }), portfolio);
    expect(assessment.approved).toBe(false);
    expect(assessment.reasons.some((r) => r.includes('BTC/USD'))).toBe(true);
  });

  it('allows a different asset while one asset is at its cap', () => {
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'BTC/USD', quantity: 20, entryPrice: 100 }],
    };
    const assessment = assessTrade(makeOpportunity({ symbol: 'ETH/USD' }), portfolio);
    expect(assessment.approved).toBe(true);
  });

  it('rejects when total portfolio exposure is exhausted', () => {
    // 60% of equity deployed — the total-exposure cap.
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [
        { symbol: 'A/USD', quantity: 20, entryPrice: 100 },
        { symbol: 'B/USD', quantity: 20, entryPrice: 100 },
        { symbol: 'C/USD', quantity: 20, entryPrice: 100 },
      ],
    };
    const assessment = assessTrade(makeOpportunity({ symbol: 'D/USD' }), portfolio);
    expect(assessment.approved).toBe(false);
    expect(assessment.reasons.some((r) => r.toLowerCase().includes('exposure'))).toBe(true);
  });

  it('reports portfolio exposure after the proposed trade', () => {
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'ETH/USD', quantity: 10, entryPrice: 100 }], // 10%
    };
    const assessment = assessTrade(makeOpportunity({ symbol: 'BTC/USD' }), portfolio);
    expect(assessment.approved).toBe(true);
    // 1,000 existing + 2,000 new = 30% of 10,000.
    expect(assessment.portfolioExposure).toBeCloseTo(30, 10);
  });
});

describe('assessTrade — correlated-cluster exposure cap (optional, off by default)', () => {
  const limits = { ...DEFAULT_RISK_LIMITS, correlationThreshold: 0.6, maxCorrelatedExposurePct: 25 };

  it('is a no-op when the limits/option are not supplied (backward compatible)', () => {
    // LINK is deeply correlated to ADA below, but with no correlation option
    // supplied at all, the cap never engages — existing behaviour is unchanged.
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'ADA/USD', quantity: 20, entryPrice: 100 }], // 20% of equity
    };
    const assessment = assessTrade(makeOpportunity({ symbol: 'LINK/USD' }), portfolio);
    expect(assessment.approved).toBe(true);
  });

  it('rejects a new entry whose correlated cluster is already at the cap', () => {
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'ADA/USD', quantity: 25, entryPrice: 100 }], // 25% — at the cluster cap
    };
    const correlationTo = (other: string): number => (other === 'ADA/USD' ? 0.8 : 0);
    const assessment = assessTrade(makeOpportunity({ symbol: 'LINK/USD' }), portfolio, {
      limits,
      correlationTo,
    });
    expect(assessment.approved).toBe(false);
    expect(assessment.reasons.some((r) => r.includes('correlated cluster'))).toBe(true);
  });

  it('shrinks (does not reject) a new entry that would only partially exceed the cluster cap', () => {
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'ADA/USD', quantity: 15, entryPrice: 100 }], // 15% — headroom to 25%
    };
    const correlationTo = (other: string): number => (other === 'ADA/USD' ? 0.8 : 0);
    const assessment = assessTrade(makeOpportunity({ symbol: 'LINK/USD' }), portfolio, {
      limits,
      correlationTo,
    });
    expect(assessment.approved).toBe(true);
    expect(assessment.warnings.some((w) => w.includes('correlated-cluster'))).toBe(true);
    // New position capped to the remaining 10% headroom (1,000 of 10,000 equity).
    expect(assessment.positionValue).toBeCloseTo(1000, 5);
  });

  it('ignores uncorrelated open positions entirely', () => {
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'BTC/USD', quantity: 25, entryPrice: 100 }], // 25%, but uncorrelated
    };
    const correlationTo = (other: string): number => (other === 'BTC/USD' ? 0.1 : 0);
    const assessment = assessTrade(makeOpportunity({ symbol: 'LINK/USD' }), portfolio, {
      limits,
      correlationTo,
    });
    expect(assessment.approved).toBe(true);
    expect(assessment.warnings.some((w) => w.includes('correlated-cluster'))).toBe(false);
  });
});

describe('assessTrade — risk/reward and stop validation', () => {
  it('rejects reward/risk below the minimum', () => {
    const assessment = assessTrade(
      makeOpportunity({ entry: 100, stopLoss: 95, takeProfit: 102 }), // R/R 0.4
      emptyPortfolio(),
    );
    expect(assessment.approved).toBe(false);
    expect(assessment.reasons.some((r) => r.includes('reward'))).toBe(true);
  });

  it('rejects unrealistic targets (reward/risk beyond the plausible maximum)', () => {
    const assessment = assessTrade(
      makeOpportunity({ entry: 100, stopLoss: 99, takeProfit: 250 }), // R/R 150
      emptyPortfolio(),
    );
    expect(assessment.approved).toBe(false);
    expect(assessment.reasons.some((r) => r.includes('unrealistic'))).toBe(true);
  });

  it('rejects stops at, above, or too close to entry', () => {
    const atEntry = assessTrade(
      makeOpportunity({ entry: 100, stopLoss: 100, takeProfit: 110 }),
      emptyPortfolio(),
    );
    expect(atEntry.approved).toBe(false);

    const above = assessTrade(
      makeOpportunity({ entry: 100, stopLoss: 105, takeProfit: 110 }),
      emptyPortfolio(),
    );
    expect(above.approved).toBe(false);

    const tooClose = assessTrade(
      makeOpportunity({ entry: 100, stopLoss: 99.99, takeProfit: 110 }), // 0.01%
      emptyPortfolio(),
    );
    expect(tooClose.approved).toBe(false);
    expect(tooClose.reasons.some((r) => r.includes('stop'))).toBe(true);
  });

  it('collects every failed check', () => {
    const portfolio: PortfolioRiskState = {
      equity: 10_000,
      openPositions: [{ symbol: 'BTC/USD', quantity: 20, entryPrice: 100 }],
    };
    const assessment = assessTrade(
      makeOpportunity({ symbol: 'BTC/USD', entry: 100, stopLoss: 99.99, takeProfit: 100.5 }),
      portfolio,
    );
    expect(assessment.approved).toBe(false);
    expect(assessment.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects when the daily loss limit has been reached', () => {
    const assessment = assessTrade(makeOpportunity(), emptyPortfolio(), {
      dailyLossSoFar: 300, // 3% of 10,000 — the default daily limit
    });
    expect(assessment.approved).toBe(false);
    expect(assessment.reasons.some((r) => r.includes('daily loss'))).toBe(true);
  });

  it('is deterministic', () => {
    const opportunity = makeOpportunity();
    const portfolio = emptyPortfolio();
    expect(assessTrade(opportunity, portfolio)).toEqual(assessTrade(opportunity, portfolio));
  });
});
