/**
 * Walk-forward analysis — Stage 3.5.
 *
 * Rolling windows with no lookahead: a strategy (or its parameters) is
 * chosen using ONLY the training window, then evaluated once on the
 * following unseen test window. Comparing in-sample and out-of-sample
 * results is the primary defence against curve fitting.
 *
 * All runs go through the verified backtest engine, costs included —
 * nothing here re-implements simulation or indicator math.
 */

import { runBacktest, type BacktestConfig, type Strategy } from '../backtest/engine';
import type { EquityPoint } from '../backtest/metrics';
import { trendStrategy, type TrendOptions } from '../strategies/trend';
import type { Candle, Timeframe } from '../types';
import { performanceReport, type PerformanceReport } from './performance';

export interface OptimizationDiagnostics {
  /** Every candidate evaluated on the training window with its return. */
  readonly evaluated: { readonly params: string; readonly returnPct: number }[];
  /** The candidate that was selected. */
  readonly chosen: string;
}

export interface TrainedStrategy {
  readonly strategy: Strategy;
  readonly diagnostics?: OptimizationDiagnostics;
}

export interface StrategyFactory {
  readonly name: string;
  /** Build (or select) a strategy using ONLY the given training candles. */
  train(trainingCandles: readonly Candle[]): TrainedStrategy;
}

/** Wrap a fixed strategy — no optimisation, same strategy every fold. */
export function fixedStrategyFactory(strategy: Strategy): StrategyFactory {
  return {
    name: strategy.name,
    train: () => ({ strategy }),
  };
}

/**
 * Grid-search factory for the trend strategy: picks the candidate with the
 * best training-window return. Diagnostics expose the full grid so the
 * robustness assessor can measure parameter sensitivity.
 */
export function optimizingTrendFactory(
  grid: readonly TrendOptions[],
  backtest: BacktestConfig,
): StrategyFactory {
  if (grid.length === 0) throw new RangeError('optimisation grid must not be empty');
  return {
    name: `Trend (walk-forward optimised, ${grid.length} candidates)`,
    train(trainingCandles) {
      const evaluated = grid.map((params) => {
        const result = runBacktest(trainingCandles, trendStrategy(params), backtest);
        return {
          params: `SMA ${params.fastPeriod}/${params.slowPeriod}`,
          returnPct: result.totalReturnPct,
          options: params,
        };
      });
      const best = evaluated.reduce((a, b) => (b.returnPct > a.returnPct ? b : a));
      return {
        strategy: trendStrategy(best.options),
        diagnostics: {
          evaluated: evaluated.map(({ params, returnPct }) => ({ params, returnPct })),
          chosen: best.params,
        },
      };
    },
  };
}

export interface WalkForwardConfig {
  /** Candles per training window. */
  readonly trainSize: number;
  /** Candles per out-of-sample test window. */
  readonly testSize: number;
  readonly timeframe: Timeframe;
  /** Backtest configuration including execution costs; applied to all runs. */
  readonly backtest: BacktestConfig;
}

export interface FoldResult {
  readonly foldIndex: number;
  /** Candle index ranges, end exclusive. */
  readonly trainRange: { readonly start: number; readonly end: number };
  readonly testRange: { readonly start: number; readonly end: number };
  readonly chosenParams?: string;
  readonly diagnostics?: OptimizationDiagnostics;
  /** In-sample performance (training window). */
  readonly train: PerformanceReport;
  /** Out-of-sample performance (unseen test window). */
  readonly test: PerformanceReport;
}

export interface WalkForwardReport {
  readonly strategyName: string;
  readonly timeframe: Timeframe;
  readonly folds: FoldResult[];
  readonly aggregate: {
    readonly avgTrainReturnPct: number;
    readonly avgTestReturnPct: number;
    readonly avgTrainSharpe: number | null;
    readonly avgTestSharpe: number | null;
    readonly avgTestWinRatePct: number | null;
    /** How much of the in-sample return survives out of sample (see docs). */
    readonly degradationPct: number | null;
    readonly totalTestTrades: number;
  };
  /**
   * Out-of-sample equity across all folds, chained and normalised to start
   * at 100 — the honest "what unseen data did" curve for the dashboard.
   */
  readonly oosEquityCurve: EquityPoint[];
}

export function walkForward(
  candles: readonly Candle[],
  factory: StrategyFactory,
  config: WalkForwardConfig,
): WalkForwardReport {
  const { trainSize, testSize } = config;
  if (!Number.isInteger(trainSize) || trainSize < 2) {
    throw new RangeError(`trainSize must be an integer >= 2, got ${trainSize}`);
  }
  if (!Number.isInteger(testSize) || testSize < 2) {
    throw new RangeError(`testSize must be an integer >= 2, got ${testSize}`);
  }
  if (candles.length < trainSize + testSize) {
    throw new RangeError(
      `need at least ${trainSize + testSize} candles for one fold, got ${candles.length}`,
    );
  }

  const folds: FoldResult[] = [];
  const oosEquityCurve: EquityPoint[] = [];
  let oosScale = 1;

  for (
    let start = 0;
    start + trainSize + testSize <= candles.length;
    start += testSize
  ) {
    const trainRange = { start, end: start + trainSize };
    const testRange = { start: trainRange.end, end: trainRange.end + testSize };
    const trainingCandles = candles.slice(trainRange.start, trainRange.end);
    const testCandles = candles.slice(testRange.start, testRange.end);

    const trained = factory.train(trainingCandles);
    const trainResult = runBacktest(trainingCandles, trained.strategy, config.backtest);
    const testResult = runBacktest(testCandles, trained.strategy, config.backtest);

    // Chain each fold's OOS equity onto the previous fold's end, base 100:
    // fold N starts where fold N-1 finished, relative to cash invested.
    const initial = config.backtest.initialCash;
    const chainBase = (oosScale * 100) / initial;
    for (const point of testResult.equityCurve) {
      oosEquityCurve.push({ timestamp: point.timestamp, equity: point.equity * chainBase });
    }
    oosScale *= testResult.finalEquity / initial;

    folds.push({
      foldIndex: folds.length,
      trainRange,
      testRange,
      chosenParams: trained.diagnostics?.chosen,
      diagnostics: trained.diagnostics,
      train: performanceReport(trainResult, config.timeframe),
      test: performanceReport(testResult, config.timeframe),
    });
  }

  return {
    strategyName: factory.name,
    timeframe: config.timeframe,
    folds,
    aggregate: aggregate(folds),
    oosEquityCurve,
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function aggregate(folds: FoldResult[]): WalkForwardReport['aggregate'] {
  const avgTrainReturnPct = mean(folds.map((f) => f.train.totalReturnPct)) ?? 0;
  const avgTestReturnPct = mean(folds.map((f) => f.test.totalReturnPct)) ?? 0;
  return {
    avgTrainReturnPct,
    avgTestReturnPct,
    avgTrainSharpe: mean(folds.map((f) => f.train.sharpe).filter((v): v is number => v !== null)),
    avgTestSharpe: mean(folds.map((f) => f.test.sharpe).filter((v): v is number => v !== null)),
    avgTestWinRatePct: mean(
      folds.map((f) => f.test.winRatePct).filter((v): v is number => v !== null),
    ),
    // Share of in-sample return that survived out of sample; null when
    // in-sample made nothing (ratio would be meaningless).
    degradationPct:
      avgTrainReturnPct > 0 ? (1 - avgTestReturnPct / avgTrainReturnPct) * 100 : null,
    totalTestTrades: folds.reduce((sum, f) => sum + f.test.tradeCount, 0),
  };
}
