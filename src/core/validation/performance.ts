/**
 * Performance metrics for the validation harness.
 *
 * Builds on the verified backtest metrics; nothing here re-simulates.
 * Undefined ratios are `null`, never fake zeros or Infinity.
 *
 * Sharpe ratio convention (documented, deliberately simple):
 *   per-candle equity returns r_i = E_i / E_{i-1} - 1,
 *   Sharpe = mean(r) / populationStd(r) * sqrt(periodsPerYear),
 *   risk-free rate 0. `periodsPerYear` derives from the candle timeframe.
 */

import type { BacktestResult } from '../backtest/engine';
import type { EquityPoint } from '../backtest/metrics';
import type { Timeframe } from '../types';
import { TIMEFRAME_MS } from '../types';

const MS_PER_YEAR = 365 * 86_400_000;

export function periodsPerYearFor(timeframe: Timeframe): number {
  return MS_PER_YEAR / TIMEFRAME_MS[timeframe];
}

/** Annualised Sharpe ratio of an equity curve; null when undefined. */
export function sharpeRatio(
  curve: readonly EquityPoint[],
  periodsPerYear: number,
): number | null {
  if (curve.length < 2) return null;
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const previous = curve[i - 1]!.equity;
    if (previous <= 0) return null;
    returns.push(curve[i]!.equity / previous - 1);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return (mean / std) * Math.sqrt(periodsPerYear);
}

export interface PerformanceReport {
  readonly totalReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly tradeCount: number;
  /** % of closed trades with positive P&L; null with no trades. */
  readonly winRatePct: number | null;
  /** Gross profits / gross losses; null when there are no losses (or no trades). */
  readonly profitFactor: number | null;
  /** Mean P&L per trade — the expected value of taking one trade. */
  readonly expectancy: number | null;
  readonly avgTradePnl: number | null;
  readonly avgHoldingTimeMs: number | null;
  /** Annualised Sharpe ratio (see module doc); null when undefined. */
  readonly sharpe: number | null;
  readonly feesPaid: number;
}

export function performanceReport(result: BacktestResult, timeframe: Timeframe): PerformanceReport {
  const trades = result.closedTrades;
  const grossProfit = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = -trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0);
  const avgPnl =
    trades.length > 0 ? trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length : null;
  const avgHold =
    trades.length > 0
      ? trades.reduce((sum, t) => sum + (t.exitTimestamp - t.entryTimestamp), 0) / trades.length
      : null;

  return {
    totalReturnPct: result.totalReturnPct,
    maxDrawdownPct: result.maxDrawdownPct,
    tradeCount: trades.length,
    winRatePct: result.stats.winRatePct,
    profitFactor: trades.length > 0 && grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: avgPnl,
    avgTradePnl: avgPnl,
    avgHoldingTimeMs: avgHold,
    sharpe: sharpeRatio(result.equityCurve, periodsPerYearFor(timeframe)),
    feesPaid: result.feesPaid,
  };
}
