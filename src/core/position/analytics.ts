/**
 * Portfolio analytics — Stage 5.
 *
 * Statistics over the trade journal. Reuses the verified mathematics:
 * profit factor / expectancy / averages come from `profitStats`
 * (validation layer), drawdown from `maxDrawdownPct` (backtest metrics).
 *
 * Documented conventions:
 *   Recovery factor = net profit / max drawdown amount (null without drawdown).
 *   Calmar ratio    = annualised return % / max drawdown % over the journal's
 *                     time span (null without drawdown or a measurable span).
 */

import { maxDrawdownPct, type EquityPoint } from '../backtest/metrics';
import { profitStats } from '../validation/performance';
import type { JournalEntry } from './tradeJournal';

const MS_PER_YEAR = 365 * 86_400_000;

export interface TradeAnalytics {
  readonly tradeCount: number;
  readonly winRatePct: number | null;
  readonly lossRatePct: number | null;
  readonly profitFactor: number | null;
  readonly expectancy: number | null;
  readonly avgWinner: number | null;
  readonly avgLoser: number | null;
  readonly largestGain: number | null;
  readonly largestLoss: number | null;
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;
  readonly avgHoldingMs: number | null;
  readonly totalPnl: number;
  readonly maxDrawdownPct: number;
  readonly recoveryFactor: number | null;
  readonly calmar: number | null;
}

export function tradeAnalytics(
  entries: readonly JournalEntry[],
  options: { initialCash?: number } = {},
): TradeAnalytics {
  const sorted = [...entries].sort((a, b) => a.exitTimestamp - b.exitTimestamp);
  const wins = sorted.filter((t) => t.realizedPnl > 0);
  const losses = sorted.filter((t) => t.realizedPnl < 0);
  const shared = profitStats(
    sorted.map((t) => ({
      pnl: t.realizedPnl,
      entryTimestamp: t.entryTimestamp,
      exitTimestamp: t.exitTimestamp,
    })),
  );
  const totalPnl = sorted.reduce((sum, t) => sum + t.realizedPnl, 0);

  // Streaks over the chronological win/loss sequence.
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let winStreak = 0;
  let lossStreak = 0;
  for (const trade of sorted) {
    if (trade.realizedPnl > 0) {
      winStreak++;
      lossStreak = 0;
    } else if (trade.realizedPnl < 0) {
      lossStreak++;
      winStreak = 0;
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
    maxConsecutiveWins = Math.max(maxConsecutiveWins, winStreak);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, lossStreak);
  }

  // Drawdown-adjusted metrics need an equity curve — anchored to
  // initialCash when provided, else to zero-based cumulative P&L.
  const initialCash = options.initialCash ?? 0;
  const curve = buildEquityCurve(sorted, initialCash || 1);
  const drawdown = sorted.length > 0 ? maxDrawdownPct(curve) : 0;
  const peakEquity = Math.max(...curve.map((p) => p.equity));
  const drawdownAmount = (drawdown / 100) * peakEquity;
  const spanMs =
    sorted.length > 1 ? sorted[sorted.length - 1]!.exitTimestamp - sorted[0]!.entryTimestamp : 0;
  const annualisedReturnPct =
    initialCash > 0 && spanMs > 0 ? (totalPnl / initialCash) * 100 * (MS_PER_YEAR / spanMs) : null;

  return {
    tradeCount: sorted.length,
    winRatePct: sorted.length > 0 ? (wins.length / sorted.length) * 100 : null,
    lossRatePct: sorted.length > 0 ? (losses.length / sorted.length) * 100 : null,
    profitFactor: shared.profitFactor,
    expectancy: shared.expectancy,
    avgWinner: wins.length > 0 ? shared.grossProfit / wins.length : null,
    avgLoser: losses.length > 0 ? -shared.grossLoss / losses.length : null,
    largestGain: wins.length > 0 ? Math.max(...wins.map((t) => t.realizedPnl)) : null,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.realizedPnl)) : null,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    avgHoldingMs: shared.avgHoldingTimeMs,
    totalPnl,
    maxDrawdownPct: drawdown,
    recoveryFactor: drawdown > 0 && drawdownAmount > 0 ? totalPnl / drawdownAmount : null,
    calmar:
      drawdown > 0 && annualisedReturnPct !== null ? annualisedReturnPct / drawdown : null,
  };
}

/** Realized-P&L equity curve: starts at initialCash, steps at each exit. */
export function buildEquityCurve(
  entries: readonly JournalEntry[],
  initialCash: number,
): EquityPoint[] {
  const sorted = [...entries].sort((a, b) => a.exitTimestamp - b.exitTimestamp);
  const curve: EquityPoint[] = [
    {
      timestamp: sorted[0] ? Math.min(sorted[0].entryTimestamp, sorted[0].exitTimestamp) : 0,
      equity: initialCash,
    },
  ];
  let equity = initialCash;
  for (const trade of sorted) {
    equity += trade.realizedPnl;
    curve.push({ timestamp: trade.exitTimestamp, equity });
  }
  return curve;
}

/** Per-point drawdown from the running peak (same convention as maxDrawdownPct). */
export function rollingDrawdownPct(
  curve: readonly EquityPoint[],
): { timestamp: number; drawdownPct: number }[] {
  let peak = -Infinity;
  return curve.map((point) => {
    peak = Math.max(peak, point.equity);
    return {
      timestamp: point.timestamp,
      drawdownPct: peak > 0 ? ((peak - point.equity) / peak) * 100 : 0,
    };
  });
}

/** Realized P&L grouped by UTC month (YYYY-MM), chronological. */
export function monthlyPerformance(
  entries: readonly JournalEntry[],
): { month: string; pnl: number; tradeCount: number }[] {
  const byMonth = new Map<string, { pnl: number; tradeCount: number }>();
  for (const trade of entries) {
    const month = new Date(trade.exitTimestamp).toISOString().slice(0, 7);
    const bucket = byMonth.get(month) ?? { pnl: 0, tradeCount: 0 };
    bucket.pnl += trade.realizedPnl;
    bucket.tradeCount++;
    byMonth.set(month, bucket);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({ month, ...bucket }));
}
