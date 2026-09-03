/**
 * Position monitoring tests (TDD): pure insight function over an open
 * position and current market state. Informational only — nothing here
 * can close a position.
 */

import { describe, expect, it } from 'vitest';
import { assessOpenPosition } from '../../src/core/position/positionMonitor';
import type { OpenPosition } from '../../src/core/position/positionEngine';

const T = 1_700_000_000_000;
const HOUR = 3_600_000;

function position(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    id: 'p1',
    symbol: 'BTC-USD',
    openedAt: T,
    entryPrice: 100,
    quantity: 10,
    initialQuantity: 10,
    stopLoss: 95,
    takeProfit: 110,
    feesPaid: 0,
    realizedPnl: 0,
    highestPrice: 100,
    lowestPrice: 100,
    confidence: 55,
    validationVerdict: 'caution',
    strategyVersion: 'trend-v1',
    notes: null,
    ...overrides,
  };
}

describe('assessOpenPosition', () => {
  it('reports P&L, distances, risk/reward, and time in trade', () => {
    const insight = assessOpenPosition(position(), {
      price: 104,
      timestamp: T + 6 * HOUR,
    });
    expect(insight.unrealizedPnl).toBeCloseTo(40, 10);
    expect(insight.pnlPct).toBeCloseTo(4, 10);
    expect(insight.distanceToStopPct).toBeCloseTo(((104 - 95) / 104) * 100, 8);
    expect(insight.distanceToTargetPct).toBeCloseTo(((110 - 104) / 104) * 100, 8);
    expect(insight.currentRisk).toBeCloseTo((104 - 95) * 10, 10);
    expect(insight.currentReward).toBeCloseTo((110 - 104) * 10, 10);
    expect(insight.timeInTradeMs).toBe(6 * HOUR);
    expect(insight.warnings).toEqual([]);
  });

  it('warns when price approaches the stop', () => {
    const insight = assessOpenPosition(position(), { price: 95.5, timestamp: T + HOUR });
    expect(insight.warnings.some((w) => w.includes('stop'))).toBe(true);
  });

  it("uses the REAL trailing-adjusted stop, not the stale initial one, once a trailing stop has activated (found in review, 2026-09-03: distanceToStopPct/currentRisk/warnings all used to read position.stopLoss even after trailing ratcheted the actual protective stop up past it)", () => {
    // entry 100, initial stop 90 (risk 10), peak 130 -> trail activates
    // (runUp 30 >= activateR(1)*risk(10)) -> trailed = 130 - trailR(1)*10 = 120.
    const pos = position({ stopLoss: 90, highestPrice: 130 });
    const insight = assessOpenPosition(pos, {
      price: 121, // within 1% of the REAL stop (120), NOT of the stale one (90)
      timestamp: T + HOUR,
      trailing: { activateR: 1, trailR: 1 },
    });
    expect(insight.distanceToStopPct).toBeCloseTo(((121 - 120) / 121) * 100, 8);
    expect(insight.currentRisk).toBeCloseTo((121 - 120) * 10, 10);
    expect(insight.warnings.some((w) => w.includes('120'))).toBe(true);
  });

  it('falls back to the fixed stopLoss when no trailing config is given (backward compatible)', () => {
    const pos = position({ stopLoss: 90, highestPrice: 130 });
    const insight = assessOpenPosition(pos, { price: 121, timestamp: T + HOUR });
    expect(insight.distanceToStopPct).toBeCloseTo(((121 - 90) / 121) * 100, 8);
  });

  it('warns when the stop has been breached — informational, never auto-closing', () => {
    const insight = assessOpenPosition(position(), { price: 94, timestamp: T + HOUR });
    expect(insight.warnings.some((w) => w.toLowerCase().includes('breached'))).toBe(true);
    expect(insight.warnings.some((w) => w.toLowerCase().includes('review'))).toBe(true);
  });

  it('warns when the market regime turns cold', () => {
    const insight = assessOpenPosition(position(), {
      price: 104,
      timestamp: T + HOUR,
      regime: 'cold',
    });
    expect(insight.regime).toBe('cold');
    expect(insight.warnings.some((w) => w.includes('regime'))).toBe(true);
  });

  it('warns when the validation verdict deteriorates from the one at entry', () => {
    const insight = assessOpenPosition(position({ validationVerdict: 'robust' }), {
      price: 104,
      timestamp: T + HOUR,
      currentValidationVerdict: 'overfitted',
    });
    expect(insight.warnings.some((w) => w.includes('alidation'))).toBe(true);
  });

  it('no warning when validation stays the same or improves', () => {
    const insight = assessOpenPosition(position({ validationVerdict: 'caution' }), {
      price: 104,
      timestamp: T + HOUR,
      currentValidationVerdict: 'robust',
      regime: 'hot',
    });
    expect(insight.warnings).toEqual([]);
  });

  it('warns when the target has been reached', () => {
    const insight = assessOpenPosition(position(), { price: 111, timestamp: T + HOUR });
    expect(insight.warnings.some((w) => w.includes('target'))).toBe(true);
  });
});
