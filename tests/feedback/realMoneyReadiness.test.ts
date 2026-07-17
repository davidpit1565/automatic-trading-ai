/**
 * Real-money readiness gate tests.
 *
 * The verdict must be conservative: "ready" only when EVERY safety threshold
 * is met, and every unmet criterion must be reported. It is a gate, never a
 * promise of profit.
 */

import { describe, expect, it } from 'vitest';
import {
  assessRealMoneyReadiness,
  READINESS_THRESHOLDS,
  type RealMoneyReadinessInput,
} from '../../src/core/feedback/realMoneyReadiness';

/** A record that clears every threshold. */
const PASSING: RealMoneyReadinessInput = {
  closedTrades: READINESS_THRESHOLDS.minClosedTrades,
  profitFactor: READINESS_THRESHOLDS.minProfitFactor,
  realizedReturnPct: 5,
  maxDrawdownPct: READINESS_THRESHOLDS.maxDrawdownPct - 1,
  vsBenchmarkPct: 2,
  daysRunning: READINESS_THRESHOLDS.minDays,
};

describe('assessRealMoneyReadiness', () => {
  it('is READY only when every threshold is met', () => {
    const r = assessRealMoneyReadiness(PASSING);
    expect(r.ready).toBe(true);
    expect(r.unmet).toEqual([]);
    expect(r.summary).toContain('READY');
    expect(r.criteria.every((c) => c.ok)).toBe(true);
  });

  it('matches the current live situation: too few trades, negative, unproven → NOT READY', () => {
    const r = assessRealMoneyReadiness({
      closedTrades: 1,
      profitFactor: null, // no winners yet
      realizedReturnPct: -0.46,
      maxDrawdownPct: 2,
      vsBenchmarkPct: 0.14,
      daysRunning: 3,
    });
    expect(r.ready).toBe(false);
    expect(r.unmet).toContain('trades');
    expect(r.unmet).toContain('days');
    expect(r.unmet).toContain('profitable');
    expect(r.unmet).toContain('consistency');
    expect(r.summary).toContain('NOT READY');
  });

  it('flags each failing criterion independently', () => {
    expect(assessRealMoneyReadiness({ ...PASSING, realizedReturnPct: -1 }).unmet).toEqual(['profitable']);
    expect(assessRealMoneyReadiness({ ...PASSING, vsBenchmarkPct: -0.1 }).unmet).toEqual(['benchmark']);
    expect(assessRealMoneyReadiness({ ...PASSING, vsBenchmarkPct: null }).unmet).toEqual(['benchmark']);
    expect(
      assessRealMoneyReadiness({ ...PASSING, maxDrawdownPct: READINESS_THRESHOLDS.maxDrawdownPct + 1 }).unmet,
    ).toEqual(['drawdown']);
    expect(assessRealMoneyReadiness({ ...PASSING, profitFactor: 1.0 }).unmet).toEqual(['consistency']);
  });

  it('always reports all six criteria with details', () => {
    const r = assessRealMoneyReadiness(PASSING);
    expect(r.criteria.map((c) => c.key)).toEqual([
      'trades',
      'days',
      'profitable',
      'benchmark',
      'drawdown',
      'consistency',
    ]);
    for (const c of r.criteria) expect(c.detail.length).toBeGreaterThan(0);
  });
});
