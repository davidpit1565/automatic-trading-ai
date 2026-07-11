/**
 * Walk-forward analysis tests (TDD).
 *
 * Rolling train/test windows with no lookahead: parameters chosen on the
 * training window only, then evaluated once on the unseen test window.
 */

import { describe, expect, it } from 'vitest';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { trendStrategy } from '../../src/core/strategies';
import {
  fixedStrategyFactory,
  optimizingTrendFactory,
  walkForward,
} from '../../src/core/validation/walkForward';

const T = 1_700_000_000_000;

function series(count: number, drift = 0.001, seed = 1) {
  return generateSyntheticCandles({
    seed,
    startPrice: 100,
    count,
    timeframe: '1h',
    startTimestamp: T,
    drift,
    volatility: 0.008,
  });
}

const CONFIG = {
  trainSize: 100,
  testSize: 50,
  timeframe: '1h' as const,
  backtest: { initialCash: 10_000 },
};

describe('walkForward fold construction', () => {
  it('produces non-overlapping, chronological test windows with train strictly before test', () => {
    const candles = series(400);
    const report = walkForward(candles, fixedStrategyFactory(trendStrategy({ fastPeriod: 5, slowPeriod: 20 })), CONFIG);
    // (400 - 100) / 50 = 6 folds.
    expect(report.folds).toHaveLength(6);
    report.folds.forEach((fold, i) => {
      expect(fold.trainRange.end).toBe(fold.testRange.start);
      expect(fold.trainRange.end - fold.trainRange.start).toBe(100);
      expect(fold.testRange.end - fold.testRange.start).toBe(50);
      if (i > 0) {
        expect(fold.testRange.start).toBe(report.folds[i - 1]!.testRange.end);
      }
    });
  });

  it('throws when there is not enough data for a single fold', () => {
    expect(() =>
      walkForward(series(120), fixedStrategyFactory(trendStrategy({ fastPeriod: 5, slowPeriod: 20 })), CONFIG),
    ).toThrow(RangeError);
  });

  it('validates window sizes', () => {
    const candles = series(400);
    const factory = fixedStrategyFactory(trendStrategy({ fastPeriod: 5, slowPeriod: 20 }));
    expect(() => walkForward(candles, factory, { ...CONFIG, trainSize: 0 })).toThrow(RangeError);
    expect(() => walkForward(candles, factory, { ...CONFIG, testSize: 0 })).toThrow(RangeError);
  });
});

describe('walkForward evaluation', () => {
  it('reports in-sample and out-of-sample performance per fold and in aggregate', () => {
    const report = walkForward(
      series(400),
      fixedStrategyFactory(trendStrategy({ fastPeriod: 5, slowPeriod: 20 })),
      CONFIG,
    );
    for (const fold of report.folds) {
      expect(Number.isFinite(fold.train.totalReturnPct)).toBe(true);
      expect(Number.isFinite(fold.test.totalReturnPct)).toBe(true);
    }
    expect(Number.isFinite(report.aggregate.avgTrainReturnPct)).toBe(true);
    expect(Number.isFinite(report.aggregate.avgTestReturnPct)).toBe(true);
    expect(report.aggregate.totalTestTrades).toBe(
      report.folds.reduce((sum, f) => sum + f.test.tradeCount, 0),
    );
  });

  it('builds a concatenated out-of-sample equity curve that chains across folds', () => {
    const report = walkForward(
      series(400),
      fixedStrategyFactory(trendStrategy({ fastPeriod: 5, slowPeriod: 20 })),
      CONFIG,
    );
    const curve = report.oosEquityCurve;
    expect(curve.length).toBe(6 * 50);
    // Normalised: starts at 100 and timestamps strictly increase.
    expect(curve[0]!.equity).toBeCloseTo(100, 6);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.timestamp).toBeGreaterThan(curve[i - 1]!.timestamp);
    }
  });

  it('is deterministic', () => {
    const candles = series(300);
    const factory = fixedStrategyFactory(trendStrategy({ fastPeriod: 5, slowPeriod: 20 }));
    expect(walkForward(candles, factory, CONFIG)).toEqual(walkForward(candles, factory, CONFIG));
  });

  it('applies execution costs to both training and test runs', () => {
    const candles = series(300, 0.002);
    const factory = fixedStrategyFactory(trendStrategy({ fastPeriod: 5, slowPeriod: 20 }));
    const frictionless = walkForward(candles, factory, CONFIG);
    const costly = walkForward(candles, factory, {
      ...CONFIG,
      backtest: { initialCash: 10_000, feeRate: 0.002, spreadPct: 0.002, slippagePct: 0.001 },
    });
    expect(costly.aggregate.avgTestReturnPct).toBeLessThan(frictionless.aggregate.avgTestReturnPct);
  });
});

describe('optimizingTrendFactory', () => {
  it('selects the best parameters on the training window only, and records diagnostics', () => {
    const grid = [
      { fastPeriod: 3, slowPeriod: 10 },
      { fastPeriod: 5, slowPeriod: 20 },
      { fastPeriod: 10, slowPeriod: 40 },
    ];
    const factory = optimizingTrendFactory(grid, { initialCash: 10_000 });
    const training = series(150, 0.002);
    const trained = factory.train(training);
    expect(trained.diagnostics).toBeDefined();
    expect(trained.diagnostics!.evaluated).toHaveLength(3);
    // The chosen candidate is the best-returning one on the training data.
    const best = [...trained.diagnostics!.evaluated].sort((a, b) => b.returnPct - a.returnPct)[0]!;
    expect(trained.diagnostics!.chosen).toBe(best.params);
    expect(trained.strategy.name).toContain('Trend');
  });

  it('rejects an empty grid', () => {
    expect(() => optimizingTrendFactory([], { initialCash: 10_000 })).toThrow(RangeError);
  });

  it('walk-forward with optimization carries chosen parameters per fold', () => {
    const grid = [
      { fastPeriod: 3, slowPeriod: 10 },
      { fastPeriod: 5, slowPeriod: 20 },
    ];
    const report = walkForward(series(400), optimizingTrendFactory(grid, { initialCash: 10_000 }), CONFIG);
    for (const fold of report.folds) {
      expect(fold.chosenParams).toBeDefined();
      expect(fold.diagnostics?.evaluated.length).toBe(2);
    }
  });
});
