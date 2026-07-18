import { describe, expect, it } from 'vitest';
import {
  runLivePipelineBacktest,
  type LivePipelineResult,
} from '../../src/core/backtest/livePipeline';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { performanceReport } from '../../src/core/validation/performance';
import type { Candle } from '../../src/core/types';

const T0 = 1_700_000_000_000;

function uptrend(count = 400): Candle[] {
  // Steady bullish drift with modest volatility: strong enough to score/confirm,
  // gentle enough that RSI stays under the long-entry ceiling.
  return generateSyntheticCandles({
    seed: 42,
    startPrice: 100,
    count,
    timeframe: '1h',
    startTimestamp: T0,
    drift: 0.004,
    volatility: 0.01,
  });
}

function downtrend(count = 400): Candle[] {
  return generateSyntheticCandles({
    seed: 7,
    startPrice: 100,
    count,
    timeframe: '1h',
    startTimestamp: T0,
    drift: -0.006,
    volatility: 0.012,
  });
}

/** Invariants every honest result must satisfy. */
function assertSane(result: LivePipelineResult, candleCount: number, scanWindow = 150): void {
  expect(Number.isFinite(result.finalEquity)).toBe(true);
  expect(Number.isFinite(result.totalReturnPct)).toBe(true);
  // One equity point per decided bar (scanWindow-1 .. end).
  expect(result.equityCurve.length).toBe(candleCount - scanWindow + 1);
  // Equity is never negative — the harness must never spend cash it lacks.
  for (const point of result.equityCurve) {
    expect(point.equity).toBeGreaterThan(0);
  }
  expect(result.feesPaid).toBeGreaterThanOrEqual(0);
  expect(result.stats.tradeCount).toBe(result.closedTrades.length);
}

describe('runLivePipelineBacktest', () => {
  it('opens at least one position and can take profit in a strong uptrend', () => {
    const candles = uptrend();
    const result = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h' });

    assertSane(result, candles.length);
    expect(result.closedTrades.length).toBeGreaterThanOrEqual(1);
    // A sustained uptrend should let at least one position reach its target.
    expect(result.closedTrades.some((t) => t.reason === 'take-profit')).toBe(true);
    expect(result.finalEquity).toBeGreaterThan(0);

    // performanceReport consumes the result unchanged (BacktestResult-compatible).
    const report = performanceReport(result, '1h');
    expect(report.tradeCount).toBe(result.closedTrades.length);
    expect(report.totalReturnPct).toBeCloseTo(result.totalReturnPct, 8);
  });

  it('does not churn trades and stays roughly flat in a downtrend', () => {
    const candles = downtrend();
    const result = runLivePipelineBacktest(candles, { symbol: 'DOWN', timeframe: '1h' });

    assertSane(result, candles.length);
    // Long-only: a bearish series yields few or no entries, never a blow-up.
    expect(result.closedTrades.length).toBeLessThanOrEqual(3);
    expect(result.finalEquity).toBeGreaterThan(result.initialCash * 0.9);
    expect(result.maxDrawdownPct).toBeLessThan(15);
  });

  it('charges fees that reduce final equity versus a zero-cost run', () => {
    const candles = uptrend();
    const withFees = runLivePipelineBacktest(candles, {
      symbol: 'UP',
      timeframe: '1h',
      costRate: 0.003,
    });
    const noFees = runLivePipelineBacktest(candles, {
      symbol: 'UP',
      timeframe: '1h',
      costRate: 0,
    });

    // The scenario must actually trade for this comparison to be meaningful.
    expect(withFees.closedTrades.length).toBeGreaterThan(0);
    expect(withFees.feesPaid).toBeGreaterThan(0);
    expect(noFees.feesPaid).toBe(0);
    expect(withFees.finalEquity).toBeLessThan(noFees.finalEquity);
  });

  it('applies the higher-timeframe gate without error and stays finite', () => {
    const candles = uptrend();
    // A congruent higher-timeframe series (bullish 4h) to exercise confirmation.
    const higher = generateSyntheticCandles({
      seed: 99,
      startPrice: 100,
      count: 200,
      timeframe: '4h',
      startTimestamp: T0,
      drift: 0.01,
      volatility: 0.012,
    });
    const result = runLivePipelineBacktest(candles, {
      symbol: 'UP',
      timeframe: '1h',
      higherCandles: higher,
      confirmationTimeframe: '4h',
    });

    assertSane(result, candles.length);
    expect(result.finalEquity).toBeGreaterThan(0);
  });

  it('returns a flat, valid result when there is not enough history', () => {
    const candles = uptrend(120); // fewer than the 150-bar scan window
    const result = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h' });

    expect(result.closedTrades.length).toBe(0);
    expect(result.finalEquity).toBe(result.initialCash);
    expect(result.totalReturnPct).toBe(0);
    expect(result.equityCurve.length).toBe(candles.length);
  });
});
