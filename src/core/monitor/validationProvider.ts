/**
 * Default validation verdict provider for the monitoring engine.
 *
 * Runs a compact walk-forward + robustness assessment over the candles the
 * monitor already fetched, cached per symbol+timeframe so repeated scans
 * stay cheap. Small windows often yield an honest 'insufficient-data'
 * verdict — that is correct behaviour, not a failure: monitoring-sized
 * history cannot prove robustness, only the Validation tab's deeper run can.
 */

import { trendStrategy } from '../strategies';
import type { BacktestConfig } from '../backtest/engine';
import type { Candle, Timeframe } from '../types';
import { assessRobustness, type RobustnessVerdict } from '../validation/robustness';
import { optimizingTrendFactory, walkForward } from '../validation/walkForward';
import type { ValidationVerdictProvider } from './monitoringEngine';

const TRAIN_SIZE = 75;
const TEST_SIZE = 25;
const GRID = [
  { fastPeriod: 5, slowPeriod: 20 },
  { fastPeriod: 10, slowPeriod: 30 },
];

export function makeWalkForwardValidator(backtest: BacktestConfig): ValidationVerdictProvider {
  const cache = new Map<string, RobustnessVerdict | 'not-run'>();

  return (symbol: string, timeframe: Timeframe, candles: readonly Candle[]) => {
    const key = `${symbol}:${timeframe}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let verdict: RobustnessVerdict | 'not-run';
    try {
      if (candles.length < TRAIN_SIZE + TEST_SIZE) {
        verdict = 'not-run';
      } else {
        const report = walkForward(candles, optimizingTrendFactory(GRID, backtest), {
          trainSize: TRAIN_SIZE,
          testSize: TEST_SIZE,
          timeframe,
          backtest,
        });
        verdict = assessRobustness({
          avgTrainReturnPct: report.aggregate.avgTrainReturnPct,
          avgTestReturnPct: report.aggregate.avgTestReturnPct,
          avgTrainSharpe: report.aggregate.avgTrainSharpe,
          avgTestSharpe: report.aggregate.avgTestSharpe,
          totalTestTrades: report.aggregate.totalTestTrades,
          foldCount: report.folds.length,
          avgTestWinRatePct: report.aggregate.avgTestWinRatePct,
        }).verdict;
      }
    } catch {
      verdict = 'not-run';
    }
    cache.set(key, verdict);
    return verdict;
  };
}

// Re-exported so callers can build a matching fixed strategy if needed.
export { trendStrategy };
