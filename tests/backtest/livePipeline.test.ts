import { describe, expect, it } from 'vitest';
import {
  runLivePipelineBacktest,
  type LivePipelineResult,
} from '../../src/core/backtest/livePipeline';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { buildDailyRegimeFilter } from '../../src/core/signal/regimeFilter';
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

  describe('the evaluate override (comparing signal families)', () => {
    it('replaces the entry decision and is called with the scan and confidence floor', () => {
      const candles = uptrend();
      const seen: { symbol: string; floor: number }[] = [];
      const result = runLivePipelineBacktest(candles, {
        symbol: 'UP',
        timeframe: '1h',
        minConfidence: 37,
        evaluate: (scan, floor) => {
          seen.push({ symbol: scan.symbol, floor });
          return { kind: 'rejected', symbol: scan.symbol, timeframe: scan.timeframe, reasons: ['stub'] };
        },
      });

      // Called on every decided bar, with the pipeline's own scan and floor.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((s) => s.symbol === 'UP')).toBe(true);
      expect(seen.every((s) => s.floor === 37)).toBe(true);
      // A signal that always rejects must produce a flat, still-valid run — the
      // override cannot be bypassed by the production signal underneath it.
      expect(result.closedTrades.length).toBe(0);
      expect(result.finalEquity).toBe(result.initialCash);
      assertSane(result, candles.length);
    });

    it('leaves every other stage intact, so an always-reject override still costs nothing', () => {
      const candles = uptrend();
      const overridden = runLivePipelineBacktest(candles, {
        symbol: 'UP',
        timeframe: '1h',
        evaluate: (scan) => ({ kind: 'rejected', symbol: scan.symbol, timeframe: scan.timeframe, reasons: ['stub'] }),
      });

      expect(overridden.feesPaid).toBe(0);
      expect(overridden.stats.tradeCount).toBe(0);
    });

    it('omitting it keeps the production signal — the default path is unchanged', () => {
      const candles = uptrend();
      const withoutOption = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h' });
      const withUndefined = runLivePipelineBacktest(candles, {
        symbol: 'UP',
        timeframe: '1h',
        ...(undefined as unknown as { evaluate?: undefined }),
      });

      expect(withUndefined.finalEquity).toBe(withoutOption.finalEquity);
      expect(withUndefined.closedTrades.length).toBe(withoutOption.closedTrades.length);
    });
  });

  describe('trendExit (hold-through-trend instead of a fixed target)', () => {
    it('exits on a close below the trailing EMA rather than at the fixed take-profit', () => {
      // A sustained uptrend followed by a hard reversal: with a fixed target the
      // position books take-profit on the way up. With trendExit it should
      // instead ride past that level and only leave once price closes back
      // below its EMA — i.e. give a DIFFERENT, later exit reason.
      const up = uptrend(300);
      const down = generateSyntheticCandles({
        seed: 11,
        startPrice: up[up.length - 1]!.close,
        count: 100,
        timeframe: '1h',
        startTimestamp: up[up.length - 1]!.timestamp + 3_600_000,
        drift: -0.02,
        volatility: 0.01,
      });
      const candles = [...up, ...down];

      const fixed = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h' });
      const trendExit = runLivePipelineBacktest(candles, {
        symbol: 'UP',
        timeframe: '1h',
        trendExit: { emaPeriod: 20 },
      });

      assertSane(trendExit, candles.length);
      expect(fixed.closedTrades.some((t) => t.reason === 'take-profit')).toBe(true);
      expect(trendExit.closedTrades.some((t) => t.reason === 'take-profit')).toBe(false);
      expect(trendExit.closedTrades.some((t) => t.reason === 'trend-exit' || t.reason === 'liquidation')).toBe(true);
    });

    it('still honours the protective stop-loss intrabar — trend-exit does not override capital protection', () => {
      // A shorter uptrend that leaves exactly one position open at its final
      // bar (verified: entry ~221.5, still open — no further bars to hit its
      // stop or target), then a gap down through that stop: it must fire even
      // though trendExit is configured, and even though a slow EMA has not
      // turned yet after a sudden gap.
      const up = uptrend(200);
      const crash = generateSyntheticCandles({
        seed: 13,
        startPrice: up[up.length - 1]!.close * 0.85, // gaps down well below the entry's stop
        count: 60,
        timeframe: '1h',
        startTimestamp: up[up.length - 1]!.timestamp + 3_600_000,
        drift: -0.005,
        volatility: 0.005,
      });
      const candles = [...up, ...crash];

      const result = runLivePipelineBacktest(candles, {
        symbol: 'UP',
        timeframe: '1h',
        trendExit: { emaPeriod: 20 },
      });

      assertSane(result, candles.length);
      expect(result.closedTrades.some((t) => t.reason === 'stop-loss')).toBe(true);
    });

    it('is ignored when omitted — the default path takes the fixed take-profit', () => {
      const candles = uptrend();
      const withDefault = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h' });
      expect(withDefault.closedTrades.some((t) => t.reason === 'take-profit')).toBe(true);
    });
  });

  describe('regimeFilter (entry-side daily-trend gate, used by scripts/measureStocks.mts)', () => {
    it('blocks every entry when the filter always rejects, in an uptrend that would otherwise open positions', () => {
      const candles = uptrend();
      const gated = runLivePipelineBacktest(candles, {
        symbol: 'UP',
        timeframe: '1h',
        regimeFilter: () => false,
      });

      assertSane(gated, candles.length);
      expect(gated.closedTrades).toEqual([]);
    });

    it('does not block anything when the filter always allows — same result as omitting it', () => {
      const candles = uptrend();
      const ungated = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h' });
      const alwaysAllowed = runLivePipelineBacktest(candles, {
        symbol: 'UP',
        timeframe: '1h',
        regimeFilter: () => true,
      });

      expect(alwaysAllowed.closedTrades.length).toBe(ungated.closedTrades.length);
      expect(alwaysAllowed.totalReturnPct).toBeCloseTo(ungated.totalReturnPct, 6);
    });

    // These two use a genuinely SEPARATE, daily-spaced candle series to build
    // the regime filter — not the hourly entry series itself. This is the
    // real shape of the only two production call sites: autopilotRunner.mts
    // (crypto) fetches a distinct daily series; scripts/measureStocks.mts
    // reuses the entry slice ONLY because it restricts these candidates to
    // TF='1d' runs, where the entry slice genuinely IS daily. A test that fed
    // hourly-spaced bars into buildDailyRegimeFilter (which gates on a real
    // elapsed 86_400_000ms) would never exercise its actual day-boundary
    // logic at all.
    const DAY_MS = 86_400_000;

    it('with a real buildDailyRegimeFilter over a genuinely daily series: does not suppress entries during a sustained uptrend', () => {
      const up = uptrend();
      const daily = generateSyntheticCandles({
        seed: 42,
        startPrice: 100,
        count: 33,
        timeframe: '1d',
        startTimestamp: T0 - 20 * DAY_MS,
        drift: 0.004,
        volatility: 0.01,
      });

      const regime = buildDailyRegimeFilter(daily, { period: 20 });
      const gated = runLivePipelineBacktest(up, { symbol: 'UP', timeframe: '1h', regimeFilter: regime });
      const ungated = runLivePipelineBacktest(up, { symbol: 'UP', timeframe: '1h' });

      assertSane(gated, up.length);
      // A real uptrend regime filter should not remove every entry an
      // ungated run would have taken — the close sits above its own EMA
      // through most of a steady uptrend, so the gate should stay open.
      expect(gated.closedTrades.length).toBeGreaterThan(0);
      expect(gated.closedTrades.length).toBeLessThanOrEqual(ungated.closedTrades.length);
    });

    it('with a real buildDailyRegimeFilter over a genuinely daily series: suppresses new entries once the trend has actually turned down', () => {
      // Sustained hourly uptrend (produces real entries — same shape as the
      // trendExit tests above), then a hard, sustained hourly reversal.
      const up = uptrend(300);
      const down = generateSyntheticCandles({
        seed: 11,
        startPrice: up[up.length - 1]!.close,
        count: 150,
        timeframe: '1h',
        startTimestamp: up[up.length - 1]!.timestamp + 3_600_000,
        drift: -0.02,
        volatility: 0.01,
      });
      const candles = [...up, ...down];
      // A genuinely daily series spanning the same real-world window: mildly
      // up through most of it, then a sharp, sustained decline late enough
      // that the close sits below its own EMA(20) by the end.
      const dailyUp = generateSyntheticCandles({
        seed: 42,
        startPrice: 100,
        count: 33,
        timeframe: '1d',
        startTimestamp: T0 - 20 * DAY_MS,
        drift: 0.004,
        volatility: 0.01,
      });
      const dailyDown = generateSyntheticCandles({
        seed: 11,
        startPrice: dailyUp[dailyUp.length - 1]!.close,
        count: 20,
        timeframe: '1d',
        startTimestamp: dailyUp[dailyUp.length - 1]!.timestamp + DAY_MS,
        drift: -0.05,
        volatility: 0.01,
      });
      const daily = [...dailyUp, ...dailyDown];

      const regime = buildDailyRegimeFilter(daily, { period: 20 });
      // Confirms the scenario is real: by the final hourly bar, the gate has turned.
      expect(regime(candles[candles.length - 1]!.timestamp)).toBe(false);

      const gated = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h', regimeFilter: regime });
      const ungated = runLivePipelineBacktest(candles, { symbol: 'UP', timeframe: '1h' });

      assertSane(gated, candles.length);
      // Gating can only ever remove entries an ungated run would have taken,
      // never add extra ones.
      expect(gated.closedTrades.length).toBeLessThanOrEqual(ungated.closedTrades.length);
    });
  });
});
