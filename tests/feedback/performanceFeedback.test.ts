/**
 * Stage 7 — Performance Feedback tests (TDD).
 *
 * Turns the verified trade journal into learning: which confidence levels
 * actually predict success, whether stops/targets are placed well, how
 * each strategy version performs, and whether the system beat simply
 * holding. Pure functions over journal entries — no new math where
 * verified math exists.
 */

import { describe, expect, it } from 'vitest';
import {
  benchmarkComparison,
  confidenceCalibration,
  efficiencyReport,
  exitReasonBreakdown,
  strategyBreakdown,
} from '../../src/core/feedback/performanceFeedback';
import type { JournalEntry } from '../../src/core/position/tradeJournal';

const T = 1_700_000_000_000;
const HOUR = 3_600_000;

let counter = 0;
function trade(overrides: Partial<JournalEntry> = {}): JournalEntry {
  counter++;
  return {
    id: `t${counter}`,
    symbol: 'BTC-USD',
    entryTimestamp: T + counter * HOUR,
    exitTimestamp: T + counter * HOUR + 2 * HOUR,
    entryPrice: 100,
    exitPrice: 105,
    positionSize: 10,
    stopLoss: 95,
    takeProfit: 110,
    exitReason: 'manual',
    fees: 0,
    slippage: 0,
    holdingDurationMs: 2 * HOUR,
    mfePct: 8,
    maePct: 2,
    realizedPnl: 50,
    returnPct: 5,
    strategyVersion: 'autopilot-paper-v1',
    validationVerdict: 'caution',
    confidence: 55,
    notes: null,
    ...overrides,
  };
}

describe('confidenceCalibration', () => {
  it('groups trades into confidence buckets with win rate and expectancy', () => {
    const entries = [
      trade({ confidence: 30, realizedPnl: -20 }),
      trade({ confidence: 35, realizedPnl: -10 }),
      trade({ confidence: 55, realizedPnl: 40 }),
      trade({ confidence: 58, realizedPnl: -15 }),
      trade({ confidence: 75, realizedPnl: 60 }),
      trade({ confidence: 80, realizedPnl: 30 }),
    ];
    const buckets = confidenceCalibration(entries);
    const low = buckets.find((b) => b.label === '0–40')!;
    const mid = buckets.find((b) => b.label === '40–60')!;
    const high = buckets.find((b) => b.label === '60–90')!;
    expect(low.tradeCount).toBe(2);
    expect(low.winRatePct).toBe(0);
    expect(mid.tradeCount).toBe(2);
    expect(mid.winRatePct).toBeCloseTo(50, 8);
    expect(mid.expectancy).toBeCloseTo(12.5, 8);
    expect(high.tradeCount).toBe(2);
    expect(high.winRatePct).toBeCloseTo(100, 8);
  });

  it('skips trades without confidence and reports empty buckets as empty', () => {
    const buckets = confidenceCalibration([trade({ confidence: null })]);
    expect(buckets.every((b) => b.tradeCount === 0)).toBe(true);
  });
});

describe('exitReasonBreakdown', () => {
  it('aggregates count, win rate, and P&L per exit reason', () => {
    const entries = [
      trade({ exitReason: 'take-profit', realizedPnl: 100 }),
      trade({ exitReason: 'take-profit', realizedPnl: 80 }),
      trade({ exitReason: 'stop-loss', realizedPnl: -50 }),
      trade({ exitReason: 'manual', realizedPnl: 10 }),
    ];
    const breakdown = exitReasonBreakdown(entries);
    const takeProfit = breakdown.find((r) => r.reason === 'take-profit')!;
    expect(takeProfit.tradeCount).toBe(2);
    expect(takeProfit.totalPnl).toBeCloseTo(180, 8);
    expect(takeProfit.winRatePct).toBeCloseTo(100, 8);
    const stopLoss = breakdown.find((r) => r.reason === 'stop-loss')!;
    expect(stopLoss.totalPnl).toBeCloseTo(-50, 8);
    // Sorted by trade count descending.
    expect(breakdown[0]!.reason).toBe('take-profit');
  });
});

describe('efficiencyReport', () => {
  it('measures how much of the favourable excursion was captured', () => {
    const entries = [
      // MFE 10%, realized 5% -> captured half of the best available move.
      trade({ mfePct: 10, returnPct: 5, realizedPnl: 50 }),
      // MFE 8%, realized 2%.
      trade({ mfePct: 8, returnPct: 2, realizedPnl: 20 }),
    ];
    const report = efficiencyReport(entries);
    expect(report.avgMfePct).toBeCloseTo(9, 8);
    expect(report.avgMaePct).toBeCloseTo(2, 8);
    expect(report.avgCapturePct).toBeCloseTo(((5 / 10 + 2 / 8) / 2) * 100, 6);
    expect(report.tradesThatSawProfit).toBe(2);
  });

  it('reports losers that were once profitable (gave back the MFE)', () => {
    const entries = [
      trade({ mfePct: 6, realizedPnl: -30, returnPct: -3 }), // was +6%, closed -3%
      trade({ mfePct: 0.2, realizedPnl: -10, returnPct: -1 }),
    ];
    const report = efficiencyReport(entries);
    expect(report.losersThatWereProfitable).toBe(1); // MFE >= 1% counts as "saw profit"
  });

  it('is null-safe on an empty journal', () => {
    const report = efficiencyReport([]);
    expect(report.avgMfePct).toBeNull();
    expect(report.avgCapturePct).toBeNull();
  });
});

describe('strategyBreakdown', () => {
  it('reuses the verified analytics per strategy version', () => {
    const entries = [
      trade({ strategyVersion: 'autopilot-paper-v1', realizedPnl: 50 }),
      trade({ strategyVersion: 'autopilot-paper-v1', realizedPnl: -20 }),
      trade({ strategyVersion: 'pipeline-v1', realizedPnl: 30 }),
      trade({ strategyVersion: null, realizedPnl: 5 }),
    ];
    const breakdown = strategyBreakdown(entries);
    const autopilot = breakdown.find((s) => s.strategyVersion === 'autopilot-paper-v1')!;
    expect(autopilot.stats.tradeCount).toBe(2);
    expect(autopilot.stats.winRatePct).toBeCloseTo(50, 8);
    expect(breakdown.find((s) => s.strategyVersion === 'manual')!.stats.tradeCount).toBe(1);
  });
});

describe('benchmarkComparison', () => {
  it('compares realized performance with equal-weight buy & hold of the traded symbols', () => {
    const entries = [
      trade({ symbol: 'BTC-USD', realizedPnl: 200 }),
      trade({ symbol: 'ETH-USD', realizedPnl: -50 }),
    ];
    const comparison = benchmarkComparison(entries, 10_000, {
      'BTC-USD': { startPrice: 100, endPrice: 120 }, // +20%
      'ETH-USD': { startPrice: 50, endPrice: 45 }, // -10%
    });
    expect(comparison).not.toBeNull();
    // Strategy: 150 profit on 10,000 = +1.5%.
    expect(comparison!.strategyReturnPct).toBeCloseTo(1.5, 8);
    // Benchmark: equal-weight (+20% - 10%) / 2 = +5%.
    expect(comparison!.holdReturnPct).toBeCloseTo(5, 8);
    expect(comparison!.beatBenchmark).toBe(false);
    expect(comparison!.symbols.sort()).toEqual(['BTC-USD', 'ETH-USD']);
  });

  it('returns null with no trades or no usable prices', () => {
    expect(benchmarkComparison([], 10_000, {})).toBeNull();
    expect(benchmarkComparison([trade()], 10_000, {})).toBeNull();
  });
});
